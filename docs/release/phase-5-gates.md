# Phase 5 release gates

Status: **locally verified; awaiting separate nonproduction provider approval and production release approval**.

## Source evidence (repeatable without hosted providers)

- 39 public marketing routes, five dashboard routes, 44 unique URLs, and five visual parity pages remain frozen.
- Frozen Bun install, formatting, ESLint, TypeScript, Vitest, Drizzle check/no-diff, PostgreSQL 18 integration, production build, and Playwright are CI gates.
- PostgreSQL coverage includes two-tenant RLS, hashed API-key metering, onboarding, reports, billing idempotency, inbound message idempotency, and audit-chain validity.
- Browser coverage includes onboarding, public verification, IMDA/HKMA exports, Stripe checkout envelope, communications-safe envelope, dashboards, interactions, and visual parity.
- Telegram delivery is mocked in deterministic tests. n8n is represented by the inactive importable artifact under `ops/n8n/`; no workflow is imported or activated by CI.

## Phase 5 productization evidence

- Neon remains the only database/auth provider. Runtime transactions use `hermes_app`, forced RLS, and transaction-local actor/system claims.
- Invite, API-key, report, billing, and message replay identifiers are hashed or digested before persistence; raw Stripe payloads, private keys, governance notes, and bearer credentials are not returned or logged.
- Public verification returns safe DID fields only and consumes a one-minute API-key window; the 61st request is a deterministic `429`.
- IMDA and HKMA reports are pure builders over a restricted read model. CSV cells are quoted and formula-safe.
- Stripe is a lazy request-time adapter. Checkout and webhook tests use mocks; Stripe products, prices, webhooks, and customers are not created here.
- The n8n workflow uses `HERMES_ORG_ID`, `HERMES_DRIVE_FOLDER_ID`, `HERMES_SHEET_ID`, and header-auth placeholders only.

## Approval gates

**Nonproduction provider approval** is required before creating or connecting the dedicated Singapore Neon project, enabling Neon Auth branches, configuring Stripe test mode, registering n8n/Google credentials, or verifying a hosted preview with test identities.

**Production release approval** is a separate decision. It is required before production migrations, issuer-key generation, domain/DNS attachment, customer seed, Stripe production configuration, n8n activation, or any external publication/push/PR action.

The following remain **unchecked** until evidence is attached: Singapore-first region/branch proof, PITR restore plus audit verification, two-tenant hosted RLS proof, rate-limit observation in the hosted environment, IMDA/HKMA report sign-off, penetration-test result, uptime/error alerting, credential rotation, preview URL verification, and production rollback rehearsal.

- Pen-test status is **unchecked** until an independent report is attached.
