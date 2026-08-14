const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { PLANS } = require('../config/pricing');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  await pool.query(`
    INSERT INTO plans (name, api_calls_limit, ai_tokens_limit)
    VALUES ($1, $2, $3)
    ON CONFLICT (name) DO UPDATE SET
      api_calls_limit = EXCLUDED.api_calls_limit,
      ai_tokens_limit = EXCLUDED.ai_tokens_limit
  `, [PLANS.free.name, PLANS.free.api_calls_limit, PLANS.free.ai_tokens_limit]);

  await pool.query(`
    INSERT INTO plans (name, api_calls_limit, ai_tokens_limit)
    VALUES ($1, $2, $3)
    ON CONFLICT (name) DO UPDATE SET
      api_calls_limit = EXCLUDED.api_calls_limit,
      ai_tokens_limit = EXCLUDED.ai_tokens_limit
  `, [PLANS.pro.name, PLANS.pro.api_calls_limit, PLANS.pro.ai_tokens_limit]);

  const passwordHash = await bcrypt.hash('password123', 10);

  await pool.query(`
    INSERT INTO tenants (email, password_hash, plan_id)
    VALUES ($1, $2, (SELECT id FROM plans WHERE name = 'free'))
    ON CONFLICT (email) DO NOTHING
  `, ['demo@example.com', passwordHash]);

  await pool.query(`
    INSERT INTO tenants (email, password_hash, plan_id)
    VALUES ($1, $2, (SELECT id FROM plans WHERE name = 'free'))
    ON CONFLICT (email) DO NOTHING
  `, ['near-limit@example.com', passwordHash]);

  console.log('Seed complete');
  console.log('Demo accounts: demo@example.com / password123');
  console.log('Near-limit account: near-limit@example.com / password123');

  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});