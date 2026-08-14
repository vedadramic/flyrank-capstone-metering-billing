const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      api_calls_limit INTEGER NOT NULL,
      ai_tokens_limit INTEGER NOT NULL,
      stripe_price_id TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan_id INTEGER REFERENCES plans(id) DEFAULT 1,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) NOT NULL UNIQUE,
      plan_id INTEGER REFERENCES plans(id) NOT NULL DEFAULT 1,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) NOT NULL,
      event_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      input_tokens INTEGER DEFAULT 0,
      cached_input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      cost_microcents INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      id SERIAL PRIMARY KEY,
      stripe_event_id TEXT NOT NULL UNIQUE,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_id ON usage_events(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_usage_events_idempotency_key ON usage_events(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_usage_events_created_at ON usage_events(created_at);
  `);

  console.log('Migration complete');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});