# ADR-0001: Adopt Next.js App Router

- Status: Accepted
- Date: 2026-08-16
- Baseline: `b22f167ae5960dc2a510678524827bfb1427b7ea`

## Context

HermesPass currently runs on the Lovable/TanStack Start stack. Phase 0 must replace that runtime without changing the product contract: all 44 URLs, per-route metadata, visuals, responsive behavior, and mock interactions must remain intact.

The migration needs a production-supported React framework, deterministic parity evidence, and a deployment path that does not introduce data stores, authentication, secrets, environment variables, or new product behavior.

## Decision

HermesPass will use Next.js 16.3.1 with the App Router and Vercel as the deployment target.

- React 19 and Tailwind CSS 4 remain in place.
- Server page wrappers own route metadata.
- Stateful page bodies live in focused client components.
- Locale conversion, validation, constants, and types remain server-safe; React locale context is isolated in a client-only module.
- The TanStack/Lovable source stays available during the incremental port and is removed only after route slices pass.
- `legacy/vite` is frozen at `b22f167` as the visual and behavioral reference.
- Phase 0 contains no feature work and no public API, schema, environment-variable, authentication, or product-behavior changes.
- Publication, Vercel connection, production deployment, and domain changes require separate explicit approval.

## Consequences

- App Router file-system routes replace the generated TanStack route tree.
- Client boundaries must be declared explicitly for hooks, contexts, browser APIs, and stateful interactions.
- CI must prove formatting, linting, type safety, unit tests, production build, the 44-route contract, representative interactions, and bounded visual parity against the frozen legacy runtime.
- Phase 0 remains incomplete until production approval and post-deploy verification; preview verification alone is reported as awaiting approval.
