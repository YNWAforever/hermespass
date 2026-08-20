# ADR-0003: Use Neon for the Signed Policy Gateway

- Status: Accepted
- Date: 2026-08-18
- Baseline: `8131e8f5783174d82e6ca34c21fa47ed8dc552b5`

## Context

Phase 1 established Neon Auth membership, a restricted `hermes_app` runtime
role, forced row-level security, Ed25519 agent identities, and a hash-chained
audit log. Phase 2 must authorize attributable agent actions, enforce concurrent
spend limits, and route exceptional decisions to an accountable human without
giving HermesPass custody of new agent private keys or authority to execute the
requested action.

Phase 1 already owns migration `0001_phase1_security_hardening`. The approved
development branch has the restricted runtime role, but the production branch
currently does not. Production remains outside this implementation scope.

## Decision

HermesPass will implement a Neon-backed decision service that authenticates a
signed request and returns `allow`, `deny`, or `hold`. It is an authorization
boundary only; Phase 3 connector execution, cards, AP2 mandates, and all money
movement are explicitly excluded.

- Agents use externally generated Ed25519 keys enrolled through a short-lived,
  single-use BYOK proof-of-possession flow. HermesPass stores the public JWK and
  never imports or decrypts an agent private key for gateway use.
- Signed requests use RFC 8785 JSON canonicalization, safe metadata and a
  payload digest. Exact agent-and-nonce retries return stored state; changed
  bytes for the same nonce conflict.
- Policies are immutable and versioned per agent. Each policy assigns one
  organization owner or admin reviewer. The assigned reviewer may resolve a
  hold, an organization owner may override, and viewers or unassigned admins
  may not resolve it.
- Policy versioning, request evaluation, spend accounting, and approval
  resolution use Neon transactions with per-agent transaction-level advisory
  locks. Final allows reserve daily and monthly capacity in the deciding
  transaction.
- Web activity and approvals use three-second short polling while visible, with
  Pause/Resume controlling polling.
- Telegram review is a private DM to the linked assigned reviewer. Web,
  Telegram, expiry, and owner override use one atomic resolution service;
  delivery occurs after commit and failures remain durable for retry.
- Every policy, key, gateway, approval, delivery, and expiry transition appends
  through the existing Phase 1 hash-chained audit integration. Phase 2 does not
  create a separate audit ledger.
- The additive schema migration is `0002_policy_gateway`, because Phase 1
  already owns `0001_phase1_security_hardening`.

## Consequences

Concurrent requests for an agent are serialized at the database decision
boundary, preventing daily or monthly caps from being crossed by races. Human
resolution has one database winner even when web, Telegram, expiry, and owner
override contend. A Telegram outage leaves the committed web approval usable
and retryable.

The dashboard is eventually current within its three-second polling interval
rather than requiring a realtime provider. Existing Phase 1 tenant claims,
forced RLS, restricted runtime credentials, and audit verification remain in
force.

Implementation and hosted checks may use only development and ephemeral Neon
branches. Project `curly-smoke-16875897`, development branch
`br-late-waterfall-azytvnd8`, currently has a `hermes_app` role with `LOGIN`
enabled and `SUPERUSER`, `BYPASSRLS`, `CREATEDB`, `CREATEROLE`, and `INHERIT`
disabled. The production branch currently lacks `hermes_app`; creating it and
applying production migrations are later release gates requiring separate
approval, not work authorized by this decision.
