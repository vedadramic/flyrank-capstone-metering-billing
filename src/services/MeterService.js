const crypto = require('crypto');
const db = require('../db');
const { PRICING } = require('../config/pricing');

const PAYMENT_BLOCKED_STATUSES = new Set([
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'unpaid',
]);

function calculateCost(tokens) {
  const inputCost = (tokens.input_tokens || 0) * PRICING.input_token;
  const cachedCost = (tokens.cached_input_tokens || 0) * PRICING.cached_input_token;
  const outputCost = (tokens.output_tokens || 0) * PRICING.output_token;
  const reasoningCost = (tokens.reasoning_tokens || 0) * PRICING.reasoning_token;
  const totalCost = inputCost + cachedCost + outputCost + reasoningCost;
  return Math.round(totalCost * 1000000);
}

function createRequestHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function createResponse(payload, costMicrocents) {
  const totalTokens = payload.input_tokens
    + payload.cached_input_tokens
    + payload.output_tokens
    + payload.reasoning_tokens;

  return {
    result: `Simulated AI response to: "${payload.prompt}"`,
    usage: {
      input_tokens: payload.input_tokens,
      cached_input_tokens: payload.cached_input_tokens,
      output_tokens: payload.output_tokens,
      reasoning_tokens: payload.reasoning_tokens,
      total_tokens: totalTokens,
    },
    cost_microcents: costMicrocents,
  };
}

async function recordGenerateUsage(tenantId, idempotencyKey, payload) {
  const client = await db.connect();
  const requestHash = createRequestHash(payload);
  const totalTokens = payload.input_tokens
    + payload.cached_input_tokens
    + payload.output_tokens
    + payload.reasoning_tokens;

  try {
    await client.query('BEGIN');

    const tenantResult = await client.query(`
      SELECT
        t.id,
        t.subscription_status,
        p.name AS plan_name,
        p.api_calls_limit,
        p.ai_tokens_limit
      FROM tenants t
      JOIN plans p ON p.id = t.plan_id
      WHERE t.id = $1
      FOR UPDATE OF t
    `, [tenantId]);

    const tenant = tenantResult.rows[0];
    if (!tenant) {
      await client.query('ROLLBACK');
      return { outcome: 'tenant_not_found' };
    }

    const existingResult = await client.query(`
      SELECT request_hash, response_json
      FROM usage_events
      WHERE tenant_id = $1 AND idempotency_key = $2
    `, [tenantId, idempotencyKey]);

    const existing = existingResult.rows[0];
    if (existing) {
      await client.query('COMMIT');

      if (existing.request_hash !== requestHash) {
        return { outcome: 'idempotency_conflict' };
      }

      return { outcome: 'replayed', response: existing.response_json };
    }

    if (PAYMENT_BLOCKED_STATUSES.has(tenant.subscription_status)) {
      await client.query('ROLLBACK');
      return {
        outcome: 'payment_required',
        status: tenant.subscription_status,
      };
    }

    const usageResult = await client.query(`
      SELECT
        COALESCE(SUM(quantity), 0)::bigint AS api_calls_used,
        COALESCE(SUM(
          input_tokens + cached_input_tokens + output_tokens + reasoning_tokens
        ), 0)::bigint AS ai_tokens_used
      FROM usage_events
      WHERE tenant_id = $1
        AND created_at >= date_trunc('month', NOW())
        AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
    `, [tenantId]);

    const apiCallsUsed = Number(usageResult.rows[0].api_calls_used);
    const aiTokensUsed = Number(usageResult.rows[0].ai_tokens_used);

    if (apiCallsUsed + 1 > tenant.api_calls_limit) {
      await client.query('ROLLBACK');
      return {
        outcome: 'quota_exceeded',
        resource: 'API calls',
        used: apiCallsUsed,
        limit: tenant.api_calls_limit,
        requested: 1,
        plan: tenant.plan_name,
      };
    }

    if (aiTokensUsed + totalTokens > tenant.ai_tokens_limit) {
      await client.query('ROLLBACK');
      return {
        outcome: 'quota_exceeded',
        resource: 'AI tokens',
        used: aiTokensUsed,
        limit: tenant.ai_tokens_limit,
        requested: totalTokens,
        plan: tenant.plan_name,
      };
    }

    const costMicrocents = calculateCost(payload);
    const response = createResponse(payload, costMicrocents);

    await client.query(`
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
        response_json
      )
      VALUES ($1, 'generate', 1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      tenantId,
      idempotencyKey,
      payload.input_tokens,
      payload.cached_input_tokens,
      payload.output_tokens,
      payload.reasoning_tokens,
      costMicrocents,
      requestHash,
      response,
    ]);

    await client.query('COMMIT');
    return { outcome: 'created', response };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
      AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
  `, [tenantId]);

  return result.rows;
}

module.exports = {
  calculateCost,
  createRequestHash,
  getMonthlyUsage,
  recordGenerateUsage,
};
