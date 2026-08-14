const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const TEST_TENANT_ID = 7777;
const REJECT_TENANT_ID = 7778;
const IDENTITY_KEY = `generate-test-${Date.now()}`;
const token = jwt.sign(
  { tenantId: TEST_TENANT_ID, email: 'generate-test@example.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);
const rejectToken = jwt.sign(
  { tenantId: REJECT_TENANT_ID, email: 'generate-reject@example.com' },
  JWT_SECRET,
  { expiresIn: '1h' }
);

beforeAll(async () => {
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, $2, $3, (SELECT id FROM plans WHERE name = 'free'))
    ON CONFLICT (id) DO NOTHING
  `, [TEST_TENANT_ID, 'generate-test@example.com', 'hash']);

  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, $2, $3, (SELECT id FROM plans WHERE name = 'free'))
    ON CONFLICT (id) DO NOTHING
  `, [REJECT_TENANT_ID, 'generate-reject@example.com', 'hash']);
});

afterAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TEST_TENANT_ID]);
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [REJECT_TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TEST_TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [REJECT_TENANT_ID]);
  await db.end();
});

test('generate creates one usage event and returns the same response on retry', async () => {
  const payload = {
    prompt: 'Hello world',
    input_tokens: 100,
    cached_input_tokens: 10,
    output_tokens: 50,
    reasoning_tokens: 5,
  };

  const firstResponse = await request(app)
    .post('/generate')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', IDENTITY_KEY)
    .send(payload);

  const secondResponse = await request(app)
    .post('/generate')
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', IDENTITY_KEY)
    .send(payload);

  expect(firstResponse.status).toBe(201);
  expect(firstResponse.body.idempotent).toBe(false);
  expect(secondResponse.status).toBe(200);
  expect(secondResponse.body.idempotent).toBe(true);
  expect(secondResponse.body.cost_microcents).toBe(firstResponse.body.cost_microcents);

  const countResult = await db.query(
    'SELECT COUNT(*) FROM usage_events WHERE idempotency_key = $1',
    [IDENTITY_KEY]
  );
  expect(parseInt(countResult.rows[0].count, 10)).toBe(1);

  const usageResponse = await request(app)
    .get('/usage')
    .set('Authorization', `Bearer ${token}`);

  expect(usageResponse.status).toBe(200);
  expect(usageResponse.body.usage.api_calls.used).toBe(1);
  expect(usageResponse.body.usage.ai_tokens.used).toBe(165);
  expect(usageResponse.body.total_cost_microcents).toBe(firstResponse.body.cost_microcents);
});

test('generate rejects a request when the tenant is already at quota', async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [REJECT_TENANT_ID]);

  for (let i = 0; i < 1000; i++) {
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
        cost_microcents
      )
      VALUES ($1, 'generate', 1, $2, 100, 0, 50, 0, 450)
    `, [REJECT_TENANT_ID, `generate-reject-fill-${i}`]);
  }

  const response = await request(app)
    .post('/generate')
    .set('Authorization', `Bearer ${rejectToken}`)
    .set('Idempotency-Key', `generate-reject-${Date.now()}`)
    .send({
      prompt: 'Quota check',
      input_tokens: 100,
      cached_input_tokens: 0,
      output_tokens: 50,
      reasoning_tokens: 0,
    });

  expect(response.status).toBe(429);
  expect(response.body.error).toBe('API call quota exceeded');
  expect(response.body.message).toContain('Upgrade to Pro');
});