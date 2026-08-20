# HermesPass Phase 2 — Neon Policy Gateway Design

- Status: Approved for implementation
- Date: 2026-08-18
- Baseline: `8131e8f5783174d82e6ca34c21fa47ed8dc552b5`
- Branch: `codex/phase-2-policy-engine`

## Baseline and release boundary

Phase 2 starts from the merged Phase 1 baseline. Commit `47d7694` is an
ancestor of `origin/main`, and the reviewed Phase 1 tip `95693a9` is an
ancestor of this worktree's baseline. The worktree is indexed as
`Hermespass-phase2-policy-engine` in moderate mode with 1,327 nodes and 2,639
edges.

Phase 1 already owns migration `0001_phase1_security_hardening`, so the Phase 2
migration is additive and must be named `0002_policy_gateway`. Phase 2 provider
work is limited to development and ephemeral Neon branches. It does not
authorize production migrations, runtime credentials, bot or webhook setup,
Vercel changes, seeding, or release.

The approved Neon development target is project `curly-smoke-16875897`, branch
`br-late-waterfall-azytvnd8` (`development`). Its `hermes_app` role has `LOGIN`
enabled and `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, and `INHERIT`
disabled. The production branch currently has no `hermes_app` role. Creating
that role and applying the Phase 1 and Phase 2 production migrations are a
later, separately approved release gate; this phase must not repair or mutate
production while implementing or verifying preview behavior.

## Scope and ownership

HermesPass becomes a decision service for signed agent actions. It authenticates
an external agent key, evaluates the agent's active passport and immutable
policy version, and returns `allow`, `deny`, or `hold`. It stores only safe
action metadata and digests, never raw tool parameters.

Phase 2 ends at authorization. It does not execute connectors or downstream
tools, create cards or AP2 mandates, or move money. Those execution concerns
belong to Phase 3 or later and are explicitly excluded from this design.

The server-side gateway, not the browser or caller, owns organization, agent,
policy, reviewer, and spend context. Phase 1's Neon Auth membership boundary,
transaction-local tenant claim, forced RLS, restricted pooled runtime role,
and stable `{ data }` / `{ error }` envelopes remain authoritative.

## Signed request contract and BYOK

`POST /api/gateway/decide` accepts a versioned action and signature. The signed
bytes use the RFC 8785 JSON Canonicalization Scheme. Requests are limited to
16 KiB and include a payload digest, nonce, timestamp, declared tool, safe
summary, and optional HKD spend metadata instead of raw tool parameters.

Agents use externally generated Ed25519 keys through bring-your-own-key
enrollment. A 15-minute, single-use enrollment token allows proof of possession
and activates only the submitted public JWK. The token is stored only as a
hash. Activating a key revokes the prior active key but retains its public
history for verification. External keys have no encrypted private fields.
Existing `legacy_encrypted` Phase 1 keys are never decrypted for gateway use;
those agents must rotate through BYOK enrollment.

Unknown agents and invalid signatures share the same `401 AGENT_AUTH_FAILED`
response. Valid signatures with stale, revoked, or policy-denied context produce
audited decisions without revealing sensitive lookup state. Exact signed retries
for an agent and nonce return the stored current result; different canonical
bytes for the same pair return `409 NONCE_CONFLICT`.

## Policy decisions and concurrency

Policies are immutable and versioned per agent. Each policy assigns exactly one
eligible organization owner or admin as reviewer and defines HKD transaction,
daily, monthly, approval-threshold, and optional merchant-category limits.
Only the assigned reviewer may resolve the resulting hold, with an organization
owner permitted to override. Viewers and unassigned admins cannot resolve it.

For a new valid request, first match wins:

1. Deny an inactive, revoked, or expired passport or inactive key.
2. Deny a tool outside passport scope.
3. Allow a non-spend request.
4. Deny spend with no active policy.
5. Deny non-HKD spend.
6. Deny an amount above the passport cap.
7. Deny a required or mismatched merchant category.
8. Deny a per-transaction, daily, or monthly limit breach.
9. Hold an amount above the approval threshold.
10. Hold high-risk agent spend.
11. Otherwise allow.

Final allows consume capacity immediately. Daily and monthly windows use
`Asia/Hong_Kong`. Allow authorizations expire after five minutes and pending
holds auto-deny after four hours.

Policy version allocation, gateway replay/evaluation, spend aggregation, and
approval resolution run in Neon transactions with per-agent transaction-level
advisory locks. This serialization makes concurrent requests unable to exceed
an agent's caps and ensures web, Telegram, expiry, and owner override resolution
have one database winner. Network delivery occurs only after the hold commits.

## Persistence and row security

Migration `0002_policy_gateway` adds immutable `agent_policies`, idempotent
`gateway_requests`, one-to-one `pending_approvals`, hashed and expiring
`agent_key_enrollments`, `telegram_links`, and hashed `telegram_link_tokens`.
It also distinguishes `legacy_encrypted` from `external` agent-key custody and
stores safe member name/email snapshots without foreign keys into provider-owned
Neon Auth tables.

Every new tenant table has forced RLS. Owners and admins may issue enrollment
tokens and create new policy versions. Read and mutation rules are scoped by
server-verified organization membership, with the narrower assigned-reviewer
rule applied to hold resolution.

## Human review surfaces

The web dashboard lists activity and approvals through React Query. It polls
every three seconds only while the page is visible; Pause stops polling and
Resume restarts it. The UI shows request digest, key thumbprint, policy version,
assigned reviewer, authorization expiry, and Telegram delivery state.

Telegram is an optional private-DM channel for the one assigned reviewer. A
10-minute deep-link token binds the reviewer's immutable numeric Telegram user
identity. The webhook verifies its secret header and uses the same atomic
`resolveApproval` service as the web, expiry, and owner-override paths. Delivery
attempts are durable and retryable; a Telegram failure never removes the web
approval. An idempotent, advisory-locked hourly job retries failed delivery and
expires four-hour holds.

Production and nonproduction must use different bot tokens, webhook secrets,
and cron secrets. No provider setup is part of this documentation slice.

## Audit integration

Policy creation, key enrollment and rotation, gateway decisions, approval
creation and resolution, delivery state, and expiry append attributable events
through Phase 1's existing audit service and canonicalization trigger. The
existing per-organization transaction advisory lock, chain position, previous
hash, and verification endpoint remain the source of truth. Phase 2 must not
create a parallel event log or weaken the append-only application-role boundary.

Retries return stored state and must not duplicate audit or spend rows. A hold
that later resolves remains one request and one approval with an attributable
resolution event, preserving a verifiable hash chain across both automatic and
human decisions.

## Acceptance and later gates

Implementation must prove RFC 8785 interoperability, signature tamper failure,
nonce conflict handling, exact rule ordering, authorization expiry, concurrent
cap enforcement, tenant and reviewer isolation, single-winner resolution,
Telegram retry durability, and audit-chain validity. Existing public routes,
metadata, and wallet mocks remain unchanged.

Preview verification uses development or ephemeral Neon branches only. A later
production release requires separate approval to create the restricted
production role, apply reviewed migrations, configure distinct production
secrets and integrations, seed approved identities, and run post-release
verification.
