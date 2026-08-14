const QuotaService = require('../services/QuotaService');
const db = require('../db');

const TEST_TENANT_ID = 8888;
const BASE_KEY = `quota-test-${Date.now()}`;

beforeAll(async () => {
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, $2, $3, (SELECT id FROM plans WHERE name = 'free'))
    ON CONFLICT (id) DO NOTHING
  `, [TEST_TENANT_ID, `quota-test-${Date.now()}@test.com`, 'hash']);
});

afterAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TEST_TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TEST_TENANT_ID]);
  await db.end();
});

test('allows usage under the limit', async () => {
  const result = await QuotaService.check(TEST_TENANT_ID, 'api_call', 1);
  expect(result.allowed).toBe(true);
});

test('blocks usage exactly at the limit', async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TEST_TENANT_ID]);

  for (let i = 0; i < 1000; i++) {
    await db.query(`
      INSERT INTO usage_events (tenant_id, event_type, quantity, idempotency_key)
      VALUES ($1, 'api_call', 1, $2)
    `, [TEST_TENANT_ID, `${BASE_KEY}-fill-${i}`]);
  }

  const result = await QuotaService.check(TEST_TENANT_ID, 'api_call', 1);
  expect(result.allowed).toBe(false);
  expect(result.current_usage).toBe(1000);
  expect(result.limit).toBe(1000);
});

test('allows usage at exactly one under the limit', async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TEST_TENANT_ID]);

  for (let i = 0; i < 999; i++) {
    await db.query(`
      INSERT INTO usage_events (tenant_id, event_type, quantity, idempotency_key)
      VALUES ($1, 'api_call', 1, $2)
    `, [TEST_TENANT_ID, `${BASE_KEY}-under-${i}`]);
  }

  const result = await QuotaService.check(TEST_TENANT_ID, 'api_call', 1);
  expect(result.allowed).toBe(true);
  expect(result.remaining).toBe(1);
});

test('blocks usage over the limit', async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TEST_TENANT_ID]);

  for (let i = 0; i < 1000; i++) {
    await db.query(`
      INSERT INTO usage_events (tenant_id, event_type, quantity, idempotency_key)
      VALUES ($1, 'api_call', 1, $2)
    `, [TEST_TENANT_ID, `${BASE_KEY}-over-${i}`]);
  }

  const result = await QuotaService.check(TEST_TENANT_ID, 'api_call', 2);
  expect(result.allowed).toBe(false);
  expect(result.current_usage).toBe(1000);
  expect(result.requested).toBe(2);
  expect(result.remaining).toBe(0);
});