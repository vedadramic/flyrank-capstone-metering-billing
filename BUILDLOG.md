# Build Log - Usage Metering & Billing Engine

## How AI assisted

- Helped interpret the capstone requirements and turn them into an implementation and testing checklist.
- Helped write and refine parts of the metering, quota, Stripe webhook, background-job, pricing, and runtime code while keeping the existing JavaScript/CommonJS structure.
- Helped create deterministic tests for idempotency, tenant isolation, quota concurrency, pricing, monthly usage, Stripe event handling, retries, and terminal failures.
- Ran and reviewed project commands for dependencies, migrations, seed data, Jest, Docker Compose, health checks, and acceptance probes.
- Helped prepare `DESIGN.md`, `README.md`, `EVIDENCE.md`, and this build log using results that were actually verified in the project.

The student supplied and kept all secret values locally. AI only validated the configuration status without copying those values into chat, documentation, or tracked files. Interactive Stripe Dashboard, CLI, and browser actions were completed by the student; repository commands and branch pushes were run by AI under the student's direction.

## What I did

- Created the project and its initial phase-based implementation, repository structure, and Git history.
- Chose to keep the solution as a small Express, PostgreSQL, and CommonJS application without unnecessary services or stretch goals.
- Reviewed the proposed changes and kept the implementation at a level I can understand and explain during the presentation.
- Configured all local `.env` values without sharing or committing secrets.
- Set up the Stripe Sandbox product and recurring Pro price, completed Stripe CLI login, started the webhook listener, and completed the test Checkout in the browser.
- Confirmed the final application behavior, documentation, test evidence, and submission branch before merge.
