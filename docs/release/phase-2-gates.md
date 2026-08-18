# Phase 2 CI and release gates

Phase 2 remains **implementation in progress** until the hosted preview checks in this
runbook have evidence and the required approvals are recorded. This document does not
authorize a push, pull request, provider change, migration, webhook registration, or
release.

## Automated source gates

The `CI` workflow is the source gate for the Phase 2 branch. It must complete:

1. Bun 1.3.14 frozen install (`bun install --frozen-lockfile`).
2. Prettier, ESLint, TypeScript, and the deterministic Vitest suite.
3. Drizzle migration validation (`bun run db:check`).
4. PostgreSQL 18 integration tests against a disposable `hermespass_test` database.
5. A production Next.js build.
6. Playwright against the frozen legacy baseline and the production Next.js server.

Playwright covers all 39 public routes, the five dashboard routes signed out, and the same
five dashboards with isolated authorized storage state. It compares the five public visual
parity pages at desktop and mobile sizes. Telegram tests use injected mock senders or
mocked fetch responses; CI receives no bot token or webhook secret.

## Approval-gated ephemeral Neon smoke

The `Neon Phase 2 ephemeral smoke (approval-gated)` job runs only when
`HERMESPASS_NEON_SMOKE` is exactly `true`, after PostgreSQL 18 integration is green.
`HERMESPASS_NEON_SMOKE_URL` must target an already provisioned, disposable
nonproduction Neon branch containing the reviewed migrations. The job checks schema and
forced RLS without printing the connection value.

Creating, migrating, connecting, or deleting that branch is an external provider action
and awaits explicit approval. The workflow creates no Neon or Vercel resources and uses
no production data or credentials.

## Hosted preview evidence

After explicit nonproduction-provider approval, record sanitized evidence for:

- BYOK enrollment: single use, 15-minute expiry, and no plaintext token.
- Policy creation: an immutable next version for the selected agent.
- Automatic allow and deny: the documented first-match order.
- Concurrent caps: parallel spend requests cannot cross the agent limits.
- Web approval: an authorized reviewer resolves a held request.
- Telegram approval: the linked private reviewer resolves a held request.
- Delivery retry: Telegram failure leaves a durable web hold and later retries.
- Approval expiry: a four-hour hold creates one denial and one audit result.
- Audit-chain validity after enrollment, policy, gateway, approval, retry, and expiry.
- Public routes, metadata, dashboard metadata, wallet mocks, and visual parity unchanged.

The preview must use distinct nonproduction `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, and `CRON_SECRET` values. Configuring them and registering
the preview webhook require approval; never expose credential contents in logs or evidence.

## Separate approvals

1. **Push and pull request approval:** required before pushing or opening or updating a
   pull request. Green local checks do not grant publication authority.
2. **Nonproduction provider approval:** required before the ephemeral Neon branch,
   preview bot/cron secrets, Vercel connection, or preview webhook registration.
3. **Production release approval:** required separately before production migration,
   production bot/webhook or Vercel changes, merge, or release.

Until hosted preview evidence is complete, report **implementation in progress**.
