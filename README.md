# flyrank-capstone-metering-billing

Usage Metering & Billing Engine — the backend service that tracks how much customers use, enforces plan quotas, calculates costs, and integrates Stripe for subscription management.

---

## Architecture

Client │ ▼ POST /generate (billable endpoint) │ ├── MeterService.record(tenant, type, qty, idempotencyKey) │ ├── duplicate key? → return original (no new event) │ └── store usage_event in PostgreSQL │ └── QuotaService.check(tenant, type, qty) ├── under limit → allow └── over limit → 429 / 402 + clear message

GET /usage → rollup(usage_events) → { used, limit, cost }

Stripe Checkout → subscription created Stripe webhook → POST /webhooks/stripe ├── verify signature (forged → 400) ├── deduplicate event (replay → ignored) └── update tenant plan/status


---

## Plans

| Plan | API calls/month | AI tokens/month |
|------|----------------|-----------------|
| Free | 1,000 | 100,000 |
| Pro | 100,000 | 10,000,000 |

---

## How to run

**Requirements:** Docker Desktop, Node.js

```bash
git clone https://github.com/vedadramic/flyrank-capstone-metering-billing.git
cd flyrank-capstone-metering-billing
cp .env.example .env
# Fill in your Stripe test keys in .env
docker compose up -d
npm install
node src/scripts/migrate.js
node src/scripts/seed.js
npm start
```

---

## Key endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/signup` | No | Create tenant account |
| POST | `/auth/login` | No | Get JWT token |
| POST | `/generate` | Yes | Billable action (simulates AI call) |
| GET | `/usage` | Yes | Current usage, limits, and cost |
| POST | `/webhooks/stripe` | Stripe sig | Handle Stripe events |

---

## Idempotency

Send `Idempotency-Key: <unique-uuid>` header with POST /generate.
The same key + same request = one usage event only. Retries are safe.

---

## Pricing

cost = (input_tokens × $0.000003) + (cached_input_tokens × $0.0000015) + (output_tokens × $0.000015) + (reasoning_tokens × $0.000015)


Reasoning tokens are billed at the output rate. Cached input tokens are billed at half the input rate.

---

## Limitations

- Stripe test mode only — no real payments
- Token counts are simulated — no real AI calls
- No invoicing, proration, or overage billing
- Single region — no geographic distribution

---

## Running tests

```bash
npm test
```