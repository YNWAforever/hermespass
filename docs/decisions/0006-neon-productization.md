# ADR-0006: Neon productization boundary

## Status

Accepted for local Phase 5 implementation; hosted/provider execution remains separately gated.

## Decision

HermesPass productization extends the existing Neon Postgres, Neon Auth, Drizzle, forced-RLS, actor-claim, and hash-chained-audit architecture in one additive product layer. Organization tiers/invites, hashed public verification keys and usage metering, compliance report read models, Stripe Billing state, and agent messages use the pooled hermes_app role and reviewed security-definer functions. No Supabase package, Auth foreign key, service-role bypass, plaintext token, raw provider payload, or private key is introduced.

Stripe Billing, n8n, and Cloudflare Email Routing are request-time adapters and documented handoffs. Missing configuration fails closed at the request boundary; static builds remain configuration-free. Creating provider resources, registering webhooks, attaching domains, publishing branches, running production migrations, and seeding customer organizations require separate approval.

## Consequences

- Existing migrations remain immutable; new schema work is append-only after 0012_insurance_lifecycle.
- Tenant identity is derived from the authenticated actor, a validated invite, a hashed API key, a public DID, or a verified provider customer id.
- Public verification returns only safe agent/DID fields and records a bounded metering row atomically.
- Reports are pure mapping functions over an authoritative tenant-scoped read model and chain verification result.
- Signup is enabled only through the Neon Auth onboarding page; users without a membership remain denied from dashboard and protected APIs.
- Phase status remains preview verified, awaiting approval until external provider and production evidence exists.
