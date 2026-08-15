const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const db = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const TENANT_IDS = [7701, 7702, 7703];

function tokenFor(tenantId) {
  return jwt.sign(
    { tenantId, email: `generate-${tenantId}@example.com` },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function generate(tenantId, idempotencyKey, payload = {}) {
  return request(app)
    .post('/generate')
    .set('Authorization', `Bearer ${tokenFor(tenantId)}`)
    .set('Idempotency-Key', idempotencyKey)
    .send({
      prompt: 'Hello world',
      input_tokens: 100,
      cached_input_tokens: 10,
      output_tokens: 50,
      reasoning_tokens: 5,
      ...payload,
    });
}

async function addApiUsage(tenantId, quantity, key) {
  await db.query(`
    INSERT INTO usage_events (
      tenant_id,
      event_type,
      quantity,
      idempotency_key,
      request_hash,
      response_json
    )
    VALUES ($1, 'generate', $2, $3, $4, '{}'::jsonb)
  `, [tenantId, quantity, key, `setup-${key}`]);
}

beforeAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = ANY($1)', [TENANT_IDS]);
  await db.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1)', [TENANT_IDS]);
  await db.query('DELETE FROM tenants WHERE id = ANY($1)', [TENANT_IDS]);

  for (const tenantId of TENANT_IDS) {
    await db.query(`
      INSERT INTO tenants (id, email, password_hash, plan_id, subscription_status)
      VALUES ($1, $2, 'hash', (SELECT id FROM plans WHERE name = 'free'), 'active')
    `, [tenantId, `generate-${tenantId}@example.com`]);
  }
});

beforeEach(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = ANY($1)', [TENANT_IDS]);
  await db.query(`
    UPDATE tenants
    SET plan_id = (SELECT id FROM plans WHERE name = 'free'), subscription_status = 'active'
    WHERE id = ANY($1)
  `, [TENANT_IDS]);
});

afterAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = ANY($1)', [TENANT_IDS]);
  await db.query('DELETE FROM subscriptions WHERE tenant_id = ANY($1)', [TENANT_IDS]);
  await db.query('DELETE FROM tenants WHERE id = ANY($1)', [TENANT_IDS]);
  await db.end();
});

test('an identical retry returns the original response and creates one event', async () => {
  const key = 'generate-identical-retry';
  const first = await generate(TENANT_IDS[0], key);
  const retry = await generate(TENANT_IDS[0], key);

  expect(first.status).toBe(201);
  expect(retry.status).toBe(201);
  expect(retry.body).toEqual(first.body);
  expect(retry.headers['idempotency-replayed']).toBe('true');

  const count = await db.query(`
    SELECT COUNT(*) FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2
  `, [TENANT_IDS[0], key]);
  expect(Number(count.rows[0].count)).toBe(1);
});

test('the same key with a different payload returns 409 without another event', async () => {
  const key = 'generate-payload-conflict';
  const first = await generate(TENANT_IDS[0], key, { prompt: 'Original prompt' });
  const conflict = await generate(TENANT_IDS[0], key, { prompt: 'Different prompt' });

  expect(first.status).toBe(201);
  expect(conflict.status).toBe(409);
  expect(conflict.body.error).toContain('different request payload');

  const count = await db.query(`
    SELECT COUNT(*) FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2
  `, [TENANT_IDS[0], key]);
  expect(Number(count.rows[0].count)).toBe(1);
});

test('idempotency keys are isolated per tenant', async () => {
  const key = 'shared-tenant-key';
  const tenantA = await generate(TENANT_IDS[0], key, { prompt: 'Tenant A prompt' });
  const tenantB = await generate(TENANT_IDS[1], key, { prompt: 'Tenant B prompt' });

  expect(tenantA.status).toBe(201);
  expect(tenantB.status).toBe(201);
  expect(tenantA.body.result).toContain('Tenant A prompt');
  expect(tenantB.body.result).toContain('Tenant B prompt');

  const events = await db.query(`
    SELECT tenant_id FROM usage_events WHERE idempotency_key = $1 ORDER BY tenant_id
  `, [key]);
  expect(events.rows.map(row => row.tenant_id)).toEqual([TENANT_IDS[0], TENANT_IDS[1]]);
});

test('the request that reaches exactly 1000 is allowed and the next returns 429', async () => {
  await addApiUsage(TENANT_IDS[0], 999, 'boundary-999');

  const boundary = await generate(TENANT_IDS[0], 'boundary-1000', {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
  });
  const over = await generate(TENANT_IDS[0], 'boundary-over', {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
  });

  expect(boundary.status).toBe(201);
  expect(over.status).toBe(429);
  expect(over.headers['retry-after']).toBe('3600');
  expect(over.body.message).toContain('1000 API calls monthly limit');
});

test('parallel requests at 999 cannot take usage above the quota', async () => {
  await addApiUsage(TENANT_IDS[0], 999, 'parallel-999');
  const payload = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
  };

  const responses = await Promise.all([
    generate(TENANT_IDS[0], 'parallel-a', payload),
    generate(TENANT_IDS[0], 'parallel-b', payload),
  ]);

  expect(responses.map(response => response.status).sort()).toEqual([201, 429]);

  const usage = await db.query(`
    SELECT SUM(quantity)::integer AS used FROM usage_events WHERE tenant_id = $1
  `, [TENANT_IDS[0]]);
  expect(usage.rows[0].used).toBe(1000);
});

test('a request that would cross the token limit returns 429', async () => {
  const response = await generate(TENANT_IDS[0], 'token-over-limit', {
    input_tokens: 100001,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
  });

  expect(response.status).toBe(429);
  expect(response.body.error).toBe('AI tokens quota exceeded');
});

test('a past-due subscription returns 402 and records no usage', async () => {
  await db.query(`
    UPDATE tenants SET subscription_status = 'past_due' WHERE id = $1
  `, [TENANT_IDS[0]]);

  const response = await generate(TENANT_IDS[0], 'payment-required');

  expect(response.status).toBe(402);
  expect(response.body.message).toContain('past_due');

  const count = await db.query('SELECT COUNT(*) FROM usage_events WHERE tenant_id = $1', [TENANT_IDS[0]]);
  expect(Number(count.rows[0].count)).toBe(0);
});
