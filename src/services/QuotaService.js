const db = require('../db');

async function check(tenantId, eventType, quantity) {
  const tenantResult = await db.query(`
    SELECT t.*, p.name as plan_name, p.api_calls_limit, p.ai_tokens_limit
    FROM tenants t
    JOIN plans p ON t.plan_id = p.id
    WHERE t.id = $1
  `, [tenantId]);

  const tenant = tenantResult.rows[0];

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  let usageSql;
  if (eventType === 'api_call') {
    usageSql = `
      SELECT COALESCE(SUM(quantity), 0) as used
      FROM usage_events
      WHERE tenant_id = $1
        AND created_at >= date_trunc('month', NOW())
        AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
    `;
  } else if (eventType === 'ai_token') {
    usageSql = `
      SELECT COALESCE(SUM(input_tokens + cached_input_tokens + output_tokens + reasoning_tokens), 0) as used
      FROM usage_events
      WHERE tenant_id = $1
        AND created_at >= date_trunc('month', NOW())
        AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
    `;
  } else {
    throw new Error(`Unknown event type: ${eventType}`);
  }

  const usageResult = await db.query(usageSql, [tenantId]);

  const currentUsage = parseInt(usageResult.rows[0].used, 10);

  let limit;
  if (eventType === 'api_call') {
    limit = tenant.api_calls_limit;
  } else if (eventType === 'ai_token') {
    limit = tenant.ai_tokens_limit;
  } else {
    throw new Error(`Unknown event type: ${eventType}`);
  }

  const wouldExceed = currentUsage + quantity > limit;

  return {
    allowed: !wouldExceed,
    current_usage: currentUsage,
    limit,
    requested: quantity,
    remaining: Math.max(0, limit - currentUsage),
    plan: tenant.plan_name,
  };
}

module.exports = { check };
