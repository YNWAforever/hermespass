# HermesPass Phase 1 — Neon Identity and Audit

## Summary

Replace the Phase 1 Supabase design with Neon Postgres, Neon Auth, Drizzle,
Ed25519, W3C VC 2.0 JOSE, `did:web`, and a hash-chained audit log. Preserve
the 39 public marketing routes and the dashboard’s existing mock wallets,
approvals, events, and streams. Make only identity, agent records, and
Compliance audit data persistent.

Baseline is the Phase 0 merge `145f17c538cf35dd45df1a7547606880b07ce63c`.
The implementation branch is `codex/phase-1-identity-audit`. Neon/Vercel
project creation and production changes require separate approval.

## Architecture

- Use `@neondatabase/auth` behind a local server-only auth adapter. Add a
  custom `/login`, the catch-all Auth handler, and `src/proxy.ts`. Reject
  public signup requests; application access requires one `org_members` row.
- Use Drizzle schema plus reviewed SQL migrations. Runtime uses a pooled,
  non-owner `hermes_app` role with forced RLS. Owner/direct credentials are
  migration-only and never enter Vercel runtime environments.
- Set a verified transaction-local user claim before tenant queries. Public
  DID/verification reads use narrow security-definer functions.
- Create organizations, memberships, issuer keys, agents, agent keys, and
  append-only audit rows. Defer policies, approvals, wallets, and money
  movement to later phases.
- Encrypt every private JWK with a random AES-256-GCM DEK wrapped by the
  environment-specific AES-256-KW key `HERMES_KEK_V1`. Production and
  nonproduction keys/cookie secrets are distinct.
- Issue one-year Ed25519-signed W3C VC 2.0 credentials, publish production
  `did:web:hermespass.asia` documents, and retain revoked DID documents and
  public keys for historical verification.
- Make `/api/agents`, revocation, audit listing/verification/export, public DID
  documents, and `/api/verify` use stable `{data}` / `{error}` envelopes.
- Remove identity state from the mock Hermes store, add live React Query
  agent/audit hooks, preserve mock dashboard behavior, and ensure issuance
  never creates a wallet.

## Implementation tasks

1. Verify the baseline, index the worktree with codebase-memory, create ADR-0002,
   and keep the plan in this file.
2. Add dependencies, environment validation, Drizzle configuration, schema,
   migrations, runtime role boundaries, RLS, Neon Auth, login, and dashboard
   access checks.
3. Add failing crypto tests, envelope encryption, issuer/agent keys, VC/JWS
   signing and verification, DID documents, context metadata, and the audit
   trigger/hash verifier.
4. Implement atomic issuance and revocation APIs, live agent/audit queries,
   the dashboard wiring, Compliance CSV hardening, and safe public responses.
5. Add PostgreSQL 18 integration tests, Neon ephemeral-branch smoke tests,
   authentication tests, route/interaction tests, and public-only visual
   parity checks.
6. After approval, create the dedicated Neon project in the Vercel-managed
   organization, keep `development` as the preview parent, connect production
   to an isolated production branch, seed only nonproduction test data, and
   verify the Vercel preview.
7. After separate production approval, attach the domain, create the
   production issuer, seed the approved operators/agents, and rerun all
   verification suites.

## Acceptance

- No Supabase runtime or configuration remains.
- All 39 public marketing routes remain unchanged; all five dashboards redirect
  signed-out users and render live identity data for authorized users.
- Owner/admin issuance and revocation are atomic, audited, and publicly
  verifiable without exposing private material.
- Cross-tenant, viewer-mutation, missing-claim, audit-tamper, rollback, and
  encryption-integrity tests pass.
- Production is not declared complete until the preview and post-domain
  verification gates are approved and green.
