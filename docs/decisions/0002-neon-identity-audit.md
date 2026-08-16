# ADR-0002: Use Neon for Identity and Audit Persistence

- Status: Accepted
- Date: 2026-08-16
- Baseline: `145f17c538cf35dd45df1a7547606880b07ce63c`

## Context

Phase 1 needs durable agent identities, issuer and agent keys, credentials,
organization membership, and a tamper-evident audit chain. The Phase 0
Next.js/Vercel runtime has no persistence or authentication yet. The database
must isolate organizations, support preview branches, and avoid exposing a
database-owner connection to application code.

## Decision

HermesPass will use a dedicated Neon PostgreSQL 18 project in AWS Singapore,
created under the Vercel-managed organization selected for this repository.
The application will use Neon Auth for user sessions and Drizzle with
`@neondatabase/serverless` for database access.

- The runtime connection uses a pooled, non-owner `hermes_app` role with forced
  row-level security. Migration-only owner credentials remain outside Vercel
  runtime environments.
- The Neon default branch is nonproduction `development`; production is an
  isolated sibling branch. Vercel previews branch from `development`, while
  production is explicitly connected to the production branch.
- Neon Auth identities remain provider-managed. HermesPass authorization is
  owned by `org_members`, keyed by the Auth user ID as text and limited to one
  organization per user in Phase 1.
- Issuer and agent private JWKs use per-record AES-256-GCM DEKs wrapped by an
  environment-specific AES-256-KW key. No plaintext private key is stored in
  Neon.
- Credentials use Ed25519 signatures, W3C VC 2.0 JOSE, and `did:web`.
- Audit rows are append-only to normal application roles, hash chained per
  organization under a transaction advisory lock, and verifiable through a
  dedicated endpoint.
- Phase 1 does not add money movement, policies, approvals persistence, or
  product features beyond replacing identity and Compliance mock data.

## Consequences

Neon branching gives each preview an isolated database and Auth state, but
production data must never be used as the preview parent. The application
must keep all Auth and database calls server-side, set a transaction-local
tenant claim before protected queries, and test the role/RLS matrix in CI.
The database owner can still alter data, so the audit chain is tamper-evident
to the application role rather than an immutable ledger against platform
administrators.

Project creation, Vercel integration, key provisioning, user seeding, domain
attachment, and production deployment remain explicit approval gates.
