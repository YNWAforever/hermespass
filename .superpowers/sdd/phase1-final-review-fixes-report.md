# Phase 1 final-review security fixes report

Date: 2026-08-17

Worktree: `C:\Users\laich\Documents\ChatGPT\Hermespass\.worktrees\phase-1-identity-audit`

Starting HEAD: `7415169ad3b722fec0668f691914cb24a2df80e6`

## Scope and external boundaries

This local-only wave resolves every Critical, Important, and listed Minor item in
`phase1-final-review-fixes-brief.md`. It did not contact or mutate Neon, GitHub,
Vercel, DNS, production, or any other provider. It did not use `drizzle-kit push`.
Hosted migration `0000_low_human_robot.sql` remains unchanged; all database
hardening is additive in `0001_phase1_security_hardening.sql` and the integration
harness applies migrations in journal order.

## Implemented fixes

### Authentication and redirects

- Removed the source-visible fallback Auth cookie secret.
- Made Auth construction lazy so provider-free production builds still complete.
- Required both Auth variables before every SDK retrieval, including a cached SDK;
  missing or partial configuration fails closed before SDK/session use.
- Normalized Auth unavailability into a request-ID error envelope and retained
  signup rejection.
- Centralized post-login destination validation. Only `/dashboard` and descendants
  survive; protocol-relative, backslash/encoded-backslash, control-character, and
  non-dashboard destinations fall back to `/dashboard`.
- Replaced optional hosted Auth storage state in mandatory browser CI with an
  isolated adapter. Each Playwright run generates a random 256-bit cookie secret,
  writes an ignored mode-0600 storage-state artifact, and deletes it during cleanup.
  The adapter also requires an explicit private flag and is hard-disabled on Vercel.
  No source-static authentication cookie remains.

### Credential and DID verification

- Parses signed credentials through strict Zod schemas for the exact VC contexts,
  types, UUID credential ID, issuer/subject DIDs, ISO timestamps, and subject claims.
- Binds issuer, key ID, credential ID, subject, organization name/slug, name, role,
  risk, ordered scopes, spend cap, `validFrom`, and `validUntil` to the selected
  stored row.
- Rejects future, expired, malformed, swapped, or claim-divergent credentials.
- Accepts browser spend caps only to two decimals, converts once to integer cents,
  and signs the same normalized stored value.
- Publishes active and historical issuer keys in `verificationMethod`, while only
  active keys remain in `authentication` and `assertionMethod`. Revoked agent keys
  stay resolvable without being advertised as currently authorized.

### Additive database hardening

- Adds unique parent `(id, organization_id)` identity and composite foreign keys
  from `agent_keys` and nullable agent-linked audit rows.
- Replaces child-table RLS predicates with tenant-plus-parent checks and adds
  explicit organization filtering to agent key projections.
- Fails the migration if pre-existing `hermes_app` has any parent membership in
  `pg_auth_members`.
- Adds narrowly table-owner-scoped FORCE-RLS read policies needed by the
  `SECURITY DEFINER` audit/public functions. The normal `hermes_app` policies and
  tenant boundaries are unchanged.
- Adds atomic invoker-rights `hermes_revoke_agent`: only the `active` update winner
  changes metadata, revokes keys, and appends one audit row; concurrent losers read
  the stable revoked result.
- Adds audit hash version 3 with explicit UTC canonical timestamp serialization.
  Existing rows are tagged version 2, the exact v2 function is preserved, and the
  verifier dispatches by stored version. The before-insert trigger writes only v3.
- Adds public historical issuer-key resolution without exposing private key data.

### Compliance, CSV, caches, and errors

- Compliance consumes authoritative `/api/audit/verify` results with loading,
  error, valid, and invalid states. It no longer labels hashes as signatures or
  invents per-row signature validity.
- Removed the duplicate browser CSV builder. The UI downloads the authenticated
  server export, which neutralizes formulas even after leading whitespace and
  control characters.
- Converts PostgreSQL bigint verification fields to the documented numeric client
  contract, including nullable `firstInvalid`.
- Successful issuance invalidates both agent and audit query caches.
- Public DID/verification errors use normalized request-ID envelopes; malformed
  JSON returns 400 and revoke IDs are UUID-validated.

## TDD evidence

### Initial RED evidence

- Auth/config/redirect regression suite: 11 tests, **9 failed / 2 passed**. The
  missing/partial-config cases still accepted SDK construction and unsafe redirect
  cases were not rejected.
- Credential suite: 13 tests, **9 failed / 4 passed** for swapped subject, issuer,
  credential ID, temporal, structural, claim, and fractional-cap cases. A separate
  historical issuer-method assertion also failed.
- API security suite: **4/4 failed** for malformed JSON, revoke UUID, and normalized
  public error envelopes.
- Audit/Compliance suite: 11 tests, **10 failed / 1 passed** for formula prefixes,
  invalidation, authoritative verification states, fake signature removal, and
  server export.
- Additive migration contract: **2/2 failed** because migration/journal `0001` did
  not yet exist.
- Mandatory authenticated CI contract: 3 tests, **2 failed / 1 passed** because the
  browser suites used `PLAYWRIGHT_AUTH_STATE` and conditional skips.
- First real PostgreSQL 18 run before `0001`: 19 discovered, **3 failed / 2 passed /
  14 skipped**. After the first migration implementation: **4 failed / 15 passed**,
  exposing the helper enum cast and FORCE-RLS public-function path.

### Review-driven RED evidence

- Isolated adapter hardening: 17 tests, **3 failed / 14 passed** before replacing
  the published cookie with a per-run secret.
- Fresh-role audit behavior: 20 tests, **1 failed / 19 passed**. The second append
  raised `23505` on `agent_audit_logs_organization_chain_position_key`, proving the
  definer could not see the first row under FORCE RLS.
- Legacy v2 compatibility: 21 tests, **1 failed / 20 passed**. A pre-0001 row written
  in `Asia/Hong_Kong` verified as `false` after `0001` redefined v2.
- Auth/VC/DID/migration review suite: 33 tests, **5 failed / 28 passed** for cached
  SDK config, stored validity dates, inactive DID relationships, and v2 replacement.
- Audit bigint normalization: 12 tests, **1 failed / 11 passed** because
  `firstInvalid` was returned as string `"42"`.
- First focused browser pass: 9 tests, **1 failed / 8 passed** because the hardened
  server export is a link while the stale test searched for a button.

### Focused GREEN evidence

- Auth/API/HTTP: 3 files, **19/19 passed**.
- Credential plus audit security: 2 files, **25/25 passed** at the initial green
  checkpoint; dashboard interactions separately passed **7/7**.
- Auth/CI/audit/dashboard combined: 4 files, **34/34 passed**.
- Per-run adapter/auth coverage: 2 files, **17/17 passed**.
- Post-review Auth/VC/DID/migration suite: 3 files, **33/33 passed**.
- Audit normalization suite: **12/12 passed**.
- Final PostgreSQL 18 integration: **21/21 passed**, including ordered migrations,
  absent/safe/contaminated role paths, composite tenant integrity, v2 preservation,
  v3 cross-timezone verification, active/revoked public keys, historical issuer
  keys, and concurrent revocation winner semantics.
- Focused authenticated Playwright route/interaction proof: **9/9 passed** in 27.5s,
  including all five dashboard routes, issuance-without-wallet, approval stream,
  wallet controls, Compliance print, and authenticated server CSV download.

## Final deterministic gates

| Gate | Result |
| --- | --- |
| `bun install --frozen-lockfile` | PASS after filesystem-ACL escalation; 396 packages installed and lockfile unchanged. Initial sandbox attempt failed with Bun shared-cache `EPERM`, not a lock mismatch. |
| `bun run format:check` | PASS — all matched files use Prettier style. |
| `bun run lint` | PASS. |
| `bun run typecheck` | PASS. |
| `bun run test` | PASS — 17 files passed, 2 DB files skipped; 119 tests passed, 27 skipped. |
| `DATABASE_URL_TEST=... bun run test:db` | PASS — 1 file, 27/27 tests against disposable local PostgreSQL 18. |
| `bun x drizzle-kit check` | PASS — `Everything's fine`. |
| `bun run build` without provider/database variables | PASS — optimized Next 16.3.1 production build, 42 static pages generated. |
| Focused authenticated Playwright | PASS — 9/9. |
| `git diff --check` | To be rerun immediately before staging. |

The local PG connection string is intentionally omitted. No hosted Neon smoke was
run because provider access was explicitly out of scope.

## Review corrections

A read-only final reviewer found and prompted correction of:

- missing definer-owner RLS paths for fresh-role audit behavior;
- the source-static E2E test cookie;
- incomplete stored validity-date binding;
- retired DID keys remaining in active verification relationships;
- v2 audit hash redefinition breaking historical non-UTC rows;
- cached Auth SDK retrieval without a fresh config check; and
- bigint `firstInvalid` response drift.

Each was reproduced with a failing regression before implementation and is covered
by the GREEN evidence above.

## Remaining blockers and risks

- Deployment/application of `0001` to hosted Neon development was not authorized
  and remains a separate reviewed operational step. Production and all external
  publication remain unchanged.
- Historical v2 hashes necessarily retain their original timezone-dependent
  semantics because the old hash did not record its input timezone. The migration
  preserves those bytes and behavior; all new rows use canonical UTC v3. A legacy
  row created outside the database's normal timezone must be verified in its
  original session timezone. The integration suite explicitly covers preservation
  of such a non-UTC v2 row and separate cross-timezone v3 verification.
- The E2E adapter is test infrastructure embedded behind two explicit private
  settings and a per-run 256-bit secret, with a Vercel hard-disable. Those settings
  must never be copied into a non-test self-hosted environment.
- Hosted Auth/Neon smoke and full visual-parity publication evidence were not run;
  focused local authenticated browser behavior, the provider-free production build,
  and all deterministic local gates passed.

## Independent follow-up review wave

A second whole-slice review found one Important PostgreSQL name-resolution issue
and two Minor correctness/isolation issues after commit `d87d328`. All three were
handled locally before any hosted migration was attempted.

### Defensive name-resolution hardening

- RED: the PostgreSQL 18 suite ran 27 tests with **6 failed / 21 passed**. The
  failures proved that surviving SQL routines did not pin an explicit safe search
  path and that session-local same-named relations could change audit append,
  verification, revocation authorization, legacy issuer projection, and public
  agent projection behavior.
- GREEN: additive migration `0001` now recreates or defines all 12 surviving Phase
  1 routines with `search_path = pg_catalog, public, pg_temp` and explicit
  `public` relation/function references. The original hosted `0000` remains
  unchanged, and the complete PostgreSQL 18 suite passes **27/27**.
- Historical v2 hashing was recreated byte-for-byte except for pinned object
  resolution; its compatibility regression remains green. New rows continue to
  use UTC-canonical v3 hashing.

### Expiration semantics

- RED: a credential evaluated exactly at `validUntil` was reported as active and
  valid, and an already expired signed credential fell into the generic invalid
  proof response.
- GREEN: `validUntil` is exclusive. A typed temporal result is raised only after
  the proof, schema, issuer, and stored claims are validated, allowing public
  verification to report `expired` with `signature: true`, `issuer: true`, and
  `expiry: false`. Focused credential/service verification passes **17/17**.

### Browser-test fixture isolation

- RED: the mandatory-CI contract showed that a public build variable could enable
  client fixture data independently of the authenticated server adapter.
- GREEN: the public fixture flag and declaration were removed. Dashboard layout
  now enables fixture hooks only for the server-authenticated per-run E2E actor;
  normal production builds default to live APIs. Mandatory auth/fixture coverage
  and dashboard regressions pass, and the production-build Playwright slice remains
  **9/9**.
- Residual boundary: the private server E2E adapter can still be deliberately
  enabled by a self-hosted operator who supplies both its private flag and a
  per-run secret. It remains hard-disabled on Vercel, the approved deployment
  target, and no public/static secret exists.

### Follow-up deterministic evidence

- Frozen install remained unchanged.
- Format, ESLint, TypeScript, Drizzle validation, and provider-free Next production
  build passed.
- Full unit suite: **119 passed / 27 PostgreSQL tests skipped without a URL**.
- Local PostgreSQL 18: **27/27 passed**.
- Authenticated production-build Playwright: **9/9 passed**.
- No Neon, GitHub, Vercel, DNS, or production write occurred during this wave.
