# ADR-0005: Neon Insurance Lifecycle

- Status: Accepted for Phase 4 implementation
- Date: 2026-08-20
- Baseline: `d7d0d65af928292407eb78f4d20a263be8a92d5c`

## Context

The supplied Phase 4 brief predates the Neon migration and describes Supabase tables, service-role helpers, and a separate server directory. HermesPass now has Neon Postgres, Neon Auth, Drizzle, forced RLS, transaction-local actor/worker claims, per-agent advisory locks, and a hash-chained audit trigger. Insurance must extend those boundaries without introducing a second data/auth provider.

## Decision

Phase 4 uses a standalone Neon/Drizzle insurance lifecycle:

- A deterministic mock `InsurerAdapter` supports quote and bind. AIA and Zurich remain disabled until explicit partner API access exists.
- Insurance never gates payment authorization, card provisioning, gateway policy evaluation, or settlement.
- Owners/admins may quote and bind; viewers read only.
- One non-terminal current policy is allowed per agent. Terminal policy rows and append-only policy events remain addressable history.
- Quote insertion, bind reservation/finalization, commission creation, provider-event deduplication, and audit writes use forced-RLS SQL functions and per-agent advisory locks.
- Commission is fixed at 20% in Phase 4 and uses integer cents with floor rounding.
- Provider status webhooks require a request-time `INSURANCE_WEBHOOK_SECRET`, a 16 KiB body cap, strict safe-field parsing, and idempotent `(insurer, provider_event_id)` handling.
- No hosted Neon, Vercel, partner, production, secret, domain, push, PR, merge, or webhook-registration mutation is part of local implementation.

## Consequences

The module can be tested fully against disposable PostgreSQL 18 without provider credentials. Adapter calls remain replaceable, but bind uses a reservation/token state so a crashed caller cannot finalize a newer attempt. The current dashboards remain unchanged; a later productization surface can consume the safe policy read API. Production configuration and partner onboarding remain explicit release gates.