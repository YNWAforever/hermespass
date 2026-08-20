# HermesPass Phase 6 — Neon-First Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, offline production-release preflight and close the documented inbound-comms header contract while keeping Neon/provider and production mutations approval-gated.

**Architecture:** A pure TypeScript preflight library owns all validation rules and redacted result types. A Bun CLI gathers only safe metadata (variable names, URL role, branch, migration diff, source literal counts, and route-fixture presence) and exits with a stable status without network access. CI runs the CLI with non-secret fixtures and continues to run the existing full gates. The inbound comms route adds the documented header alias without changing authentication or persistence boundaries.

**Tech Stack:** Next.js 16.3.1, React 19.2, Neon Postgres/Drizzle, Bun 1.3.14, TypeScript, Vitest, Playwright, GitHub Actions, PowerShell-compatible repository tooling.

## Global Constraints

- Baseline is the verified Phase 5 commit `16e66556e579cca059b5d8fe89c9ae16b8b53d1b`.
- Work only in isolated branch `codex/phase-6-production-release`.
- Neon is the database provider; do not add Supabase packages, URLs, or runtime code.
- The preflight makes no HTTP/DNS/provider calls and never prints secret values.
- Do not create/connect Neon, Vercel, Cloudflare, Stripe, n8n, DNS, or production resources.
- Do not apply hosted migrations, generate production issuer material, or seed customer data.
- Preserve all Phase 0–5 routes, metadata, dashboard behavior, RLS, audit, billing, insurance, and communications contracts.
- Use `apply_patch` for source edits, explicit `git add` paths, and PowerShell-compatible commands.

---

### Task 1: Add the pure Phase 6 preflight contract

**Files:**

- Create: `src/lib/release/phase6-preflight.ts`
- Create: `tests/unit/phase6-preflight.test.ts`

**Interfaces:**

```ts
export type Phase6CheckCode =
  | "MISSING_REQUIRED_VARIABLE"
  | "UNSAFE_RUNTIME_ROLE"
  | "INVALID_BRANCH_CONFIGURATION"
  | "INVALID_BASE_URL"
  | "MIGRATION_DRIFT"
  | "SECRET_LITERAL_FOUND"
  | "ROUTE_CONTRACT_FAILED";

export type Phase6PreflightResult = {
  ok: boolean;
  checks: Array<{ code: Phase6CheckCode | "OK"; detail: string }>;
};

export type Phase6PreflightInput = {
  requiredVariables: ReadonlyArray<string>;
  presentVariableNames: ReadonlySet<string>;
  runtimeDatabaseUrl: string | null;
  branch: string;
  baseUrl: string;
  migrationDiff: boolean;
  secretLiteralMatches: number;
  routeContractOk: boolean;
};

export function runPhase6Preflight(
  input: Phase6PreflightInput,
): Phase6PreflightResult;
```

- [x] **Step 1: Write the failing unit tests.** Add tests for: all required names present; one missing name; a `hermes_app` URL accepted; owner/migration/postgres role rejected; `development`, `preview`, and `production` accepted; an unsupported branch rejected; `http://localhost:3000` accepted; an HTTPS production URL accepted; an HTTP non-local URL rejected; migration drift; one secret-like literal; route-contract failure; stable check ordering; and details containing no URL userinfo or secret text.

- [x] **Step 2: Run the focused tests and confirm RED.**

```powershell
bun x vitest run tests/unit/phase6-preflight.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: module-resolution or missing-export failures because the preflight module does not exist yet.

- [x] **Step 3: Implement the pure validator.** Keep it free of filesystem, process, database, and network imports. Normalize variable names and branch strings, parse the URL with `URL`, reject usernames matching `owner`, `migration`, `postgres`, or `neon_owner`, allow only `development|preview|production`, allow HTTP only for loopback hosts, aggregate missing names, reject negative/non-finite literal counts, and return checks in this exact order: required variables, runtime role, branch, base URL, migration drift, secret literals, route contract.

- [x] **Step 4: Run the focused tests and confirm GREEN.**

```powershell
bun x vitest run tests/unit/phase6-preflight.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: every Phase 6 preflight unit test passes.

- [x] **Step 5: Commit the pure contract.**

```powershell
git add src/lib/release/phase6-preflight.ts tests/unit/phase6-preflight.test.ts
git commit -m "feat(release): add offline Phase 6 preflight contract"
```

### Task 2: Add the redacted Bun CLI and package/CI contract

**Files:**

- Create: `scripts/phase6-release-preflight.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `tests/unit/phase6-release-cli.test.ts`

**Interfaces:**

- CLI command: `bun run release:phase6`.
- Safe environment inputs: `PHASE6_REQUIRED_VARIABLES`, `PHASE6_PRESENT_VARIABLES`, `PHASE6_DATABASE_URL`, `PHASE6_DEPLOYMENT_BRANCH`, `PHASE6_BASE_URL`, `PHASE6_ROUTE_CONTRACT`.
- Exit status `0` means all checks pass; `1` means the redacted result contains validation failures; `2` means an unexpected local inspection error.

- [x] **Step 1: Write the failing CLI tests.** Mock the environment and filesystem inspection so the test proves a passing fixture exits `0`, a missing required name exits `1`, a migration diff exits `1`, output contains only codes/details and never contains the database password, and the CLI does not call `fetch` or any network client.

- [x] **Step 2: Run the CLI tests and confirm RED.**

```powershell
bun x vitest run tests/unit/phase6-release-cli.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: module-resolution or missing-command failures.

- [x] **Step 3: Implement safe metadata collection.** Read only variable names and the explicitly named Phase 6 values. Use `git diff --quiet -- drizzle src/db/schema.ts` for migration drift, `git ls-files` plus bounded source/config reads for secret-pattern counts, and a repository route-fixture existence/content check for `PHASE6_ROUTE_CONTRACT`. Never include file contents, URL userinfo, or matched literals in diagnostics. Treat absent optional local inputs as the documented localhost/development fixture; production values are supplied only by protected CI contexts.

- [x] **Step 4: Add the package script and CI invocation.** Add:

```json
"release:phase6": "bun run scripts/phase6-release-preflight.ts"
```

In the existing `check` job, after the Drizzle no-diff check and before the full test gate, run the CLI with fixture names and values only:

```yaml
- name: Phase 6 offline release preflight
  env:
    PHASE6_REQUIRED_VARIABLES: DATABASE_URL,NEON_AUTH_COOKIE_SECRET,HERMES_KEK_V1
    PHASE6_PRESENT_VARIABLES: DATABASE_URL,NEON_AUTH_COOKIE_SECRET,HERMES_KEK_V1
    PHASE6_DATABASE_URL: postgresql://hermes_app:fixture@localhost:5432/hermespass
    PHASE6_DEPLOYMENT_BRANCH: development
    PHASE6_BASE_URL: http://localhost:3000
    PHASE6_ROUTE_CONTRACT: pass
  run: bun run release:phase6
```

The CI job must not receive Neon, Stripe, Cloudflare, n8n, DNS, or production secret values.

- [x] **Step 5: Run focused CLI and CI contract tests.**

```powershell
bun x vitest run tests/unit/phase6-release-cli.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: all CLI and workflow assertions pass.

- [x] **Step 6: Commit the CLI and CI slice.**

```powershell
git add scripts/phase6-release-preflight.ts package.json .github/workflows/ci.yml tests/unit/phase6-release-cli.test.ts
git commit -m "ci(release): run Phase 6 offline preflight"
```

### Task 3: Close the Phase 5 inbound communications header contract

**Files:**

- Modify: `src/app/api/comms/inbound/route.ts`
- Modify: `tests/unit/comms-api.test.ts`

- [x] **Step 1: Add the failing alias test.** Send the existing valid fixture with only `x-hermespass-comms-secret` and assert the same success envelope and stored message behavior as the existing alias tests.

- [x] **Step 2: Run the focused route test and confirm RED.**

```powershell
bun x vitest run tests/unit/comms-api.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: the new header-only request is rejected as unauthorized.

- [x] **Step 3: Add the documented alias to the explicit header list.** Read `x-comms-secret`, `x-comms-inbound-secret`, and `x-hermespass-comms-secret` in that order, then pass the selected value through the existing constant-time comparison. Do not change body limits, UTF-8 handling, error envelopes, database claim, or message persistence.

- [x] **Step 4: Run the focused route tests and confirm GREEN.**

```powershell
bun x vitest run tests/unit/comms-api.test.ts tests/unit/comms.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: all communications tests pass, including mismatched and oversized requests.

- [x] **Step 5: Commit the compatibility closure.**

```powershell
git add src/app/api/comms/inbound/route.ts tests/unit/comms-api.test.ts
git commit -m "fix(comms): accept documented worker secret header"
```

### Task 4: Publish the Phase 6 evidence ledger and update launch readiness

**Files:**

- Create: `docs/release/phase-6-gates.md`
- Modify: `docs/launch-readiness.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Create: `tests/unit/phase6-release-gates.test.ts`

- [x] **Step 1: Write the failing documentation contract tests.** Assert the release ledger names the Neon project/branch/runtime-role/PITR/RLS/secret/rate-limit/penetration/alerting gates, explicitly separates `Nonproduction provider approval` from `Production release approval`, and contains no Supabase runtime instructions.

- [x] **Step 2: Run the contract test and confirm RED.**

```powershell
bun x vitest run tests/unit/phase6-release-gates.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: missing Phase 6 ledger or stale-provider wording failures.

- [x] **Step 3: Write the evidence ledger.** Record local evidence links and command names as completed only when current commits prove them. Keep hosted/provider boxes unchecked and list the exact evidence required for each. State that the preflight is offline and that no credentials or customer data belong in the repository.

- [x] **Step 4: Update launch readiness, README, and AGENTS.** Preserve the existing codebase-memory block in `AGENTS.md`; append only the Phase 6 Neon-first boundary. Replace stale Supabase-only release wording with Neon equivalents while retaining historical-plan context where needed.

- [x] **Step 5: Run the documentation contract test and commit.**

```powershell
bun x vitest run tests/unit/phase6-release-gates.test.ts --maxWorkers=1 --fileParallelism=false
git add docs/release/phase-6-gates.md docs/launch-readiness.md README.md AGENTS.md tests/unit/phase6-release-gates.test.ts
git commit -m "docs(release): add Phase 6 evidence ledger"
```

### Task 5: Run the complete deterministic gate and hand off external release work

**Files:**

- Modify: `.superpowers/sdd/task-6-report.md` (ignored workspace report only)

- [x] **Step 1: Run frozen install and static gates.**

```powershell
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run release:phase6
bun run db:check
bun x drizzle-kit generate --name=phase6_final_consistency
bun run test
bun run build
```

Expected: no lockfile/schema diff, preflight exit `0`, all unit tests green, and a successful production build.

- [x] **Step 2: Run database and browser gates.** Use a disposable local PostgreSQL 18 container only, remove it after verification, and run:

```powershell
bun run test:db
bun run test:e2e
```

Expected: all Phase 0–5 database and browser checks pass; no hosted Neon or production endpoint is contacted.

- [x] **Step 3: Review release-scope hygiene.** Confirm `git diff --check`, no tracked secret-like literals in source/config, no Supabase imports or runtime URLs, no owner-role runtime URL, no raw provider ids in logs, no disposable container remains, and only explicit Phase 6 paths are staged.

- [x] **Step 4: Write the ignored report.** Include exact commit SHAs, command outputs, test counts, external gates still unchecked, and the fact that no provider/publication/production write occurred.

- [x] **Step 5: Commit the final Phase 6 implementation.**

```powershell
git status --short --branch
git log -5 --oneline
git add src/lib/release/phase6-preflight.ts scripts/phase6-release-preflight.ts src/app/api/comms/inbound/route.ts package.json .github/workflows/ci.yml docs/release/phase-6-gates.md docs/launch-readiness.md README.md AGENTS.md tests/unit/phase6-preflight.test.ts tests/unit/phase6-release-cli.test.ts tests/unit/phase6-release-gates.test.ts tests/unit/comms-api.test.ts
git commit -m "feat(release): complete Phase 6 production preflight"
```

## External release handoff

After the local branch is verified, a separately approved operator must create/connect the dedicated Neon project in Singapore, configure branch isolation and `hermes_app`, set protected nonproduction secrets, verify a preview, attach `hermespass.asia`, configure Cloudflare email routing and n8n, apply additive production migrations, generate production issuer material, seed only approved customers, and rerun the full route/interaction/audit/billing/report/comms checks. This plan does not authorize those mutations.
