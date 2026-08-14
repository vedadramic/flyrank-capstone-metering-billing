# Build Log — Usage Metering & Billing Engine

## AI assistance log

This file tracks where AI helped, where it was wrong, and what was changed.

### Phase 1 — Design
- Used AI to help structure the database schema
- Reviewed and adjusted the idempotency key design manually
- Verified the quota boundary logic myself before implementation

### Phase 2 — Core billing logic
- Kept the local Postgres port on 5433 because 5432 was not usable here
- Added a Windows-safe Jest wrapper so tests load `.env` before startup
- Aligned the generate endpoint to write one usage event per billable request

### Phase 3 — Stripe integration
- Stripe routes are driven by env-based secrets and webhook signature checks
- Webhook tests cover the forged-signature, duplicate, and tenant-update paths

### Phase 4 — Cost & finalization
- Confirmed the suite passes with `npm test`
- Kept `.env.example` aligned with the 5433 database URL

## What I changed from AI suggestions
- Replaced the direct POSIX Jest shim invocation with a Windows-safe wrapper
- Preserved the 5433 Postgres mapping throughout the project
- Fixed webhook body handling so Stripe signature verification works with raw payloads

## Where AI was wrong
- The direct `node_modules/.bin/jest` invocation breaks on Windows
- The guide's default 5432 port does not work in this workspace
- The generate endpoint should not create two usage rows per request