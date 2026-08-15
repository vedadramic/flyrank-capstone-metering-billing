const db = require('../db');

const PRO_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'incomplete',
  'past_due',
  'paused',
  'trialing',
  'unpaid',
]);

async function enqueueStripeEvent(event) {
  const result = await db.query(`
    INSERT INTO background_jobs (
      job_type,
      deduplication_key,
      payload
    )
    VALUES ('stripe_webhook', $1, $2)
    ON CONFLICT (deduplication_key) DO NOTHING
    RETURNING id, status
  `, [event.id, event]);

  if (result.rows[0]) {
    return { created: true, job: result.rows[0] };
  }

  const existing = await db.query(`
    SELECT id, status FROM background_jobs WHERE deduplication_key = $1
  `, [event.id]);
  return { created: false, job: existing.rows[0] };
}

async function claimNextJob(leaseSeconds) {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(`
      SELECT *
      FROM background_jobs
      WHERE job_type = 'stripe_webhook'
        AND available_at <= NOW()
        AND attempts < max_attempts
        AND status IN ('pending', 'retry', 'processing')
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);

    const job = result.rows[0];
    if (!job) {
      await client.query('COMMIT');
      return null;
    }

    const claimed = await client.query(`
      UPDATE background_jobs
      SET
        status = 'processing',
        attempts = attempts + 1,
        available_at = NOW() + ($2 * INTERVAL '1 second'),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [job.id, leaseSeconds]);

    await client.query('COMMIT');
    return claimed.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findTenantForSubscription(client, subscription) {
  if (subscription.id) {
    const bySubscription = await client.query(`
      SELECT t.id, p.name AS plan_name
      FROM tenants t
      JOIN plans p ON p.id = t.plan_id
      WHERE t.stripe_subscription_id = $1
      FOR UPDATE OF t
    `, [subscription.id]);

    if (bySubscription.rows[0]) {
      return bySubscription.rows[0];
    }
  }

  const byCustomer = await client.query(`
    SELECT t.id, p.name AS plan_name
    FROM tenants t
    JOIN plans p ON p.id = t.plan_id
    WHERE t.stripe_customer_id = $1
    FOR UPDATE OF t
  `, [subscription.customer]);

  return byCustomer.rows[0] || null;
}

async function applyCheckoutCompleted(client, session) {
  const tenantId = Number(session.metadata?.tenant_id);
  if (!Number.isInteger(tenantId) || !session.customer || !session.subscription) {
    throw new Error('Checkout event is missing tenant, customer, or subscription data');
  }

  const tenantResult = await client.query(`
    UPDATE tenants
    SET
      plan_id = (SELECT id FROM plans WHERE name = 'pro'),
      stripe_customer_id = $2,
      stripe_subscription_id = $3,
      subscription_status = 'active'
    WHERE id = $1
    RETURNING id
  `, [tenantId, session.customer, session.subscription]);

  if (!tenantResult.rows[0]) {
    throw new Error(`Tenant ${tenantId} does not exist`);
  }

  await client.query(`
    INSERT INTO subscriptions (
      tenant_id,
      plan_id,
      stripe_customer_id,
      stripe_subscription_id,
      status
    )
    VALUES ($1, (SELECT id FROM plans WHERE name = 'pro'), $2, $3, 'active')
    ON CONFLICT (tenant_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status = EXCLUDED.status,
      updated_at = NOW()
  `, [tenantId, session.customer, session.subscription]);
}

async function applySubscriptionUpdated(client, subscription) {
  const tenant = await findTenantForSubscription(client, subscription);
  if (!tenant) {
    throw new Error(`No tenant found for Stripe subscription ${subscription.id}`);
  }

  const priceId = subscription.items?.data?.[0]?.price?.id;
  let planName = tenant.plan_name;

  if (!PRO_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    planName = 'free';
  } else if (priceId) {
    planName = priceId === process.env.STRIPE_PRO_PRICE_ID ? 'pro' : 'free';
  }

  await client.query(`
    UPDATE tenants
    SET
      plan_id = (SELECT id FROM plans WHERE name = $2),
      stripe_customer_id = $3,
      stripe_subscription_id = $4,
      subscription_status = $5
    WHERE id = $1
  `, [tenant.id, planName, subscription.customer, subscription.id, subscription.status]);

  await client.query(`
    INSERT INTO subscriptions (
      tenant_id,
      plan_id,
      stripe_customer_id,
      stripe_subscription_id,
      status
    )
    VALUES ($1, (SELECT id FROM plans WHERE name = $2), $3, $4, $5)
    ON CONFLICT (tenant_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status = EXCLUDED.status,
      updated_at = NOW()
  `, [tenant.id, planName, subscription.customer, subscription.id, subscription.status]);
}

async function applySubscriptionDeleted(client, subscription) {
  const tenant = await findTenantForSubscription(client, subscription);
  if (!tenant) {
    throw new Error(`No tenant found for Stripe subscription ${subscription.id}`);
  }

  await client.query(`
    UPDATE tenants
    SET
      plan_id = (SELECT id FROM plans WHERE name = 'free'),
      stripe_subscription_id = NULL,
      subscription_status = 'canceled'
    WHERE id = $1
  `, [tenant.id]);

  await client.query(`
    UPDATE subscriptions
    SET
      plan_id = (SELECT id FROM plans WHERE name = 'free'),
      stripe_subscription_id = NULL,
      status = 'canceled',
      updated_at = NOW()
    WHERE tenant_id = $1
  `, [tenant.id]);
}

async function applyStripeEvent(client, event) {
  switch (event.type) {
    case 'checkout.session.completed':
      return applyCheckoutCompleted(client, event.data.object);
    case 'customer.subscription.updated':
      return applySubscriptionUpdated(client, event.data.object);
    case 'customer.subscription.deleted':
      return applySubscriptionDeleted(client, event.data.object);
    default:
      return undefined;
  }
}

async function recordFailure(job, err, retryDelayMs) {
  const terminal = job.attempts >= job.max_attempts;
  const result = await db.query(`
    UPDATE background_jobs
    SET
      status = $2,
      last_error = $3,
      available_at = NOW() + ($4 * INTERVAL '1 millisecond'),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [
    job.id,
    terminal ? 'failed' : 'retry',
    err.message.slice(0, 1000),
    retryDelayMs,
  ]);

  if (terminal) {
    console.error(
      `ALERT: background job ${job.id} failed permanently after ${job.attempts} attempts: ${err.message}`
    );
  }

  return result.rows[0];
}

async function processNextJob(options = {}) {
  const leaseSeconds = options.leaseSeconds || 30;
  const retryDelayMs = options.retryDelayMs === undefined ? 1000 : options.retryDelayMs;
  const job = await claimNextJob(leaseSeconds);

  if (!job) {
    return null;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await applyStripeEvent(client, job.payload);
    const completed = await client.query(`
      UPDATE background_jobs
      SET
        status = 'completed',
        completed_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [job.id]);
    await client.query('COMMIT');
    return completed.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    return recordFailure(job, err, retryDelayMs);
  } finally {
    client.release();
  }
}

let workerTimer;
let workerBusy = false;

function startWorker(pollIntervalMs = 1000) {
  if (workerTimer) {
    return;
  }

  const poll = async () => {
    if (workerBusy) {
      return;
    }

    workerBusy = true;
    try {
      await processNextJob();
    } catch (err) {
      console.error('Background worker poll failed:', err.message);
    } finally {
      workerBusy = false;
    }
  };

  workerTimer = setInterval(poll, pollIntervalMs);
  workerTimer.unref();
  poll();
}

function stopWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = undefined;
  }
}

module.exports = {
  applyStripeEvent,
  enqueueStripeEvent,
  processNextJob,
  startWorker,
  stopWorker,
};
