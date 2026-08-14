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

## Current proof

### Metering
- `npm test` passes `src/tests/meter.test.js`
- The idempotency test confirms the same key returns the same event id

### Quotas
- `npm test` passes `src/tests/quota.test.js`
- Boundary coverage exists for under-limit and exact-limit behavior

### Cost Calculation
- `MeterService.calculateCost()` is covered for cached input and reasoning token pricing

### Stripe Integration
- `src/tests/webhook.test.js` verifies forged webhook signatures return 400

### Data & Tests
- `npm test` passes in this workspace
- The local database URL stays on port 5433 in `.env.example` and `.env`