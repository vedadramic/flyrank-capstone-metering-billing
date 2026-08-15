# Design — Usage Metering & Billing Engine

## Problem

A multi-tenant SaaS needs to record billable usage once, enforce monthly limits before work is accepted, show the current cost, and mirror Stripe subscription state without trusting forged or duplicate webhooks.

## Core scope

- Two plans: Free and Pro
- Two metered resources: API calls and simulated AI tokens
- One billable endpoint: `POST /generate`
- Stripe Checkout and subscription webhooks in test mode only
- PostgreSQL persistence and a PostgreSQL-backed webhook job queue

The explicit non-goal is invoicing, proration, overage billing, or calling a real AI provider.

## Data model

- `plans`: monthly API and token limits plus the optional Stripe test price ID
- `tenants`: login identity, current plan, Stripe IDs, and subscription status
- `subscriptions`: the local Stripe subscription mirror for one tenant
- `usage_events`: tenant usage, token categories, integer cost, request hash, stored response, and tenant-scoped idempotency key
- `background_jobs`: verified Stripe events, retry state, terminal failure state, and completion time

Tenant isolation is enforced in queries and by the unique `(tenant_id, idempotency_key)` index. Stripe customer and subscription IDs have partial unique indexes.

## API surface

- `POST /auth/signup` and `POST /auth/login`
- `POST /generate`
- `GET /usage`
- `POST /checkout/create-session`
- `POST /webhooks/stripe`
- `GET /health`

## Layers and flow

```text
HTTP routes
  ├─ auth and request validation
  ├─ MeterService ─ PostgreSQL usage transaction
  └─ WebhookJobService ─ PostgreSQL job queue and Stripe state sync

POST /generate
  └─ lock tenant row
     ├─ same key + same hash -> stored response
     ├─ same key + other hash -> 409
     ├─ unpaid/past_due -> 402
     ├─ quota would be crossed -> 429
     └─ insert usage event and commit

Stripe webhook
  └─ verify raw-body signature
     └─ enqueue once by Stripe event ID
        └─ worker retries and atomically updates tenant + marks job completed
```

The tenant row lock serializes concurrent billable requests for one tenant. At 999 API calls, one request may reach exactly 1,000; the next request is rejected.

## Money and security decisions

Costs are stored as integer microcents, where one USD is 100,000,000 microcents. Cached input and each other token category have separate pinned integer prices. JWT has no fallback secret, `.env` is ignored, Stripe live-mode events are rejected, and webhook payloads are applied only after signature verification.
