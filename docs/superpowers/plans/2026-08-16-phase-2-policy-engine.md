# HermesPass Phase 2 — Neon Policy Gateway and Human Accountability

> Status: approved for implementation on 2026-08-18.
>
> Approved reconciliation: base work on merged Phase 1 commit `8131e8f`;
> generate additive migration `0002_policy_gateway` because Phase 1 already
> owns `0001_phase1_security_hardening`; use development and ephemeral Neon
> branches only until the separate production release gate is approved.

## Summary

Build a signed authorization service that returns `allow`, `deny`, or
`hold`; supports assigned human review through the web and Telegram; and
records every attributable decision in the existing hash-chained audit log.

Execution requires:

- `origin/main` contains Phase 1 commit `47d7694` as an ancestor.
- Phase 1’s Neon preview is verified and merged.
- The dedicated Neon project and restricted `hermes_app` runtime role exist
  on the development branch.

Use Next.js 16.3.1, Neon Postgres 18, Drizzle 0.45.2,
`@neondatabase/serverless` 1.1.0, `@noble/curves` 2.3.0,
`canonicalize` 3.0.0, Node 22, and Bun 1.3.14. Interactive transactions
retain the non-`BYPASSRLS` pooled-role pattern recommended by Neon.

## Public Interfaces and Data Model

### Signed gateway request

```ts
type GatewayActionV1 = {
  version: "1";
  agentDid: string;
  keyId: string;
  tool:
    | "catalog.read"
    | "crm.read"
    | "refund.issue"
    | "email.dispatch"
    | "checkout.external"
    | "invoice.approve"
    | "ads.bid"
    | "vendor.contract";
  summary: string;
  justification: string | null;
  payloadDigest: string;
  amountCents: number | null;
  currency: "HKD" | null;
  merchantCategoryCode: string | null;
  nonce: string;
  timestamp: string;
};

type SignedGatewayRequest = {
  action: GatewayActionV1;
  signature: string;
};

type GatewayDecisionDto = {
  requestId: string;
  decision: "allow" | "deny" | "hold";
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
  approvalId: string | null;
  decidedAt: string;
  authorizationExpiresAt: string | null;
  retryAfterSeconds: number | null;
};
```

Canonical bytes follow RFC 8785 JSON Canonicalization Scheme. Bodies are
limited to 16 KiB and never contain raw tool parameters.

`POST /api/gateway/decide` returns the Phase 1 `{ data }` or `{ error }`
envelope. Exact signed retries with the same agent and nonce return the stored
current result; different bytes produce `409 NONCE_CONFLICT`.

### Policy order

For a new, validly signed request, first match wins:

1. Inactive/revoked/expired passport or inactive key → deny.
2. Tool outside passport scope → deny.
3. Non-spend request → allow.
4. No active policy → deny.
5. Currency other than HKD → deny.
6. Amount above passport cap → deny.
7. Required/mismatched MCC → deny.
8. Per-transaction, daily, or monthly limit exceeded → deny.
9. Amount above approval threshold → hold.
10. High-risk agent spend → hold.
11. Otherwise → allow.

Final allows consume daily/monthly capacity immediately. Windows use
`Asia/Hong_Kong`. Allow authorizations expire after five minutes; pending
holds auto-deny after four hours. HermesPass does not execute downstream tools.

### Neon model

Add:

- Immutable, versioned `agent_policies` with HKD limits, MCC allowlist, and
  assigned owner/admin reviewer.
- Idempotent `gateway_requests`, uniquely keyed by agent and nonce.
- One-to-one `pending_approvals` with resolution and Telegram-delivery state.
- Hashed, expiring `agent_key_enrollments`.
- `telegram_links` and hashed `telegram_link_tokens`.
- Safe member email/name snapshots without foreign keys to Neon-managed Auth
  tables.

Update `agent_keys` for `legacy_encrypted` and `external` custody.
External keys have no encrypted private fields. Existing Phase 1 agents must
rotate through BYOK enrollment before gateway access; legacy private keys are
never decrypted.

Force RLS on every new tenant table. Owners/admins edit policies and issue
enrollment tokens. Only the assigned reviewer or organization owner resolves a
hold; viewers remain read-only.

## Implementation Changes

### Task 1: Baseline and decisions

- [ ] Verify `git merge-base --is-ancestor 47d7694 origin/main`.
- [ ] Create `codex/phase-2-policy-engine` in an isolated worktree.
- [ ] Reindex codebase-memory.
- [ ] Persist the approved design, canonical Phase 2 plan, and ADR-0003.
- [ ] Record decision-service scope, BYOK, Neon transaction locking, assigned
      reviewers, short polling, Telegram DMs, and no Phase 3 execution.
- [ ] Commit documentation only.

### Task 2: Schema, RLS, and concurrency

- [ ] Write failing PostgreSQL tests first.
- [ ] Extend the Drizzle schema and generate `0002_policy_gateway`.
- [ ] Add reviewed SQL for constraints, grants, forced RLS, narrow gateway
      functions, and transaction-local verified-agent claims.
- [ ] Use per-agent advisory locks for policy versioning, gateway decisions, and
      spend aggregation.
- [ ] Preserve the existing audit canonicalization trigger and append
      policy/key/gateway/approval events through it.
- [ ] Add `pg@8.22.0` and `@types/pg@8.20.0` only for PostgreSQL
      service-container tests.
- [ ] Commit the database slice.

### Task 3: BYOK enrollment and policy management

- [ ] Add owner/admin endpoints to create 15-minute single-use enrollment
      tokens.
- [ ] Add a public token endpoint that verifies Ed25519 proof of possession and
      activates only the submitted public JWK.
- [ ] Revoke the previous active key while retaining its public history.
- [ ] Stop generating new agent private keys during passport issuance.
- [ ] Add protected member-list and policy GET/PUT APIs; PUT creates a new
      immutable version.
- [ ] Add Agent Directory key-status, enrollment, reviewer, threshold, and MCC
      controls.
- [ ] Audit every enrollment and policy change.
- [ ] Commit the identity/policy slice.

### Task 4: Pure policy engine and gateway

- [ ] Add failing canonicalization, signature, schema, rule-order, expiry, and
      idempotency tests.
- [ ] Implement focused `policy` modules with zero database or network I/O.
- [ ] Implement the gateway orchestration transaction: safe key lookup,
      signature verification, freshness, replay lookup, advisory lock,
      policy/spend evaluation, request insertion, approval creation, and audit
      append.
- [ ] Valid signatures with stale/revoked/over-limit context return audited
      HTTP 200 denials.
- [ ] Unknown agents and bad signatures share `401 AGENT_AUTH_FAILED`;
      malformed and oversized input return 400/413.
- [ ] Store only digests and signed safe metadata.
- [ ] Provide an integration CLI that reads an external private JWK path
      without printing or committing it.
- [ ] Commit the gateway slice.

### Task 5: Web and Telegram approvals

- [ ] Add a shared atomic `resolveApproval` service used by web, Telegram,
      expiry, and owner override paths.
- [ ] Add protected approval listing/resolution APIs.
- [ ] Add 10-minute Telegram deep-link tokens and private reviewer linking.
- [ ] Verify the Telegram webhook secret header and immutable numeric user
      identity.
- [ ] Commit holds before sending; persist delivery attempts and retry failures.
- [ ] Add an idempotent, advisory-locked hourly cron that retries delivery and
      expires four-hour holds.
- [ ] Commit the approvals slice.

### Task 6: Live dashboard

- [ ] Replace mock gateway events with activity and approval React Query hooks
      polling every three seconds while visible.
- [ ] Preserve Pause/Resume by pausing polling.
- [ ] Show request digest, key thumbprint, policy version, reviewer,
      authorization expiry, and Telegram delivery state.
- [ ] Populate overview KPIs and charts from gateway-request aggregates.
- [ ] Remove mock events, streaming generation, mock resolution, and mock
      escalation from the Hermes store.
- [ ] Retain wallet mocks and all dashboard metadata.
- [ ] Commit the dashboard slice.

### Task 7: CI and release gates

- [ ] Run frozen install, format check, lint, typecheck, Vitest, Drizzle
      validation, PostgreSQL 18 integration tests, production build, and
      Playwright.
- [ ] Test all 39 public routes unchanged and all five dashboards signed out
      and with authorized storage state.
- [ ] Keep deterministic Telegram tests mocked.
- [ ] Extend the approval-gated ephemeral Neon smoke job.
- [ ] After explicit approval, configure distinct nonproduction bot secrets and
      register the preview webhook.
- [ ] Verify BYOK enrollment, policy creation, automatic allow/deny, concurrent
      caps, web approval, Telegram approval, retry, expiry, and audit-chain
      validity on preview.
- [ ] Require separate approval for push/PR and another for production
      migration, production bot/webhook, and release.

## Test and Acceptance Criteria

- RFC 8785 test vectors and reordered-field signatures match.
- Wrong key, modified body, stale timestamp, nonce conflict, and expired
  authorization are rejected deterministically.
- Concurrent spend requests cannot cross per-agent limits.
- Missing policies deny spend but do not block in-scope non-spend actions.
- MCC, passport cap, policy caps, approval threshold, and high-risk rules
  follow the exact order above.
- Enrollment and Telegram tokens expire, are single-use, and reveal no stored
  plaintext token.
- Cross-tenant reads fail; viewers cannot mutate; unassigned admins cannot
  resolve; assigned reviewers and owners can.
- Web and Telegram resolution have one database winner and one audit result.
- An identical held request returns hold, then the human decision, without
  creating duplicate audit or spend rows.
- Telegram failure leaves a durable web approval and retryable delivery state.
- Audit verification remains green after policy, key, gateway, approval, and
  expiry events.
- Public marketing behavior, metadata, dashboard metadata, and wallet mocks
  remain unchanged.

## Assumptions and Gates

- Phase 2 is an authorization service only: no connector execution, cards, AP2
  mandates, or money movement.
- HKD is the only Phase 2 currency.
- Policies are per-agent and versioned; templates and multi-party approval are
  deferred.
- Telegram delivery is a private DM to one linked reviewer, with owner override.
- Production and nonproduction use separate bot tokens, webhook secrets, and
  cron secrets.
- The Vercel production plan must permit hourly cron execution.
- No Supabase package, Realtime service, raw tool payload, agent private key, or
  production secret is introduced.
- Phase 1 release gates passed on 2026-08-18. Until hosted Phase 2 preview
  verification is green, status remains **implementation in progress**.
