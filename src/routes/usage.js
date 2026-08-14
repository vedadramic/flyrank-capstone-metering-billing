const express = require('express');
const { requireAuth } = require('../middleware/auth');
const MeterService = require('../services/MeterService');
const db = require('../db');
const { PRICING } = require('../config/pricing');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const tenantResult = await db.query(`
    SELECT t.*, p.name as plan_name, p.api_calls_limit, p.ai_tokens_limit
    FROM tenants t
    JOIN plans p ON t.plan_id = p.id
    WHERE t.id = $1
  `, [req.tenantId]);

  const tenant = tenantResult.rows[0];
  const usageRows = await MeterService.getMonthlyUsage(req.tenantId);

  const usage = { api_calls: { used: 0, limit: tenant.api_calls_limit, cost_microcents: 0 },
    ai_tokens: { used: 0, limit: tenant.ai_tokens_limit, cost_microcents: 0 } };

  for (const row of usageRows) {
    if (row.event_type === 'api_call') {
      usage.api_calls.used = parseInt(row.total_quantity, 10);
      usage.api_calls.cost_microcents = parseInt(row.total_cost_microcents, 10);
    } else if (row.event_type === 'ai_token') {
      usage.ai_tokens.used = parseInt(row.total_quantity, 10);
      usage.ai_tokens.cost_microcents = parseInt(row.total_cost_microcents, 10);
    }
  }

  const totalCostMicrocents = usage.api_calls.cost_microcents + usage.ai_tokens.cost_microcents;

  res.json({
    tenant: { email: tenant.email, plan: tenant.plan_name },
    usage,
    total_cost_usd: (totalCostMicrocents / 1000000).toFixed(6),
    total_cost_microcents: totalCostMicrocents,
  });
});

module.exports = router;