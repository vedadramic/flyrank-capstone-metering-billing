const db = require('../db');
const { PRICING } = require('../config/pricing');

function calculateCost(tokens) {
  const inputCost = (tokens.input_tokens || 0) * PRICING.input_token;
  const cachedCost = (tokens.cached_input_tokens || 0) * PRICING.cached_input_token;
  const outputCost = (tokens.output_tokens || 0) * PRICING.output_token;
  const reasoningCost = (tokens.reasoning_tokens || 0) * PRICING.reasoning_token;
  const totalCost = inputCost + cachedCost + outputCost + reasoningCost;
  return Math.round(totalCost * 1000000);
}

async function record(tenantId, eventType, quantity, idempotencyKey, tokens = {}) {
  const costMicrocents = calculateCost(tokens);

  try {
    const result = await db.query(`
      INSERT INTO usage_events
        (tenant_id, event_type, quantity, idempotency_key,
         input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, cost_microcents)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      tenantId,
      eventType,
      quantity,
      idempotencyKey,
      tokens.input_tokens || 0,
      tokens.cached_input_tokens || 0,
      tokens.output_tokens || 0,
      tokens.reasoning_tokens || 0,
      costMicrocents,
    ]);

    return { created: true, event: result.rows[0] };
  } catch (err) {
    if (err.code === '23505') {
      const existing = await db.query(
        'SELECT * FROM usage_events WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      return { created: false, event: existing.rows[0] };
    }
    throw err;
  }
}

async function findByIdempotencyKey(idempotencyKey) {
  const result = await db.query(
    'SELECT * FROM usage_events WHERE idempotency_key = $1',
    [idempotencyKey]
  );

  return result.rows[0] || null;
}

async function getMonthlyUsage(tenantId) {
  const result = await db.query(`
    SELECT
      COALESCE(SUM(quantity), 0) as api_calls_used,
      COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as ai_tokens_used,
      COALESCE(SUM(cost_microcents), 0) as total_cost_microcents
    FROM usage_events
    WHERE tenant_id = $1
      AND created_at >= date_trunc('month', NOW())
  `, [tenantId]);

  return result.rows;
}

module.exports = { record, findByIdempotencyKey, getMonthlyUsage, calculateCost };