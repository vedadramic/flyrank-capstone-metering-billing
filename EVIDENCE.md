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

## Proof by checkpoint

### Metering
- Billable action creates exactly one usage event: `src/tests/generate.test.js` passed `generate creates one usage event and returns the same response on retry` and the `SELECT COUNT(*) FROM usage_events WHERE idempotency_key = ...` assertion returned `1`.
- Duplicate idempotency key returns original result: `src/tests/generate.test.js` passed the retry case with `idempotent: true` and matching `cost_microcents`.
- Test proves double-counting cannot happen: `src/tests/meter.test.js` passed `idempotency: same key returns original event without creating duplicate`.

### Quotas
- Usage checked against tenant plan before action: `src/tests/generate.test.js` passed `generate rejects a request when the tenant is already at quota` with `response.status === 429`.
- Over-limit requests return 429/402 with clear message: the same test returned `API call quota exceeded` and a message containing `Upgrade to Pro`.
- Boundary behavior tested (at/just under/over limit): `src/tests/quota.test.js` passed `allows usage under the limit`, `allows usage at exactly one under the limit`, `blocks usage exactly at the limit`, and `blocks usage over the limit`.

### Cost Calculation
- Monthly usage rolls up to cost per tenant: `src/tests/generate.test.js` passed `GET /usage` assertions and `usageResponse.body.total_cost_microcents` matched the generated event cost.
- Cached input tokens priced cheaper: `src/tests/meter.test.js` passed `cached input tokens are cheaper than regular input tokens`.
- Reasoning tokens counted as output tokens: `src/tests/meter.test.js` passed `reasoning tokens cost same as output tokens`.
- Pricing constants pinned in config: `src/config/pricing.js` contains the fixed pricing values used by the tests.

### Stripe Integration
- Test Checkout flow works end-to-end: `src/tests/checkout.test.js` passed `creates a Stripe checkout session for the authenticated tenant` and asserted the mocked Stripe session response.
- Webhook verifies signature (forged → 400): `src/tests/webhook.test.js` passed `rejects webhook with invalid signature`.
- Duplicate webhook ignored: `src/tests/webhook.test.js` passed the replay case and returned `duplicate: true`.
- Tenant plan updated via webhook: `src/tests/webhook.test.js` verified the tenant and subscription rows changed to `pro` and `active`.

### Data & Tests
- Schema has tenants, plans, subscriptions, usage_events: `src/scripts/migrate.js` creates all four tables, and `npm test` prints `Migration complete` before the suite runs.
- All tests green: `npm test` finished with `Test Suites: 5 passed, 5 total` and `Tests: 14 passed, 14 total`.
- README complete with architecture diagram: [README.md](README.md) includes the architecture sketch, run steps, limitations, and test command.