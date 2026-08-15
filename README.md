# flyrank-capstone-metering-billing

A small multi-tenant Usage Metering & Billing Engine. It records billable requests exactly once, enforces plan quotas under concurrency, calculates AI-token cost with integer money math, and mirrors Stripe test-mode subscriptions through verified background-processed webhooks.

## Architecture

```text
Client
  ├─ POST /generate ─ auth + validation
  │    └─ tenant-locked PostgreSQL transaction
  │         ├─ tenant-scoped idempotency + payload hash
  │         ├─ payment and quota checks
  │         └─ usage_events insert
  ├─ GET /usage ─ current-month tenant rollup
  └─ POST /checkout/create-session ─ Stripe test Checkout

Stripe CLI ─ signed raw webhook ─► POST /webhooks/stripe
                                      └─ background_jobs (deduplicated event ID)
                                           └─ worker retry
                                                └─ tenant/subscription update
                                                   + job completion in one transaction
```

The detailed design and transaction decisions are in [DESIGN.md](DESIGN.md).

## Plans and boundary rule

| Plan | API calls/month | AI tokens/month |
|---|---:|---:|
| Free | 1,000 | 100,000 |
| Pro | 100,000 | 10,000,000 |

Usage equal to the limit is allowed. A request that would move usage above the limit returns `429 Too Many Requests` with `Retry-After` and a clear message. A billable request for an `incomplete`, `past_due`, `paused`, or `unpaid` subscription returns `402 Payment Required`.

## Setup and one-command run

Requirements: Docker Desktop, Docker Compose, and Node.js 20.6 or newer.

1. Copy `.env.example` to `.env`.
2. Replace `JWT_SECRET` with a long random value. Keep every `.env` value local.
3. Stripe placeholders may remain for the core demo; replace them only with test-mode values before the Stripe flow below.
4. Start the database and application with the documented one-command run:

```bash
docker compose up -d --build
```

In another terminal, create deterministic demo data:

```bash
docker compose exec app npm run seed
```

The API is available at `http://localhost:3000`; `GET /health` returns `{"status":"ok"}`. The app container runs migrations before starting the API and the background worker.

For local development outside the app container:

```bash
npm ci
docker compose up -d db
npm run migrate
npm run seed
npm start
```

## Demo accounts

Running the seed resets these local accounts:

| Email | Password | State |
|---|---|---|
| `demo@example.com` | `password123` | Free, no usage |
| `near-limit@example.com` | `password123` | Free, 999 of 1,000 API calls |

The credentials are demo data only. Do not reuse them outside this local test project.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | No | Container/API health |
| POST | `/auth/signup` | No | Create a Free tenant |
| POST | `/auth/login` | No | Receive a 24-hour JWT |
| POST | `/generate` | Bearer JWT | Simulated billable action |
| GET | `/usage` | Bearer JWT | Current-month usage, limits, and cost |
| POST | `/checkout/create-session` | Bearer JWT | Create a Pro Stripe test Checkout |
| POST | `/webhooks/stripe` | Stripe signature | Queue a verified subscription event |

`POST /generate` requires `Idempotency-Key`. An identical retry returns the original status and body plus `Idempotency-Replayed: true`. Reusing the same tenant/key pair with a different validated payload returns `409 Conflict`. Different tenants may safely use the same key.

Example payload:

```json
{
  "prompt": "Demo request",
  "input_tokens": 100,
  "cached_input_tokens": 10,
  "output_tokens": 50,
  "reasoning_tokens": 5
}
```

## Pricing and units

Costs use integer microcents from request calculation through PostgreSQL storage:

| Category | Microcents/token | USD/token |
|---|---:|---:|
| Input | 300 | $0.00000300 |
| Cached input | 150 | $0.00000150 |
| Output | 1,500 | $0.00001500 |
| Reasoning | 1,500 | $0.00001500 |

One USD is 100,000,000 microcents. API calls are quota-metered but have no separate monetary price in this capstone; the cost rollup is the token cost. `GET /usage` returns both the integer microcent total and an exact eight-decimal USD string.

## Stripe test-mode setup

Never use live mode.

1. In the Stripe Dashboard with **Test mode** enabled, create a Pro product with a recurring monthly price.
2. Put the test values in the local `.env` only:
   - `STRIPE_SECRET_KEY` must start with `sk_test_`.
   - `STRIPE_PRO_PRICE_ID` is the recurring test `price_...` ID.
3. Install Stripe CLI, then run:

```bash
stripe login
stripe listen --forward-to localhost:3000/webhooks/stripe
```

4. Copy the local `whsec_...` printed by `stripe listen` into `STRIPE_WEBHOOK_SECRET` in `.env`, then restart the app.
5. Log in as `demo@example.com`, call `POST /checkout/create-session`, and open the returned URL.
6. Use test card `4242 4242 4242 4242`, any future expiry, and any CVC/postal code.
7. Wait about one second for the PostgreSQL worker, then call `GET /usage`. The tenant plan and limits should be Pro.

The webhook route uses the raw request body, verifies the Stripe signature, rejects `livemode: true`, and inserts one job per Stripe event ID. A job is not `completed` until its tenant/subscription changes commit. Failed jobs retry three times; terminal failures remain queryable with status `failed` and emit an `ALERT:` log line.

## Tests and acceptance probes

```bash
npm test
npm run test:acceptance
```

The deterministic suite covers tenant idempotency isolation, payload conflicts, identical retries, concurrent quota requests, 999/1,000/over boundaries, `402`, all integer pricing categories, monthly rollup, forged and live Stripe events, duplicate jobs, safe retry, terminal failure alert, and subscription update/deletion.

The automated Checkout test mocks Stripe's network call. A real test-mode Checkout remains a separate manual acceptance step and must not be claimed from that unit test alone.

## Six-minute demo

1. Seed and log in as `near-limit@example.com`; show `GET /usage` at 999/1,000.
2. Send one `/generate` request to reach 1,000. Retry the identical key and show no double count.
3. Send a new key and show the clear `429` response.
4. Log in as `demo@example.com`, complete Stripe test Checkout, and show Free changing to Pro through the webhook worker.
5. Send a forged signature and show `400`; show the duplicate-event automated test passing.
6. Finish with `/usage` and the pinned pricing tests.

## Security

- `.env`, JWT secret, Stripe keys, and webhook secrets are ignored and excluded from the Docker build context.
- JWT startup fails if `JWT_SECRET` is missing; there is no application fallback.
- Tenant IDs come from verified JWTs, not request bodies.
- Billable input is validated at the HTTP boundary.
- Stripe raw-body signatures are verified before persistence or state changes.
- Stripe live-mode events are rejected.

## Limitations

- Stripe test mode only; no real payments.
- Token counts are simulated; no model API is called.
- No invoices, overage billing, proration, reconciliation, or external alert service.
- The terminal job alert is a clear application log line, suitable for this single-service student project.
- PostgreSQL row locks serialize billing per tenant; this favors correctness over maximum per-tenant throughput.
