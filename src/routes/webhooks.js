const express = require('express');

const router = express.Router();

router.post('/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  res.json({ received: true, message: 'Stripe webhook handler coming in Phase 3' });
});

module.exports = router;