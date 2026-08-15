const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { PLANS } = require('../config/pricing');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function upsertPlan(client, plan) {
  await client.query(`
    INSERT INTO plans (
      name,
      api_calls_limit,
      ai_tokens_limit,
      stripe_price_id
    )
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (name) DO UPDATE SET
      api_calls_limit = EXCLUDED.api_calls_limit,
      ai_tokens_limit = EXCLUDED.ai_tokens_limit,
      stripe_price_id = EXCLUDED.stripe_price_id
  `, [plan.name, plan.api_calls_limit, plan.ai_tokens_limit, plan.stripe_price_id]);
}

async function upsertDemoTenant(client, email, passwordHash) {
  const result = await client.query(`
    INSERT INTO tenants (
      email,
      password_hash,
      plan_id,
      stripe_customer_id,
      stripe_subscription_id,
      subscription_status
    )
    VALUES (
      $1,
      $2,
      (SELECT id FROM plans WHERE name = 'free'),
      NULL,
      NULL,
      'active'
    )
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      plan_id = EXCLUDED.plan_id,
      stripe_customer_id = NULL,
      stripe_subscription_id = NULL,
      subscription_status = 'active'
    RETURNING id
  `, [email, passwordHash]);

  return result.rows[0].id;
}

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await upsertPlan(client, PLANS.free);
    await upsertPlan(client, PLANS.pro);

    const passwordHash = await bcrypt.hash('password123', 10);
    const demoTenantId = await upsertDemoTenant(client, 'demo@example.com', passwordHash);
    const nearLimitTenantId = await upsertDemoTenant(
      client,
      'near-limit@example.com',
      passwordHash
    );

    await client.query(`
      DELETE FROM subscriptions WHERE tenant_id IN ($1, $2)
    `, [demoTenantId, nearLimitTenantId]);
    await client.query(`
      DELETE FROM usage_events WHERE tenant_id IN ($1, $2)
    `, [demoTenantId, nearLimitTenantId]);

    await client.query(`
      INSERT INTO usage_events (
        tenant_id,
        event_type,
        quantity,
        idempotency_key,
        request_hash,
        response_json
      )
      VALUES ($1, 'generate', 999, 'seed-near-limit', 'seed-near-limit', '{}'::jsonb)
    `, [nearLimitTenantId]);

    await client.query('COMMIT');
    console.log('Seed complete');
    console.log('Demo account: demo@example.com / password123 (0 of 1,000 API calls)');
    console.log('Near-limit account: near-limit@example.com / password123 (999 of 1,000 API calls)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
