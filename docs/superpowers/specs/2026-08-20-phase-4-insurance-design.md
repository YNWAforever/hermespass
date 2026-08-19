# HermesPass Phase 4 — Neon Insurance Lifecycle Design

- Status: Proposed
- Date: 2026-08-20
- Baseline: Phase 3 commit `d7d0d65af928292407eb78f4d20a263be8a92d5c`
- Depends on: Phase 3 Neon payment branch (PR #4); no Supabase runtime

## Context

The supplied Phase 4 plan describes Supabase tables and helpers, but HermesPass now uses Neon Postgres, Drizzle, Neon Auth, transaction-local claims, forced RLS, and a hash-chained audit log. Phase 4 must extend those boundaries rather than introduce a second provider or authentication model.

Insurance is a standalone liability-insurance lifecycle. It does not gate payment authorization, change gateway policy decisions, underwrite risk, or execute money movement. The insurer is a deterministic mock until a partner provides explicit API access. Owners and admins may mutate insurance state; viewers may read it.

## Goals and non-goals

Goals:

- Quote and bind one current insurance policy per agent, keyed by the agent risk tier.
- Preserve terminal policy history and every lifecycle transition in an append-only event table and the existing audit chain.
- Record a deterministic 20% commission at bind with integer-cent arithmetic.
- Accept authenticated insurer lifecycle webhooks for lapse, cancellation, and renewal with idempotent delivery.
- Keep the insurer behind a small adapter so future AIA/Zurich integrations do not change callers.
- Expose safe, tenant-scoped JSON envelopes and prove the lifecycle with PostgreSQL 18 integration tests.

Non-goals:

- Supabase packages, migrations, RLS helpers, or service-role access.
- Real insurer adapters, production partner credentials, underwriting, claims, invoicing, or payment execution.
- Automatic insurance checks in `/api/gateway/decide` or `/api/webhooks/issuing`.
- A new dashboard surface in this phase; the existing five dashboards and metadata remain unchanged. A later productization phase may add insurance views over the read API.

## Architecture decision

Use a Neon transaction service with a deterministic mock adapter. Network-shaped adapter calls are kept outside database transactions; state reservations and finalization are short, locked Neon transactions. This preserves the existing runtime role and audit/RLS boundaries without introducing a queue for a mock-only phase.

Binding has an explicit `binding` reservation state and a single-use `bindAttemptId`. A crashed caller can take over an expired binding reservation; an old worker cannot finalize or cancel a newer attempt. The adapter receives a deterministic idempotency key derived from organization and policy identity. A bind retry therefore reuses the same provider operation rather than creating a second policy.

The Phase 4 branch will be created as `codex/phase-4-insurance` from the Phase 3 commit and will stack on PR #4 until that PR is merged. No provider, Neon hosted project, Vercel, production, secret, or domain write is part of implementation.

## Data model and database controls

Add an additive Drizzle migration after the Phase 3 journal. The migration creates:

- `insurance_policies`: organization and agent IDs, monotonically increasing policy version, insurer, quote ID, provider policy ID, risk tier, coverage and premium cents, fixed `commission_bps = 2000`, status (`quoted`, `binding`, `active`, `lapsed`, `canceled`), quote/bind/expiry timestamps, binding attempt/token metadata, and creator/updater identity. A partial unique constraint permits only one non-terminal current policy (`quoted`, `binding`, or `active`) per agent. Terminal rows remain addressable history.
- `insurance_policy_events`: append-only organization/policy rows containing a unique event ID, event kind, actor type/ID, safe summary, canonical payload digest, effective time, and provider event ID when applicable. Provider event IDs are unique per insurer.
- `insurance_commission_ledger`: one row per bound policy, organization/policy IDs, premium, commission basis points, commission cents, and creation time. A unique policy constraint prevents double commission.

All tenant tables are forced RLS. Runtime access is through narrow `SECURITY DEFINER` functions and the existing transaction-local verified actor/worker claims. Owner/admin policies permit quote/bind mutations; viewers receive read access only. Webhook functions require a worker claim and return no secret or raw provider payload. The managed auth schema is not modified.

The launch rate card is one server-side function: low risk → HK$80/month and HK$500,000 coverage; medium → HK$250/month and HK$2,000,000; high → HK$900/month and HK$5,000,000. Commission is `floor(premiumCents * 2000 / 10000)` and is never calculated with floating point.

## Adapter boundary

```ts
export type InsuranceRiskTier = "low" | "medium" | "high";
export type InsurerName = "mock" | "aia" | "zurich";

export interface InsurerAdapter {
  readonly name: InsurerName;
  quote(input: { agentDid: string; riskTier: InsuranceRiskTier; idempotencyKey: string }): Promise<InsuranceQuote>;
  bind(input: { quoteId: string; idempotencyKey: string }): Promise<BoundInsurancePolicy>;
}
```

The mock adapter deterministically derives quote and policy IDs from safe identifiers and returns clock-injected validity dates. `activeInsurer()` returns mock only; selecting an unimplemented real insurer fails closed with a configuration error. No caller imports a provider SDK.

## HTTP and lifecycle flow

All responses use the existing `{ data: ... }` success and `{ error: { code, message, requestId, fieldErrors? } }` failure envelopes. Bodies are capped at 16 KiB and parsed with strict schemas.

- `GET /api/insurance/policies`: authenticated organization member read; returns safe policy and commission projections with pagination. It never returns provider credentials or internal binding tokens.
- `POST /api/insurance/quote`: owner/admin only; accepts `{ agentId }`. The server derives organization and risk from the authenticated membership and agent row. It calls the adapter, then locks the agent and inserts a current quote if no non-terminal policy exists. Duplicate requests return the existing equivalent quote or a conflict. The insert and `insurance.quote` audit event commit atomically.
- `POST /api/insurance/bind`: owner/admin only; accepts `{ policyId }`. A transaction verifies that the policy is the current unexpired quote and creates a binding reservation. The adapter is called with the deterministic attempt key. A second locked transaction finalizes the provider policy, transitions to `active`, inserts exactly one commission row, and appends `insurance.bind`. Stale attempts can be taken over; tokens are single-use and never returned in a read response.
- `POST /api/insurance/webhook`: insurer-only request authenticated by `INSURANCE_WEBHOOK_SECRET` and a constant-time comparison. Supported events are `lapsed`, `canceled`, and `renewed`, each with provider policy ID, event ID, and effective timestamp. A locked transaction deduplicates the provider event, applies only an allowed transition, appends one policy event and one audit record, and returns an idempotent acknowledgement. Unknown provider policies return a safe 404; invalid signatures return 403.

Insurance audit actions are `insurance.quote`, `insurance.bind`, `insurance.lapsed`, `insurance.canceled`, and `insurance.renewed`. Payloads contain IDs, risk tier, status, amounts, commission, event IDs, and canonical digests only.

## Error and concurrency behavior

Missing membership is denied by the existing actor service. Viewers receive 403 for quote/bind. Invalid JSON, oversized bodies, unknown agents/policies, expired quotes, terminal policies, stale bind tokens, unsupported insurers, duplicate provider events, and transition conflicts map to stable error codes without raw database/provider messages.

Per-agent advisory locks serialize quote uniqueness, binding takeover/finalization, and webhook transitions. Every mutation and audit append occurs in one database transaction. If audit insertion fails, policy status, commission rows, and provider-event records roll back together. Retried requests are safe and do not create duplicate quotes, binds, commissions, or audit events.

## Verification plan

- Unit tests cover rate-card mapping, integer commission math, adapter determinism, strict schemas, constant-time webhook secret checks, transition rules, stale takeover, and safe DTOs.
- PostgreSQL 18 tests apply all migrations and cover forced RLS, owner/admin/viewer permissions, one-current-policy uniqueness, cross-tenant denial, concurrent quote/bind attempts, stale-worker fencing, commission uniqueness, webhook idempotency, audit rollback, and audit-chain verification.
- Route tests cover request envelopes, 16 KiB body limits, signed webhook handling, duplicate delivery, and provider errors.
- Existing marketing-route, dashboard, formatting, lint, typecheck, Drizzle, build, and Playwright gates must remain green. Insurance does not alter the 39 public route contract or the five dashboard routes.
- Hosted Neon, Vercel, partner, production, and secret verification are separate release gates and remain unperformed until explicitly approved.

## Exit criteria

Phase 4 is complete when the mock quote → bind → webhook lifecycle passes the unit, PostgreSQL 18, route, build, and regression gates; every lifecycle event is visible in the existing audit chain; commission is exactly 20%; no Supabase dependency is introduced; and the branch is ready for a separately approved publication/preview step.