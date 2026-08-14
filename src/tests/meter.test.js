const MeterService = require('../services/MeterService');
const db = require('../db');

const TEST_TENANT_ID = 9999;
const BASE_KEY = `test-${Date.now()}`;

beforeAll(async () => {
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, $2, $3, 1)
    ON CONFLICT (id) DO NOTHING
  `, [TEST_TENANT_ID, `test-${Date.now()}@test.com`, 'hash']);
});

afterAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TEST_TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TEST_TENANT_ID]);
  await db.end();
});

test('records a usage event', async () => {
  const key = `${BASE_KEY}-record`;
  const result = await MeterService.record(TEST_TENANT_ID, 'api_call', 1, key);
  expect(result.created).toBe(true);
  expect(result.event.quantity).toBe(1);
});

test('idempotency: same key returns original event without creating duplicate', async () => {
  const key = `${BASE_KEY}-idempotent`;
  const first = await MeterService.record(TEST_TENANT_ID, 'api_call', 1, key);
  const second = await MeterService.record(TEST_TENANT_ID, 'api_call', 1, key);

  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(second.event.id).toBe(first.event.id);

  const countResult = await db.query(
    'SELECT COUNT(*) FROM usage_events WHERE idempotency_key = $1',
    [key]
  );
  expect(parseInt(countResult.rows[0].count, 10)).toBe(1);
});

test('calculates token cost correctly', () => {
  const cost = MeterService.calculateCost({
    input_tokens: 1000,
    cached_input_tokens: 500,
    output_tokens: 200,
    reasoning_tokens: 100,
  });

  const expected = Math.round(
    (1000 * 0.000003 + 500 * 0.0000015 + 200 * 0.000015 + 100 * 0.000015) * 1000000
  );
  expect(cost).toBe(expected);
});

test('cached input tokens are cheaper than regular input tokens', () => {
  const regularCost = MeterService.calculateCost({ input_tokens: 1000 });
  const cachedCost = MeterService.calculateCost({ cached_input_tokens: 1000 });
  expect(cachedCost).toBeLessThan(regularCost);
});

test('reasoning tokens cost same as output tokens', () => {
  const outputCost = MeterService.calculateCost({ output_tokens: 1000 });
  const reasoningCost = MeterService.calculateCost({ reasoning_tokens: 1000 });
  expect(reasoningCost).toBe(outputCost);
});