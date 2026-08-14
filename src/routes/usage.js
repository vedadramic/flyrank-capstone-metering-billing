const express = require('express');
const { requireAuth } = require('../middleware/auth');
const MeterService = require('../services/MeterService');
const db = require('../db');

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
  const usageTotals = usageRows[0] || { api_calls_used: '0', ai_tokens_used: '0', total_cost_microcents: '0' };

  const apiCallsUsed = parseInt(usageTotals.api_calls_used, 10);
  const aiTokensUsed = parseInt(usageTotals.ai_tokens_used, 10);
  const totalCostMicrocents = parseInt(usageTotals.total_cost_microcents, 10);

  const usage = {
    api_calls: { used: apiCallsUsed, limit: tenant.api_calls_limit, cost_microcents: totalCostMicrocents },
    ai_tokens: { used: aiTokensUsed, limit: tenant.ai_tokens_limit, cost_microcents: totalCostMicrocents },
  };

  res.json({
    tenant: { email: tenant.email, plan: tenant.plan_name },
    usage,
    total_cost_usd: (totalCostMicrocents / 1000000).toFixed(6),
    total_cost_microcents: totalCostMicrocents,
  });
});

module.exports = router;