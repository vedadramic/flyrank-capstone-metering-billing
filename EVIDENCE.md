# Evidence — Definition of Done

## Metering
- [ ] Billable action creates exactly one usage event
- [ ] Duplicate idempotency key returns original result
- [ ] Test proves double-counting cannot happen

## Quotas
- [ ] Usage checked against tenant plan before action
- [ ] Over-limit requests return 429/402 with clear message
- [ ] Boundary behavior tested (at/just under/over limit)

## Cost Calculation
- [ ] Monthly usage rolls up to cost per tenant
- [ ] Cached input tokens priced cheaper
- [ ] Reasoning tokens counted as output tokens
- [ ] Pricing constants pinned in config

## Stripe Integration
- [ ] Test Checkout flow works end-to-end
- [ ] Webhook verifies signature (forged → 400)
- [ ] Duplicate webhook ignored
- [ ] Tenant plan updated via webhook

## Data & Tests
- [ ] Schema has tenants, plans, subscriptions, usage_events
- [ ] All tests green
- [ ] README complete with architecture diagram

---