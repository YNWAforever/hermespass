# HermesPass Phase 4 — Neon Insurance Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a Neon-native, mock-insurer liability insurance lifecycle that quotes, binds, records a 20% commission, processes signed status webhooks, and preserves every event in the tenant audit chain without affecting payment authorization.

**Architecture:** Extend the current Phase 3 Neon/Drizzle model with forced-RLS insurance tables, narrow transaction functions, and a focused `src/lib/insurance` service. Adapter calls stay outside database transactions; quote insertion, bind reservation/finalization, commission creation, provider-event idempotency, and audit appends occur under per-agent locks in short Neon transactions. The supplied Supabase-era Phase 4 plan is translated to the existing Neon Auth, `hermes_app`, actor, envelope, and audit boundaries.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2, Neon Postgres 18, Drizzle ORM 0.45.2 / Drizzle Kit 0.31.10, `@neondatabase/serverless` 1.1.0, Node 22, Bun 1.3.14, Vitest, Playwright, and the existing zod/React Query utilities. No new dependency is required.

## Global Constraints

- Baseline is Phase 3 commit `d7d0d65af928292407eb78f4d20a263be8a92d5c`; work in `C:\Users\laich\Documents\ChatGPT\Hermespass\.worktrees\phase-4-insurance` on `codex/phase-4-insurance`, stacked on PR #4 until Phase 3 merges.
- The attached `2026-08-16-phase-4-insurance.md` is a requirements brief only. Do not create `supabase/*`, import Supabase, or use its service-role examples.
- Insurance is standalone. Do not add insurance checks to `/api/gateway/decide`, `/api/webhooks/issuing`, policy evaluation, card provisioning, or payment settlement.
- The only insurer in this phase is deterministic `mock`; AIA and Zurich adapters remain disabled until explicit partner API access exists.
- Owners/admins may quote and bind. Viewers may read policy data and commission projections but cannot mutate state.
- Keep one non-terminal current policy per agent; retain terminal policy rows and append-only policy events.
- Rate card is fixed in code: low `8000`/`50000000`, medium `25000`/`200000000`, high `90000`/`500000000` cents. Commission is exactly `floor(premiumCents * 2000 / 10000)`.
- All tenant reads/mutations use the pooled `hermes_app` role, transaction-local actor/worker claims, forced RLS, composite tenant keys, and reviewed additive SQL. Never use `drizzle-kit push` against hosted branches.
- HTTP bodies are capped at 16 KiB; all responses use `{ data: ... }` or `{ error: { code, message, requestId, fieldErrors? } }`. Never expose binding tokens, provider secrets, or raw provider payloads.
- No hosted Neon, Vercel, partner, production, domain, secret, push, PR, merge, or webhook-registration write occurs without a separate explicit approval.
- Preserve the existing 39 public marketing checks, five dashboard routes/metadata, wallet/payment behavior, and all Phase 3 tests.

## Source-of-truth interfaces

```ts
export type InsuranceRiskTier = "low" | "medium" | "high";
export type InsuranceStatus = "quoted" | "binding" | "active" | "lapsed" | "canceled";
export type InsuranceEventKind = "quoted" | "bind_started" | "bound" | "lapsed" | "canceled" | "renewed";
export type InsurerName = "mock" | "aia" | "zurich";

export type InsuranceQuote = {
  insurerQuoteId: string;
  insurer: "mock";
  coverageCents: number;
  premiumCents: number;
  expiresAt: string;
};

export type BoundInsurancePolicy = {
  insurerPolicyId: string;
  boundAt: string;
  expiresAt: string;
};

export interface InsurerAdapter {
  readonly name: InsurerName;
  quote(input: { agentDid: string; riskTier: InsuranceRiskTier; idempotencyKey: string }): Promise<InsuranceQuote>;
  bind(input: { quoteId: string; idempotencyKey: string }): Promise<BoundInsurancePolicy>;
}
```

---

### Task 1: Baseline, ADR, plan, and isolated checkout

**Files:**

- Create: `docs/decisions/0005-neon-insurance.md`
- Create: `docs/superpowers/plans/2026-08-20-phase-4-insurance.md`
- Existing design: `docs/superpowers/specs/2026-08-20-phase-4-insurance-design.md`

- [x] **Step 1: Verify the baseline and worktree.**

Run from the Phase 4 worktree:

```powershell
git status -sb
git rev-parse HEAD
git merge-base --is-ancestor d7d0d65af928292407eb78f4d20a263be8a92d5c HEAD
```

Expected: branch `codex/phase-4-insurance`, clean at the Phase 3 commit, and exit code `0` for the ancestor check. Stop if the checkout differs.

- [x] **Step 2: Index the worktree.**

```powershell
bun run test -- tests/unit/approval-operations-migration.test.ts --maxWorkers=1 --fileParallelism=false
```

Run codebase-memory moderate indexing for the Phase 4 worktree and record the project name in the report. Do not index a different checkout.

- [x] **Step 3: Write ADR-0005.**

Record the Neon/Drizzle decision, standalone non-blocking lifecycle, mock-only insurer, fixed rate card, 20% commission, owner/admin mutation boundary, forced RLS, idempotent bind reservations, webhook secret gate, and explicit deferral of partner/production writes.

- [x] **Step 4: Commit documentation only.**

```powershell
git add docs/decisions/0005-neon-insurance.md docs/superpowers/plans/2026-08-20-phase-4-insurance.md docs/superpowers/specs/2026-08-20-phase-4-insurance-design.md
git commit -m "docs: plan Neon insurance lifecycle"
```

Expected: one documentation commit with no source, schema, dependency, or environment changes.

---

### Task 2: Insurance schema, RLS, runtime functions, and migration tests

**Files:**

- Modify: `src/db/schema.ts`
- Create: `drizzle/0012_insurance_lifecycle.sql`
- Create: `drizzle/meta/0012_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Create: `tests/unit/insurance-migration.test.ts`
- Modify: `scripts/run-db-tests.ts`
- Create: `tests/integration/postgres.insurance.integration.test.ts`

**Produces:** tables, enums, RLS policies, safe projections, state-transition functions, and an integration fixture for every later task.

- [x] **Step 1: Write the static migration RED test.**

Assert that the journal appends `0012_insurance_lifecycle`, the migration contains `insurance_policies`, `insurance_policy_events`, `insurance_commission_ledger`, `FORCE ROW LEVEL SECURITY`, the `binding` state, the unique current-policy predicate, and the worker-claim check. Run:

```powershell
bun x vitest run tests/unit/insurance-migration.test.ts
```

Expected: fail because the migration and snapshot do not exist.

- [x] **Step 2: Extend the Drizzle schema.**

Add enums and tables with organization/agent composite foreign keys, integer-cent columns, timestamps, and unique constraints. The policy table must include `version`, `status`, `bind_attempt_id`, `bind_attempt_expires_at`, `insurer_quote_id`, `insurer_policy_id`, and `commission_bps`; events must include `provider_event_id`, `event_kind`, and `payload_digest`; the ledger must have a unique `insurance_policy_id`.

- [x] **Step 3: Write reviewed SQL.**

Create enum values `insurance_status` and `insurance_event_kind`; create all three tables; force RLS; add tenant select policies and owner/admin mutation policies; add the partial unique index for status in `quoted`, `binding`, `active`; add the provider-event unique index `(insurer, provider_event_id)` where non-null; add composite tenant foreign keys and positive-cent/check constraints.

Create narrow `SECURITY DEFINER` functions with `SET search_path = pg_catalog, public, pg_temp`:

```sql
hermes_insurance_agent_context(p_agent_id uuid)
hermes_insurance_policy_list(p_organization_id uuid, p_cursor timestamptz, p_limit integer)
hermes_insurance_quote_insert(p_payload jsonb)
hermes_insurance_bind_reserve(p_policy_id uuid, p_attempt_id uuid, p_expires_at timestamptz)
hermes_insurance_bind_finalize(p_policy_id uuid, p_attempt_id uuid, p_provider_policy_id text, p_bound_at timestamptz, p_expires_at timestamptz)
hermes_insurance_provider_event(p_payload jsonb)
```

Each mutating function must require the verified actor or payment-independent insurance worker claim, acquire the per-agent advisory lock before row locks, and append through the existing audit trigger. The provider-event function must deduplicate `(insurer, provider_event_id)`, permit only `active -> lapsed/canceled` and `active -> active` renewal transitions, and return a safe `applied` boolean.

- [x] **Step 4: Generate and inspect migration metadata.**

Run:

```powershell
bun x drizzle-kit check
bun x drizzle-kit generate --name=insurance_lifecycle_consistency
```

Expected: `Everything's fine` and `No schema changes, nothing to migrate` after the hand-authored migration is represented in the snapshot. Do not run `drizzle-kit push`.

- [x] **Step 5: Add the migration to the serialized database runner.**

Append `tests/integration/postgres.insurance.integration.test.ts` after the existing Phase 3 integration files in `scripts/run-db-tests.ts`.

- [x] **Step 6: Run the static RED/GREEN checks and commit.**

```powershell
bun x vitest run tests/unit/insurance-migration.test.ts
bun run db:check
git add src/db/schema.ts drizzle/0012_insurance_lifecycle.sql drizzle/meta/0012_snapshot.json drizzle/meta/_journal.json tests/unit/insurance-migration.test.ts tests/integration/postgres.insurance.integration.test.ts scripts/run-db-tests.ts
git commit -m "feat(db): add Neon insurance lifecycle tables and RLS"
```

---

### Task 3: Pure rates, commission math, transition rules, and mock insurer

**Files:**

- Create: `src/lib/insurance/types.ts`
- Create: `src/lib/insurance/rates.ts`
- Create: `src/lib/insurance/transitions.ts`
- Create: `src/lib/insurance/mock-insurer.ts`
- Create: `src/lib/insurance/index.ts`
- Create: `tests/unit/insurance.test.ts`

- [x] **Step 1: Write the failing unit tests.**

Cover the exact rate card, floor commission, invalid tier rejection, allowed transitions, forbidden terminal transitions, deterministic quote/policy IDs, seven-day quote expiry, and one-year bound expiry using an injected clock. Run:

```powershell
bun x vitest run tests/unit/insurance.test.ts
```

Expected: module-resolution failure for `@/lib/insurance/rates` and `@/lib/insurance/mock-insurer`.

- [x] **Step 2: Implement pure functions.**

```ts
export function premiumForRiskTier(tier: InsuranceRiskTier): number;
export function coverageForRiskTier(tier: InsuranceRiskTier): number;
export function commissionCents(premiumCents: number, commissionBps = 2000): number;
export function canTransition(from: InsuranceStatus, to: InsuranceStatus): boolean;
```

Use integer arithmetic and reject non-safe positive cents. `canTransition` must allow `quoted -> binding`, `binding -> active`, `active -> lapsed`, `active -> canceled`, and `active -> active` renewal; it must reject transitions out of `lapsed`/`canceled`.

- [x] **Step 3: Implement the deterministic mock adapter.**

`quote()` returns `mockq_<base64url(org-free agent DID + risk tier)>`, exact rate-card values, and `clock.now + 7 days`. `bind()` accepts only `mockq_` IDs and returns a deterministic `mockp_` ID, `clock.now`, and `clock.now + 365 days`. The adapter accepts the idempotency key and returns the same output for repeated keys.

- [x] **Step 4: Run the GREEN unit suite and commit.**

```powershell
bun x vitest run tests/unit/insurance.test.ts
bun run typecheck
git add src/lib/insurance tests/unit/insurance.test.ts
git commit -m "feat(insurance): add rates transitions and mock insurer"
```

---

### Task 4: Policy read model and quote service/API

**Files:**

- Create: `src/lib/insurance/store.ts`
- Create: `src/lib/insurance/service.ts`
- Create: `src/app/api/insurance/policies/route.ts`
- Create: `src/app/api/insurance/quote/route.ts`
- Create: `tests/unit/insurance-service.test.ts`
- Create: `tests/unit/insurance-route.test.ts`
- Modify: `tests/integration/postgres.insurance.integration.test.ts`

**Interfaces:**

```ts
export type InsurancePolicyDto = {
  id: string;
  agentId: string;
  version: number;
  insurer: "mock";
  riskTier: InsuranceRiskTier;
  status: InsuranceStatus;
  coverageCents: number;
  premiumCents: number;
  commissionBps: number;
  insurerQuoteId: string | null;
  insurerPolicyId: string | null;
  quotedAt: string;
  boundAt: string | null;
  expiresAt: string | null;
};

export type InsuranceService = {
  listPolicies(actor: Actor, cursor: string | null, limit: number): Promise<InsurancePolicyDto[]>;
  quote(actor: Actor, agentId: string): Promise<InsurancePolicyDto>;
};
```

- [x] **Step 1: Write service and route RED tests.**

Prove unauthenticated requests return 401, missing membership returns 403, viewers cannot quote, owner/admin quote derives organization/risk from the server, cross-tenant agent IDs are rejected, duplicate current quotes are idempotent/conflict-safe, and list responses never contain binding attempts or provider payloads.

- [x] **Step 2: Implement the store and actor boundary.**

Use `requireActor()`, `assertCanMutate(actor)` for owner/admin, `withActorTransaction(actor, callback)` for quote insertion, and `withPublicDatabase` only for the narrow read projection. The store must set the verified actor claim before invoking SQL functions and must never accept organization ID from the browser.

- [x] **Step 3: Implement quote orchestration.**

Validate the UUID body and 16 KiB limit; read the agent context; call `activeInsurer().quote()` with a deterministic idempotency key; inside the transaction lock the agent, re-check current policy/risk/agent status, insert the quote, append `insurance.quote`, and return a safe DTO. If an equivalent current quote already exists, return it without a second audit; a different quote request returns `INSURANCE_POLICY_EXISTS`.

- [x] **Step 4: Implement GET and POST routes.**

Use `ok({ policies })` and `errorResponse(request, error)` so request IDs and stable codes match existing APIs. `GET /api/insurance/policies` must be organization-scoped and pagination-bounded; `POST /api/insurance/quote` returns 201 for a new quote and 200 for an idempotent replay.

- [x] **Step 5: Run focused unit/route tests and commit.**

```powershell
bun x vitest run tests/unit/insurance-service.test.ts tests/unit/insurance-route.test.ts
bun run typecheck
git add src/lib/insurance/store.ts src/lib/insurance/service.ts src/app/api/insurance/policies/route.ts src/app/api/insurance/quote/route.ts tests/unit/insurance-service.test.ts tests/unit/insurance-route.test.ts tests/integration/postgres.insurance.integration.test.ts
git commit -m "feat(insurance): add tenant-scoped quote and policy APIs"
```

---

### Task 5: Bind reservation, stale takeover, and commission ledger

**Files:**

- Modify: `src/lib/insurance/store.ts`
- Modify: `src/lib/insurance/service.ts`
- Create: `src/app/api/insurance/bind/route.ts`
- Modify: `tests/unit/insurance-service.test.ts`
- Modify: `tests/unit/insurance-route.test.ts`
- Modify: `tests/integration/postgres.insurance.integration.test.ts`

- [x] **Step 1: Write binding RED tests.**

Cover owner/admin authorization, expired quote denial, duplicate bind replay, binding reservation creation, stale takeover fencing, old attempt finalize/cancel denial, exactly one active policy, exactly one commission row at 20%, and rollback when audit insertion fails.

- [x] **Step 2: Implement the two-phase bind service.**

`reserveBind()` acquires the agent advisory lock and changes `quoted -> binding` with a random attempt ID and five-minute expiry. Call the adapter outside the transaction with `mockp_` idempotency. `finalizeBind()` reacquires the lock and accepts only the current attempt ID; it changes `binding -> active`, inserts the unique ledger row using `commissionCents`, appends `insurance.bind`, and clears the attempt fields. If a reservation is stale, a new attempt replaces it; an old worker receives `INSURANCE_BIND_STALE` and cannot mutate the new row.

- [x] **Step 3: Implement `POST /api/insurance/bind`.**

Require a UUID `policyId`, owner/admin actor, current quote, and no terminal/active conflict. Return 200 for an idempotent active policy replay, 409 for a conflicting bind, and 503 only for an unavailable adapter. Never return the bind attempt ID or provider secret.

- [x] **Step 4: Run the focused and live integration tests.**

```powershell
bun x vitest run tests/unit/insurance-service.test.ts tests/unit/insurance-route.test.ts
$env:DATABASE_URL_TEST='postgresql://postgres:postgres@127.0.0.1:55440/hermespass_test'; $env:DB_INTEGRATION_REQUIRED='1'; bun run test:db
```

Expected: all insurance integration cases pass, including concurrent bind and stale-worker fencing. Remove the exact disposable container after the run and verify its name is absent.

- [x] **Step 5: Commit the bind slice.**

```powershell
git add src/lib/insurance/store.ts src/lib/insurance/service.ts src/app/api/insurance/bind/route.ts tests/unit/insurance-service.test.ts tests/unit/insurance-route.test.ts tests/integration/postgres.insurance.integration.test.ts
git commit -m "feat(insurance): bind policies and ledger commissions"
```

---

### Task 6: Signed insurer webhook and event audit

**Files:**

- Create: `src/lib/insurance/events.ts`
- Create: `src/app/api/insurance/webhook/route.ts`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`
- Modify: `drizzle/0012_insurance_lifecycle.sql`
- Create: `tests/unit/insurance-webhook.test.ts`
- Modify: `tests/integration/postgres.insurance.integration.test.ts`

- [x] **Step 1: Write webhook RED tests.**

Cover missing/invalid secret, malformed JSON, oversized and invalid UTF-8 bodies, supported lapse/cancel/renew events, unknown provider policy, duplicate provider event, invalid transition, and safe acknowledgement. Assert the stored event excludes unknown provider fields.

- [x] **Step 2: Implement the signed parser.**

Use a request-time `INSURANCE_WEBHOOK_SECRET` accessor that fails closed when absent; compare the header with a constant-time byte comparison; cap the streaming body at 16 KiB; parse only `{ eventId, insurer, insurerPolicyId, event, effectiveAt }`; canonicalize safe fields and compute a SHA-256 digest.

- [x] **Step 3: Implement the webhook route and SQL event function.**

The route verifies the secret before parsing, calls `hermes_insurance_provider_event`, and returns `{ data: { applied: boolean } }`. The SQL function acquires the policy’s agent lock, locks the policy, deduplicates `(insurer, providerEventId)`, validates the state transition, appends one `insurance_policy_events` row and one audit action, and commits atomically. Replays return `applied: false` without a second event/audit.

- [x] **Step 4: Add environment documentation without secrets.**

Add only `INSURANCE_WEBHOOK_SECRET=` to `.env.example`; do not create `.env.local`, print a real value, or configure Vercel/Neon.

- [x] **Step 5: Run focused webhook/DB tests and commit.**

```powershell
bun x vitest run tests/unit/insurance-webhook.test.ts tests/unit/insurance-route.test.ts
bun run typecheck
bun run db:check
git add src/lib/insurance/events.ts src/app/api/insurance/webhook/route.ts src/lib/env.ts .env.example drizzle/0012_insurance_lifecycle.sql tests/unit/insurance-webhook.test.ts tests/integration/postgres.insurance.integration.test.ts
git commit -m "feat(insurance): add signed insurer status webhooks"
```

---

### Task 7: End-to-end regression and release evidence

**Files:**

- Modify: `tests/e2e/routes.spec.ts` only if the stable route manifest needs the insurance API excluded from public-route counts
- Create: `tests/e2e/insurance.spec.ts`
- Create: `docs/release/phase-4-gates.md`
- Create: `.superpowers/sdd/task-8-report.md` (ignored)
- Modify: `.superpowers/sdd/progress.md` (ignored)

- [x] **Step 1: Add deterministic route/service tests.**

Use the existing fixture-auth harness to verify owner quote → bind, viewer read-only access, viewer mutation denial, webhook replay, audit verification, and exact commission values. Keep provider calls mocked; do not use hosted credentials.

- [x] **Step 2: Run the complete deterministic gate.**

```powershell
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run db:check
bun x drizzle-kit generate --name=phase4_insurance_consistency
bun run test:db
bun run build
bun run test:e2e
```

Expected: no lockfile/schema diff; all existing route/dashboard/visual checks remain green; all insurance tests pass; local PostgreSQL 18 suite passes; build and Playwright pass.

- [x] **Step 3: Run static scope checks.**

```powershell
$supabase = @(rg -n 'from ["'']@/.*supabase|supabaseAdmin|supabaseServer' src/lib/insurance src/app/api/insurance -g '*.ts' -g '*.tsx' -g '!tests/**')
if ($supabase.Count -ne 0) { $supabase }
$paymentCoupling = @(rg -n 'insurance' src/lib/payments src/lib/gateway -g '*.ts' -g '*.tsx')
if ($paymentCoupling.Count -ne 0) { $paymentCoupling }
```

Expected: both arrays are empty. Provider names may appear only in the insurance adapter type and deferred configuration error.

- [x] **Step 4: Independent review and commit.**

Run `git diff --check`, inspect the staged file list, obtain a read-only review, then commit:

```powershell
git add drizzle/0012_insurance_lifecycle.sql drizzle/meta/0012_snapshot.json drizzle/meta/_journal.json src/db/schema.ts src/lib/env.ts src/lib/insurance src/app/api/insurance tests/unit/insurance-migration.test.ts tests/unit/insurance.test.ts tests/unit/insurance-service.test.ts tests/unit/insurance-route.test.ts tests/unit/insurance-webhook.test.ts tests/integration/postgres.insurance.integration.test.ts tests/e2e/insurance.spec.ts docs/release/phase-4-gates.md
git commit -m "feat(insurance): complete Neon mock-insurer lifecycle"
```

Record RED/GREEN results, final SHA, local PG18 cleanup, and the fact that hosted/provider/release gates remain untouched in `.superpowers/sdd/task-8-report.md` and `.superpowers/sdd/progress.md`.

- [x] **Step 5: Stop at the publication gate.**

Do not push, open a PR, connect Vercel, configure `INSURANCE_WEBHOOK_SECRET`, or migrate hosted Neon without separate approval. Present the local commit, test evidence, and the exact external gates still pending.

## Requirement coverage self-check

- Neon replacement for Supabase: Tasks 1–2 and Global Constraints.
- Fixed rate card and 20% ledger: Tasks 3 and 5.
- Mock adapter with future partner seam: Task 3.
- Quote/bind lifecycle and ownership: Tasks 4–5.
- Stale bind fencing and idempotency: Task 5.
- Signed lapse/cancel/renew webhook: Task 6.
- Append-only policy events and hash-chain audit: Tasks 2 and 6.
- RLS, tenant isolation, role denial, and rollback: Tasks 2, 4, 5, and 6.
- Existing product regression and release evidence: Task 7.