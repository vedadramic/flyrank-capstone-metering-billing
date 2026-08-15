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
      request_hash TEXT,
      response_json JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE usage_events
      ADD COLUMN IF NOT EXISTS request_hash TEXT,
      ADD COLUMN IF NOT EXISTS response_json JSONB;

    UPDATE usage_events
    SET request_hash = 'legacy-' || id
    WHERE request_hash IS NULL;

    UPDATE usage_events
    SET response_json = '{}'::jsonb
    WHERE response_json IS NULL;

    ALTER TABLE usage_events
      ALTER COLUMN request_hash SET NOT NULL,
      ALTER COLUMN response_json SET NOT NULL;

    ALTER TABLE usage_events
      DROP CONSTRAINT IF EXISTS usage_events_idempotency_key_key;
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'usage_events_non_negative_check'
      ) THEN
        ALTER TABLE usage_events ADD CONSTRAINT usage_events_non_negative_check CHECK (
          quantity >= 0 AND
          input_tokens >= 0 AND
          cached_input_tokens >= 0 AND
          output_tokens >= 0 AND
          reasoning_tokens >= 0 AND
          cost_microcents >= 0
        );
      END IF;
    END
    $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      id SERIAL PRIMARY KEY,
      stripe_event_id TEXT NOT NULL UNIQUE,
      processed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS background_jobs (
      id BIGSERIAL PRIMARY KEY,
      job_type TEXT NOT NULL,
      deduplication_key TEXT NOT NULL UNIQUE,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_error TEXT,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT background_jobs_status_check CHECK (
        status IN ('pending', 'processing', 'retry', 'completed', 'failed')
      ),
      CONSTRAINT background_jobs_attempts_check CHECK (
        attempts >= 0 AND max_attempts > 0
      )
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_id ON usage_events(tenant_id);
    DROP INDEX IF EXISTS idx_usage_events_idempotency_key;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_tenant_idempotency
      ON usage_events(tenant_id, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_usage_events_tenant_created_at
      ON usage_events(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_background_jobs_ready
      ON background_jobs(status, available_at);
  `);

  console.log('Migration complete');
  await pool.end();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
