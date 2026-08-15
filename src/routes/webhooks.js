const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const WebhookJobService = require('../services/WebhookJobService');

const router = express.Router();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.livemode === true) {
    return res.status(400).json({ error: 'Live-mode Stripe events are not accepted' });
  }

  const result = await WebhookJobService.enqueueStripeEvent(event);
  if (!result.created) {
    return res.json({
      received: true,
      duplicate: true,
      status: result.job.status,
    });
  }

  return res.status(202).json({ received: true, queued: true });
});

module.exports = router;
