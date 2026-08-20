# ADR-0006: Neon-First Production Release Gate

## Status

Accepted for Phase 6 repository work; hosted rollout remains pending explicit release approval.

## Decision

Define the missing Phase 6 as a Neon-first production-release and verification track. Keep release automation offline and deterministic, validate only configuration shape and repository evidence, and separate local source gates from hosted-provider gates. Preserve the Phase 5 Neon architecture and reject the older Supabase wording in the supplied roadmap where it conflicts with the current product decision.

The inbound communications contract accepts the documented `x-hermespass-comms-secret` header alias alongside the existing aliases. All aliases use the same constant-time comparison and no secret is persisted or emitted.

## Rationale

The repository has no numbered Phase 6 plan, while the whole-build definition of done is dominated by production evidence. A pure preflight provides useful, reviewable progress without fabricating Neon, Vercel, Cloudflare, Stripe, n8n, DNS, or customer state. Provider mutation is intentionally outside this ADR because credentials, ownership, and production approval are not present in the repository.

## Consequences

- Local CI can prove migration hygiene, route contracts, role separation, and secret-literal absence without provider access.
- Launch readiness remains visibly incomplete until external evidence is attached.
- A later operator run must supply provider-specific credentials through protected contexts; none belong in the repository or runtime logs.
- The Phase 5 communications route remains compatible with the attached Cloudflare worker contract without coupling application code to Cloudflare.
