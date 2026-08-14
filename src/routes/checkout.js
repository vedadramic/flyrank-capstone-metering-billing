const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { requireAuth } = require('../middleware/auth');
const { PLANS } = require('../config/pricing');

const router = express.Router();

router.post('/create-session', requireAuth, async (req, res) => {
  if (!PLANS.pro.stripe_price_id) {
    return res.status(400).json({ error: 'Stripe not configured — add STRIPE_PRO_PRICE_ID to .env' });
  }

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{
      price: PLANS.pro.stripe_price_id,
      quantity: 1,
    }],
    success_url: 'http://localhost:3000/checkout/success',
    cancel_url: 'http://localhost:3000/checkout/cancel',
    metadata: { tenant_id: req.tenantId.toString() },
  });

  res.json({ url: session.url, session_id: session.id });
});

router.get('/success', (req, res) => {
  res.json({ message: 'Checkout successful! Your plan will be upgraded shortly.' });
});

router.get('/cancel', (req, res) => {
  res.json({ message: 'Checkout cancelled.' });
});

module.exports = router;