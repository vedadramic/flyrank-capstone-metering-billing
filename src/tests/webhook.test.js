const request = require('supertest');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = require('../app');
const db = require('../db');

const TEST_TENANT_ID = 6666;

beforeAll(async () => {
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, $2, $3, (SELECT id FROM plans WHERE name = 'free'))
    ON CONFLICT (id) DO NOTHING
  `, [TEST_TENANT_ID, 'webhook-test@example.com', 'hash']);
});

test('rejects webhook with invalid signature', async () => {
  const response = await request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', 'invalid-signature')
    .send('{"type":"checkout.session.completed"}');

  expect(response.status).toBe(400);
});

test('accepts a signed checkout webhook, updates the tenant, and ignores the replay', async () => {
  const event = {
    id: 'evt_test_checkout_completed',
    type: 'checkout.session.completed',
    data: {
      object: {
        customer: 'cus_test_123',
        subscription: 'sub_test_123',
        metadata: {
          tenant_id: TEST_TENANT_ID.toString(),
        },
      },
    },
  };

  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  const firstResponse = await request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);

  const secondResponse = await request(app)
    .post('/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(payload);

  expect(firstResponse.status).toBe(200);
  expect(firstResponse.body.received).toBe(true);
  expect(secondResponse.status).toBe(200);
  expect(secondResponse.body.duplicate).toBe(true);

  const tenantResult = await db.query(
    `
      SELECT t.stripe_customer_id, t.stripe_subscription_id, t.subscription_status, p.name AS plan_name
      FROM tenants t
      JOIN plans p ON t.plan_id = p.id
      WHERE t.id = $1
    `,
    [TEST_TENANT_ID]
  );

  expect(tenantResult.rows[0].stripe_customer_id).toBe('cus_test_123');
  expect(tenantResult.rows[0].stripe_subscription_id).toBe('sub_test_123');
  expect(tenantResult.rows[0].subscription_status).toBe('active');
  expect(tenantResult.rows[0].plan_name).toBe('pro');

  const subscriptionResult = await db.query(
    `
      SELECT s.stripe_customer_id, s.stripe_subscription_id, s.status, p.name AS plan_name
      FROM subscriptions s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.tenant_id = $1
    `,
    [TEST_TENANT_ID]
  );

  expect(subscriptionResult.rows[0].stripe_customer_id).toBe('cus_test_123');
  expect(subscriptionResult.rows[0].stripe_subscription_id).toBe('sub_test_123');
  expect(subscriptionResult.rows[0].status).toBe('active');
  expect(subscriptionResult.rows[0].plan_name).toBe('pro');
});

afterAll(async () => {
  await db.query('DELETE FROM processed_webhook_events WHERE stripe_event_id = $1', ['evt_test_checkout_completed']);
  await db.query('DELETE FROM subscriptions WHERE tenant_id = $1', [TEST_TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TEST_TENANT_ID]);
  await db.end();
});