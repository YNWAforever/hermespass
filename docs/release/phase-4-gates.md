# Phase 4 insurance release gates

Phase 4 is a Neon-native, mock-insurer lifecycle. It is complete locally only after the deterministic source, browser, and PostgreSQL gates pass. This runbook does not authorize hosted Neon, insurer, Vercel, webhook-registration, domain, push, PR, or production writes.

## Source gates

Run from the Phase 4 worktree with Bun 1.3.14 and Node 22:

```powershell
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run db:check
bun x drizzle-kit generate --name=phase4_insurance_consistency
bun run build
```

The Drizzle generate command must report no schema changes. The PostgreSQL gate uses a disposable local PostgreSQL 18 container and `DATABASE_URL_TEST`; it must include the Phase 1–3 suites plus `postgres.insurance.integration.test.ts` and be removed by exact container name afterward:

```powershell
bun run test:db
```

The insurance suite proves forced RLS, owner/admin mutation, viewer denial, server-derived tenant identity, quote idempotency, bind reservation/finalization, stale-worker fencing, exact 20% commission, provider-event replay, canonical digest persistence, rollback, and audit-chain appends.

## Browser gates

```powershell
bun run test:e2e
```

The browser run retains the 39 public routes, five signed-out and authorized dashboard routes, existing interactions, and visual parity checks. `tests/e2e/insurance.spec.ts` adds a deterministic authenticated browser contract for safe quote/bind envelopes; provider calls remain mocked and no private token or organization identity is sent by the browser.

## External release gates

These remain separate approvals after local verification:

1. Create or connect the dedicated Neon project and enable Auth on the intended branches.
2. Configure `INSURANCE_WEBHOOK_SECRET` separately for preview and production, then register the insurer webhook only after a real partner adapter exists.
3. Verify a Vercel preview with test-only credentials and run the route, dashboard, quote, bind, webhook replay, and audit checks against it.
4. After separate production approval, apply additive migrations, configure the real insurer adapter, attach the production domain, and rerun all checks.

A real AIA/Zurich integration, claims, underwriting, billing, and payment coupling are explicitly deferred. Until the external gates are approved and verified, Phase 4 status is **local gates verified, hosted preview pending approval**.
