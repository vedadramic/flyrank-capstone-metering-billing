const request = require('supertest');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = require('../app');
const db = require('../db');
const WebhookJobService = require('../services/WebhookJobService');

const TENANT_ID = 6601;
const RETRY_TENANT_ID = 6699;
const FAILED_TENANT_ID = 6698;

function checkoutEvent(id, tenantId = TENANT_ID) {
  return {
    id,
    type: 'checkout.session.completed',
    data: {
      object: {
        customer: `cus_${tenantId}`,
        subscription: `sub_${tenantId}`,
        metadata: { tenant_id: tenantId.toString() },
      },
    },
  };
}

function signedEvent(event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  return request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);
}

async function tenantState(tenantId = TENANT_ID) {
  const result = await db.query(`
    SELECT
      p.name AS plan_name,
      t.subscription_status,
      t.stripe_customer_id,
      t.stripe_subscription_id
    FROM tenants t
    JOIN plans p ON p.id = t.plan_id
    WHERE t.id = $1
  `, [tenantId]);
  return result.rows[0];
}

beforeAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = ANY($1)', [[TENANT_ID, RETRY_TENANT_ID, FAILED_TENANT_ID]]);
  await db.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1)', [[TENANT_ID, RETRY_TENANT_ID, FAILED_TENANT_ID]]);
  await db.query('DELETE FROM tenants WHERE id = ANY($1)', [[TENANT_ID, RETRY_TENANT_ID, FAILED_TENANT_ID]]);
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id, subscription_status)
    VALUES ($1, 'webhook-test@example.com', 'hash', (SELECT id FROM plans WHERE name = 'free'), 'active')
  `, [TENANT_ID]);
});

beforeEach(async () => {
  await db.query(`DELETE FROM background_jobs WHERE deduplication_key LIKE 'evt_phase3_%'`);
  await db.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1)', [[TENANT_ID, RETRY_TENANT_ID, FAILED_TENANT_ID]]);
  await db.query('DELETE FROM tenants WHERE id = ANY($1)', [[RETRY_TENANT_ID, FAILED_TENANT_ID]]);
  await db.query(`
    UPDATE tenants
    SET
      plan_id = (SELECT id FROM plans WHERE name = 'free'),
      stripe_customer_id = NULL,
      stripe_subscription_id = NULL,
      subscription_status = 'active'
    WHERE id = $1
  `, [TENANT_ID]);
});

afterAll(async () => {
  await db.query(`DELETE FROM background_jobs WHERE deduplication_key LIKE 'evt_phase3_%'`);
  await db.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1)', [[TENANT_ID, RETRY_TENANT_ID, FAILED_TENANT_ID]]);
  await db.query('DELETE FROM tenants WHERE id = ANY($1)', [[TENANT_ID, RETRY_TENANT_ID, FAILED_TENANT_ID]]);
  await db.end();
});

test('a forged signature returns 400 and changes nothing', async () => {
  const response = await request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 'forged-signature')
    .send(JSON.stringify(checkoutEvent('evt_phase3_forged')));

  expect(response.status).toBe(400);
  expect((await tenantState()).plan_name).toBe('free');

  const jobs = await db.query(`
    SELECT COUNT(*) FROM background_jobs WHERE deduplication_key = 'evt_phase3_forged'
  `);
  expect(Number(jobs.rows[0].count)).toBe(0);
});

test('a signed event is queued once and marked completed only after tenant changes commit', async () => {
  const event = checkoutEvent('evt_phase3_checkout');
  const first = await signedEvent(event);
  const duplicate = await signedEvent(event);

  expect(first.status).toBe(202);
  expect(first.body.queued).toBe(true);
  expect(duplicate.status).toBe(200);
  expect(duplicate.body.duplicate).toBe(true);
  expect((await tenantState()).plan_name).toBe('free');

  const queued = await db.query(`
    SELECT status, attempts FROM background_jobs WHERE deduplication_key = $1
  `, [event.id]);
  expect(queued.rows).toEqual([{ status: 'pending', attempts: 0 }]);

  const processed = await WebhookJobService.processNextJob({ retryDelayMs: 0 });
  expect(processed.status).toBe('completed');

  const tenant = await tenantState();
  expect(tenant.plan_name).toBe('pro');
  expect(tenant.subscription_status).toBe('active');

  const job = await db.query(`
    SELECT status, attempts, completed_at IS NOT NULL AS has_completed_at
    FROM background_jobs
    WHERE deduplication_key = $1
  `, [event.id]);
  expect(job.rows[0]).toEqual({ status: 'completed', attempts: 1, has_completed_at: true });
  expect(await WebhookJobService.processNextJob({ retryDelayMs: 0 })).toBeNull();
});

test('a processing error remains retryable and later succeeds safely', async () => {
  const event = checkoutEvent('evt_phase3_retry', RETRY_TENANT_ID);
  expect((await signedEvent(event)).status).toBe(202);

  const failedAttempt = await WebhookJobService.processNextJob({ retryDelayMs: 0 });
  expect(failedAttempt.status).toBe('retry');
  expect(failedAttempt.attempts).toBe(1);
  expect(failedAttempt.completed_at).toBeNull();

  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id, subscription_status)
    VALUES ($1, 'webhook-retry@example.com', 'hash', (SELECT id FROM plans WHERE name = 'free'), 'active')
  `, [RETRY_TENANT_ID]);
  await db.query(`
    UPDATE background_jobs SET available_at = NOW() WHERE deduplication_key = $1
  `, [event.id]);

  const retry = await WebhookJobService.processNextJob({ retryDelayMs: 0 });
  expect(retry.status).toBe('completed');
  expect(retry.attempts).toBe(2);
  expect((await tenantState(RETRY_TENANT_ID)).plan_name).toBe('pro');
});

test('a job reaches terminal failure after its configured attempts and raises an alert', async () => {
  const event = checkoutEvent('evt_phase3_terminal', FAILED_TENANT_ID);
  expect((await signedEvent(event)).status).toBe(202);
  await db.query(`
    UPDATE background_jobs SET max_attempts = 2 WHERE deduplication_key = $1
  `, [event.id]);

  const first = await WebhookJobService.processNextJob({ retryDelayMs: 0 });
  expect(first.status).toBe('retry');
  await db.query(`
    UPDATE background_jobs SET available_at = NOW() WHERE deduplication_key = $1
  `, [event.id]);

  const alert = jest.spyOn(console, 'error').mockImplementation(() => {});
  const second = await WebhookJobService.processNextJob({ retryDelayMs: 0 });

  expect(second.status).toBe('failed');
  expect(second.attempts).toBe(2);
  expect(second.completed_at).toBeNull();
  expect(alert).toHaveBeenCalledWith(expect.stringContaining('failed permanently'));
  alert.mockRestore();
});

test('subscription updated and deleted events synchronize plan and status', async () => {
  await signedEvent(checkoutEvent('evt_phase3_setup'));
  await WebhookJobService.processNextJob({ retryDelayMs: 0 });

  const updated = {
    id: 'evt_phase3_updated',
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: `sub_${TENANT_ID}`,
        customer: `cus_${TENANT_ID}`,
        status: 'past_due',
        items: { data: [{ price: { id: process.env.STRIPE_PRO_PRICE_ID } }] },
      },
    },
  };

  expect((await signedEvent(updated)).status).toBe(202);
  await WebhookJobService.processNextJob({ retryDelayMs: 0 });
  expect(await tenantState()).toEqual({
    plan_name: 'pro',
    subscription_status: 'past_due',
    stripe_customer_id: `cus_${TENANT_ID}`,
    stripe_subscription_id: `sub_${TENANT_ID}`,
  });

  const deleted = {
    id: 'evt_phase3_deleted',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: `sub_${TENANT_ID}`,
        customer: `cus_${TENANT_ID}`,
        status: 'canceled',
      },
    },
  };

  expect((await signedEvent(deleted)).status).toBe(202);
  await WebhookJobService.processNextJob({ retryDelayMs: 0 });
  expect(await tenantState()).toEqual({
    plan_name: 'free',
    subscription_status: 'canceled',
    stripe_customer_id: `cus_${TENANT_ID}`,
    stripe_subscription_id: null,
  });
});
