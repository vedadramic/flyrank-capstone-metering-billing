const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db = require('../db');

const router = express.Router();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    await db.query(
      'INSERT INTO processed_webhook_events (stripe_event_id) VALUES ($1)',
      [event.id]
    );
  } catch (err) {
    if (err.code === '23505') {
      console.log(`Duplicate webhook event ignored: ${event.id}`);
      return res.json({ received: true, duplicate: true });
    }
    throw err;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const tenantId = session.metadata?.tenant_id;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (tenantId) {
        await db.query(`
          UPDATE tenants SET
            plan_id = (SELECT id FROM plans WHERE name = 'pro'),
            stripe_customer_id = $2,
            stripe_subscription_id = $3,
            subscription_status = 'active'
          WHERE id = $1
        `, [tenantId, customerId, subscriptionId]);

        console.log(`Tenant ${tenantId} upgraded to Pro`);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const status = subscription.status;
      const customerId = subscription.customer;

      await db.query(`
        UPDATE tenants SET subscription_status = $1
        WHERE stripe_customer_id = $2
      `, [status, customerId]);

      console.log(`Subscription updated for customer ${customerId}: ${status}`);
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;

      await db.query(`
        UPDATE tenants SET
          plan_id = (SELECT id FROM plans WHERE name = 'free'),
          stripe_subscription_id = NULL,
          subscription_status = 'canceled'
        WHERE stripe_customer_id = $1
      `, [customerId]);

      console.log(`Subscription canceled for customer ${customerId}`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;