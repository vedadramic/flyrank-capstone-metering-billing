# Evidence — Definition of Done

Evidence was regenerated during finalization on 2026-08-15. A checked box below has a code, test, or terminal proof. The real Stripe Checkout box remains unchecked until the manual test-mode flow is completed.

## Core checklist

- [x] A billable action creates exactly one usage event under retries.
  - `src/tests/generate.test.js`: `an identical retry returns the original response and creates one event` sends two HTTP requests, compares the full response, checks `Idempotency-Replayed: true`, and queries a row count of `1`.
  - The unique index is `(tenant_id, idempotency_key)`, not a global key.

- [x] A test proves double-counting cannot happen.
  - The identical retry test above proves sequential retries.
  - `parallel requests at 999 cannot take usage above the quota` sends two requests concurrently and proves the statuses are `[201, 429]` and stored usage is exactly `1000`.

- [x] Usage is checked against the tenant plan and over-limit requests are rejected.
  - `the request that reaches exactly 1000 is allowed and the next returns 429` proves the documented boundary through the real HTTP route.
  - `a request that would cross the token limit returns 429` proves the second quota.

- [x] Responses use `429` and `402` with clear messages.
  - The boundary test checks `429`, `Retry-After: 3600`, and a message containing the `1000 API calls monthly limit`.
  - `a past-due subscription returns 402 and records no usage` checks the status, message, and zero inserted events.

- [x] Monthly usage rolls up into a tenant cost.
  - `src/tests/usage.test.js`: `GET /usage returns the current monthly rollup, limits, and exact USD conversion` inserts current- and previous-month rows, excludes the old row, and proves `3450` microcents equals the exact string `0.00003450` USD.

- [x] Cached input, reasoning, and output token pricing is correct.
  - `src/tests/meter.test.js` pins one-token results: input `300`, cached input `150`, output `1500`, reasoning `1500` microcents.
  - `all token categories are added with integer math` proves the combined total is `3450`.

- [x] Pricing constants are pinned and covered by tests.
  - `src/config/pricing.js` contains only integer `PRICING_MICROCENTS` constants and `MICROCENTS_PER_USD = 100000000`.
  - The pricing tests above use exact equality, not approximate floating-point comparisons.

- [ ] Subscription checkout works end-to-end in Stripe test mode.
  - Automated proof only: `src/tests/checkout.test.js` proves the authenticated route sends subscription mode, the configured price, and tenant metadata to a mocked Stripe client.
  - Not yet claimed: a browser Checkout using `4242 4242 4242 4242` and a real Stripe CLI webhook must still flip `demo@example.com` from Free to Pro.

- [x] Webhooks verify signatures, deduplicate events, and update plan/status.
  - `a forged signature returns 400 and changes nothing` also proves no job is inserted.
  - `a signed live-mode event is rejected before it can be queued` enforces test mode.
  - `a signed event is queued once and marked completed only after tenant changes commit` proves duplicate enqueue prevention and one processing attempt.
  - `subscription updated and deleted events synchronize plan and status` proves Pro/past-due and Free/canceled transitions in PostgreSQL.

- [x] The schema contains plans, tenants, subscriptions, usage events, isolated tenant keys, and indexes.
  - `npm run migrate` returned `Migration complete`.
  - `src/scripts/migrate.js` creates the four core tables plus `background_jobs`, the composite idempotency unique index, tenant/month index, job-ready index, and unique Stripe lookup indexes.
  - `idempotency keys are isolated per tenant` uses the same key for two tenants with different prompts and proves each receives only its own result.

- [x] Tests cover the required scary cases.
  - `npm test` result: `Test Suites: 6 passed, 6 total`; `Tests: 25 passed, 25 total`; `Time: 2.117 s`.
  - Coverage includes retries, payload conflict, tenant isolation, 999/1000/over, concurrent quota requests, all token prices, monthly rollup, forged/live/duplicate webhooks, safe retry, terminal failure, updated, and deleted.

- [x] README, architecture, setup, and submission-pack files are present.
  - `README.md` contains the architecture sketch, exact Docker run/seed commands, endpoints, Stripe procedure, six-minute demo, security, and honest limitations.
  - Required files present: `README.md`, `capstone.yaml`, `EVIDENCE.md`, `BUILDLOG.md`, `.env.example`; `DESIGN.md`, `LICENSE`, `Dockerfile`, and `compose.yaml` are also present.

## Acceptance probes

| Probe | Status | Evidence |
|---|---|---|
| 1 — identical billable retry creates one event | Pass | `an identical retry returns the original response and creates one event` |
| 2 — exact quota boundary then clear refusal | Pass | exact 1,000 test plus concurrent 999 test |
| 3 — real Stripe Checkout flips Free to Pro | Pending manual | mocked session creation and real webhook logic pass; browser/Stripe CLI run not yet performed |
| 4 — forged webhook rejected; replay processed once | Partial | forged `400` and signed duplicate job tests pass; a replay of an actual Stripe CLI event remains part of the manual run |
| 5 — pinned pricing and `/usage` match | Pass | exact integer pricing tests plus current-month `/usage` test |

`npm run test:acceptance` result: `Test Suites: 5 passed, 5 total`; `Tests: 21 passed, 21 total`; `Time: 2.026 s`.

## Shared requirements and runtime proof

- Layering: HTTP routes call `MeterService` and `WebhookJobService`; SQL-backed logic is outside route handlers.
- Boundary validation: Zod rejects bad `/generate` and signup payloads with clean `400` responses.
- Background job: verified Stripe events run off the request path in `background_jobs`; tests prove retry, completion-after-commit, terminal `failed`, and the `ALERT:` failure log.
- Persistence: PostgreSQL migration, constraints, and indexes are exercised before every Jest run.
- Secrets: `.env` is ignored and excluded by `.dockerignore`; JWT has no fallback; live Stripe events return `400`.
- Docker run: `docker compose up -d --build` built the Node image, reported PostgreSQL `healthy`, and reported the app `Up` on port `3000`.
- Container startup log: `Migration complete` then `Billing engine running on http://localhost:3000`.
- Health probe: `GET /health` returned `{"status":"ok"}`.
- Seed command: `npm run seed` completed, and a direct rollup query returned `demo@example.com = 0` and `near-limit@example.com = 999` API calls on Free.
