const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/auth');
const MeterService = require('../services/MeterService');

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

  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 255) {
    return res.status(400).json({ error: 'Idempotency-Key header is required and must be at most 255 characters' });
  }

  const parsed = GenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
  }

  const result = await MeterService.recordGenerateUsage(
    req.tenantId,
    idempotencyKey,
    parsed.data
  );

  if (result.outcome === 'tenant_not_found') {
    return res.status(401).json({ error: 'Authenticated tenant no longer exists' });
  }

  if (result.outcome === 'idempotency_conflict') {
    return res.status(409).json({
      error: 'Idempotency-Key was already used with a different request payload',
    });
  }

  if (result.outcome === 'payment_required') {
    return res.status(402).json({
      error: 'Payment required',
      message: `Subscription status is ${result.status}. Update payment details before making billable requests.`,
    });
  }

  if (result.outcome === 'quota_exceeded') {
    res.set('Retry-After', '3600');
    return res.status(429).json({
      error: `${result.resource} quota exceeded`,
      usage: {
        used: result.used,
        limit: result.limit,
        requested: result.requested,
        remaining: Math.max(0, result.limit - result.used),
      },
      message: `This request would exceed the ${result.limit} ${result.resource} monthly limit on the ${result.plan} plan.`,
    });
  }

  if (result.outcome === 'replayed') {
    res.set('Idempotency-Replayed', 'true');
  }

  return res.status(201).json(result.response);
});

module.exports = router;
