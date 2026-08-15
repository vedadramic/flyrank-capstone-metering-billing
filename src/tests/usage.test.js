const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const TENANT_ID = 5501;
const token = jwt.sign(
  { tenantId: TENANT_ID, email: 'usage-test@example.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

async function insertUsage(key, createdAt, quantity, tokens, costMicrocents) {
  await db.query(`
    INSERT INTO usage_events (
      tenant_id,
      event_type,
      quantity,
      idempotency_key,
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_tokens,
      cost_microcents,
      request_hash,
      response_json,
      created_at
    )
    VALUES ($1, 'generate', $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, $10)
  `, [
    TENANT_ID,
    quantity,
    key,
    tokens.input_tokens || 0,
    tokens.cached_input_tokens || 0,
    tokens.output_tokens || 0,
    tokens.reasoning_tokens || 0,
    costMicrocents,
    `hash-${key}`,
    createdAt,
  ]);
}

beforeAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID]);
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, 'usage-test@example.com', 'hash', (SELECT id FROM plans WHERE name = 'free'))
  `, [TENANT_ID]);
});

afterEach(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
});

afterAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID]);
  await db.end();
});

test('GET /usage returns the current monthly rollup, limits, and exact USD conversion', async () => {
  await insertUsage(
    'usage-current',
    new Date(),
    1,
    { input_tokens: 1, cached_input_tokens: 1, output_tokens: 1, reasoning_tokens: 1 },
    3450
  );

  const now = new Date();
  const previousMonth = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - 1,
    15
  ));
  await insertUsage(
    'usage-previous',
    previousMonth,
    50,
    { input_tokens: 5000 },
    1500000
  );

  const response = await request(app)
    .get('/usage')
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);
  expect(response.body.tenant).toEqual({ email: 'usage-test@example.com', plan: 'free' });
  expect(response.body.usage).toEqual({
    api_calls: { used: 1, limit: 1000, cost_microcents: 0 },
    ai_tokens: { used: 4, limit: 100000, cost_microcents: 3450 },
  });
  expect(response.body.total_cost_microcents).toBe(3450);
  expect(response.body.total_cost_usd).toBe('0.00003450');
});
