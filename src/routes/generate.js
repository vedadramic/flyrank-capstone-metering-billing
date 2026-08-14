const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const MeterService = require('../services/MeterService');
const QuotaService = require('../services/QuotaService');

const router = express.Router();

const GenerateSchema = z.object({
  prompt: z.string().min(1),
  input_tokens: z.number().int().min(0).default(100),
  cached_input_tokens: z.number().int().min(0).default(0),
  output_tokens: z.number().int().min(0).default(50),
  reasoning_tokens: z.number().int().min(0).default(0),
});

router.post('/', requireAuth, async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  const parsed = GenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
  }

  const { prompt, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens } = parsed.data;
  const totalTokens = input_tokens + cached_input_tokens + output_tokens + reasoning_tokens;

  const existingEvent = await MeterService.findByIdempotencyKey(idempotencyKey);
  if (existingEvent) {
    return res.status(200).json({
      result: `Simulated AI response to: "${prompt}"`,
      usage: {
        input_tokens: existingEvent.input_tokens,
        cached_input_tokens: existingEvent.cached_input_tokens,
        output_tokens: existingEvent.output_tokens,
        reasoning_tokens: existingEvent.reasoning_tokens,
        total_tokens: existingEvent.input_tokens + existingEvent.cached_input_tokens + existingEvent.output_tokens + existingEvent.reasoning_tokens,
      },
      cost_microcents: existingEvent.cost_microcents,
      idempotent: true,
    });
  }

  const apiQuota = await QuotaService.check(req.tenantId, 'api_call', 1);
  if (!apiQuota.allowed) {
    return res.status(429).json({
      error: 'API call quota exceeded',
      usage: { used: apiQuota.current_usage, limit: apiQuota.limit, remaining: 0 },
      message: `You have used ${apiQuota.current_usage} of ${apiQuota.limit} API calls this month. Upgrade to Pro for higher limits.`,
    });
  }

  const tokenQuota = await QuotaService.check(req.tenantId, 'ai_token', totalTokens);
  if (!tokenQuota.allowed) {
    return res.status(429).json({
      error: 'AI token quota exceeded',
      usage: { used: tokenQuota.current_usage, limit: tokenQuota.limit, remaining: tokenQuota.remaining },
      message: `You have used ${tokenQuota.current_usage} of ${tokenQuota.limit} AI tokens this month.`,
    });
  }

  const tokens = { input_tokens, cached_input_tokens, output_tokens, reasoning_tokens };

  const apiResult = await MeterService.record(req.tenantId, 'generate', 1, idempotencyKey, tokens);

  const response = {
    result: `Simulated AI response to: "${prompt}"`,
    usage: {
      input_tokens,
      cached_input_tokens,
      output_tokens,
      reasoning_tokens,
      total_tokens: totalTokens,
    },
    cost_microcents: apiResult.event.cost_microcents,
    idempotent: !apiResult.created,
  };

  res.status(apiResult.created ? 201 : 200).json(response);
});

module.exports = router;