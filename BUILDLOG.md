# Build Log — Usage Metering & Billing Engine

## How AI assisted

AI was used to compare the complete implementation against the July 2026 capstone brief, inspect the Git history and every project file, design missing edge-case tests, and help implement the finalization changes. I kept the requested JavaScript/CommonJS style and the existing Express/PostgreSQL structure.

The final review used real commands rather than trusting old checkboxes: `npm ci`, Docker/Compose checks, migrations, seed, the full Jest suite, the acceptance suite, container startup, a health request, and direct database rollups.

## Problems found during finalization

- Idempotency keys were globally unique. A second tenant could receive data from the first tenant when both used the same key.
- A reused key with a different payload was accepted instead of returning a conflict.
- Quota checks and the usage insert were separate operations, so concurrent requests could cross the limit.
- Stored costs were labelled microcents but calculated and converted as another unit with floating-point constants.
- The webhook event ID was inserted before tenant/subscription changes, so a later database failure made a safe retry impossible.
- Subscription update/deletion, background retry, terminal failure, `402`, tenant isolation, and real concurrency were not tested.
- The old seed printed a near-limit account but inserted no near-limit usage.
- Docker Compose started only PostgreSQL, while `capstone.yaml` claimed it ran the system.
- `JWT_SECRET` had an insecure fallback, `.env.example` missed required variables, and `package.json` said ISC while the repository contained an MIT license.
- `DESIGN.md` was missing, and the previous evidence called a mocked Checkout test “end-to-end.”

## Changes made

### Phase 2 — Metering and quotas

- Scoped idempotency by tenant and stored a request hash plus original response.
- Added `409` for a changed payload, `402` for blocked payment states, and clear `429` responses.
- Put idempotency, plan/payment checks, quota aggregation, and usage insert inside a tenant-locked transaction.
- Added deterministic retry, tenant-isolation, payload-conflict, exact-boundary, and parallel-request tests.

### Phase 3 — Stripe and background work

- Kept raw-body Stripe signature verification in the HTTP request.
- Added a PostgreSQL `background_jobs` queue with event-ID deduplication, leases, retry state, terminal failure state, and an alert log.
- Made Stripe state changes and job completion one transaction.
- Added checkout-completed, subscription-updated, subscription-deleted, forged, duplicate, retry, and terminal-failure tests.

### Phase 4 — Cost and runtime

- Replaced floating prices with exact integer microcent constants and corrected USD conversion.
- Added a current-month `/usage` test with old-month exclusion.
- Added the app Docker image, health-checked Compose services, startup migration, worker startup, and working container seed command.
- Removed the JWT fallback, completed `.env.example`, enforced Stripe test mode, and aligned the package license with MIT.

### Phase 5 — Demo and submission

- Made seed transactional and repeatable: one empty Free tenant and one at 999/1,000 API calls.
- Added `DESIGN.md`, a complete README/demo/Stripe guide, and a dedicated acceptance test command.
- Rebuilt `EVIDENCE.md` from actual tests and terminal output.

## Where AI suggestions or earlier claims were wrong

- The original evidence treated a mocked Stripe Checkout call as an end-to-end Stripe test. It is now explicitly marked as automated-only evidence.
- The original “near-limit” seed was only a label; the database contained no near-limit usage.
- The original idempotency approach returned an existing event by key without checking tenant or payload.
- The original webhook deduplication order could lose a valid retry after a partial failure.
- A first PDF parser installation attempt was unnecessary for the project and timed out; the requirements were then read without changing repository dependencies.

## Student-owned constraints and confirmations

The requested constraints shaped the implementation: keep CommonJS, avoid Redis and extra services, use PostgreSQL for the required background job, avoid stretch goals, and use Stripe test mode only. The student confirmed the Sandbox account and active recurring monthly Pro price, completed Stripe CLI login/listening, and completed the browser Checkout with the test card. The final verification then proved the CLI-forwarded webhook changed the seeded Free tenant to Pro through a completed PostgreSQL job, rejected a forged signature without state changes, and deduplicated two valid replays of the actual event.
