const QuotaService = require('../services/QuotaService');
const db = require('../db');

const TENANT_ID = 8801;

async function setUsage(quantity) {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  if (quantity === 0) {
    return;
  }

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
  `, [TENANT_ID, quantity, `quota-${quantity}`, `setup-${quantity}`]);
}

beforeAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID]);
  await db.query(`
    INSERT INTO tenants (id, email, password_hash, plan_id)
    VALUES ($1, 'quota-test@example.com', 'hash', (SELECT id FROM plans WHERE name = 'free'))
  `, [TENANT_ID]);
});

afterAll(async () => {
  await db.query('DELETE FROM usage_events WHERE tenant_id = $1', [TENANT_ID]);
  await db.query('DELETE FROM tenants WHERE id = $1', [TENANT_ID]);
  await db.end();
});

test.each([
  [0, 1, true],
  [999, 1, true],
  [1000, 1, false],
  [1000, 2, false],
])('with %i used and %i requested, allowed is %s', async (used, requested, allowed) => {
  await setUsage(used);
  const result = await QuotaService.check(TENANT_ID, 'api_call', requested);
  expect(result.allowed).toBe(allowed);
  expect(result.current_usage).toBe(used);
});
