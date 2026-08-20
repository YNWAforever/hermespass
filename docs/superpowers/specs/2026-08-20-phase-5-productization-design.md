# HermesPass Phase 5 — Neon Productization Design

**Status:** Design draft for review  
**Baseline:** Phase 4 commit `2c54128b76ae416e93180735da36ff1142380c08`  
**Scope:** Local Neon-native product foundations; provider setup remains separately approved

## Goal and boundary

Phase 5 turns the Phase 4 control plane into a sellable B2B2B product while retaining the existing marketing pages, dashboard metadata, gateway, payments, insurance, audit chain, and forced-RLS model. The implementation uses one additive Neon/Drizzle product layer. Stripe Billing, n8n, and Cloudflare are represented by request-time adapters, importable workflow/configuration artifacts, deterministic test doubles, and explicit release checklists; no provider account, webhook, DNS, Vercel, or production data is mutated by this phase.

The Supabase-era examples in the supplied brief are design inputs only. No Supabase package, schema, Auth foreign key, service-role bypass, raw token storage, or direct client-side privileged write is introduced.

## Architecture decision

Use a single bounded product layer in the existing `public` Neon schema, appended after migration `0012_insurance_lifecycle`:

1. `0013_productization_core` adds organization tiers and billing identity, hashed invite/API-key material, usage metering, billing-event idempotency, and per-agent messages. It also adds composite tenant foreign keys, forced RLS, role-aware policies, and narrow system/public SQL functions.
2. Drizzle schema definitions remain the source for tables, enums, indexes, and constraints. Reviewed SQL owns roles, grants, RLS, security-definer functions, advisory locks, and audit append boundaries. `drizzle-kit push` is never used against hosted branches.
3. Server routes are thin adapters around pure services. All authenticated mutations use `requireActor` plus `withActorTransaction`; all system/public writes use narrowly scoped SQL functions with transaction-local claims. No route accepts organization identity from the browser when it can be derived from the actor, invite, API key, agent DID, or provider customer id.
4. Public verification reads only safe DID/agent projections and records a metering row through a locked SQL function. It never exposes governance notes, credentials, private keys, membership data, or raw API-key material.
5. Compliance report builders are pure functions. The route builds a tenant-scoped read model from the audit/gateway/approval chain, verifies the chain, and returns JSON or formula-safe CSV. A session is required for dashboard use; the n8n bearer path requires `REPORT_EXPORT_SECRET`, an explicit organization id, constant-time secret comparison, and the same safe read projection.
6. Billing is lazy and request-time configured. Checkout is owner-only; webhook signatures are verified before parsing, events are idempotent, and the tier is changed only from an active mapped subscription. Missing billing configuration returns a normalized 503 and never fails a static build.
7. Communications inbound is a narrow authenticated JSON adapter for a Cloudflare Email Worker. It validates a bounded body and recipient address, resolves the agent by slug, stores a safe message, and appends `email.receive` through a system audit function. Cloudflare parsing/routing remains an external handoff documented in the release runbook.

## Authentication and onboarding

Phase 1's administrator-provisioned login is extended deliberately for productization. The existing Neon Auth adapter remains authoritative; the new `/signup` page uses the standalone Neon Auth client, and the server creates the organization only after a verified session exists. Direct Auth requests that do not carry the supported signup flow remain rejected or membership-less. Signup never accepts a role, organization id, tier, or invite from the browser. If the Neon Auth deployment requires email confirmation, the pending account is redirected through the existing callback before organization creation.

An authenticated user may create exactly one organization and becomes its owner. Owner/admin members may create short-lived, single-use invites for `admin` or `viewer`; invite tokens are random, stored only as SHA-256 hashes, expire, and are consumed in one locked transaction. Acceptance requires the signed-in email to match a non-empty invite email and rejects a second organization membership. Existing one-membership-per-user and role rules remain enforced by database constraints and RLS.

## Data model

### Organization and billing state

`organizations` gains `tier` (`pilot`, `starter`, `growth`, `scale`), nullable Stripe customer/subscription identifiers, and timestamps already present in Phase 1. A reviewed `hermes_tier_agent_limit` function returns 3/5/25/100 and is called inside issuance transactions. A tier downgrade never deletes agents; new issuance fails with a normalized 402 until usage is within the new limit.

### Invites

`org_invites` contains organization id, normalized email, role, token hash, inviter user id, expiry, accepted timestamp, and audit timestamps. There is a uniqueness rule preventing two live invites for the same organization/email, composite tenant integrity, and forced RLS. Plaintext tokens are returned exactly once to the owner/admin response and never stored or logged.

### Public API keys and metering

`api_keys` contains organization id, name, twelve-character display prefix, SHA-256 key hash, creator snapshot, creation/revocation timestamps, and last-used time. `api_usage` contains key id, endpoint, status, request timestamp, and a bounded request id. A composite key/organization relationship and forced RLS prevent cross-tenant rows. A security-definer `hermes_consume_api_key` function locks the key, verifies revocation, applies a 60-request rolling one-minute limit, and inserts the usage row atomically. Public verification uses `hp_live_` keys and returns only safe passport status, DID, name, risk, scopes, expiry, and a reason.

### Billing events

`billing_events` stores provider event id, customer id, event type, received timestamp, and a safe payload digest. A unique provider event id makes Stripe webhook retries idempotent. Raw Stripe payloads and secrets are not persisted.

### Agent messages

`agent_messages` contains organization/agent ids, inbound/outbound direction, normalized from/to addresses, bounded subject/body text, provider message id, received timestamp, and a digest for replay detection. Composite tenant FKs, an agent-address index, forced RLS, and a system insert function preserve tenant isolation. Message bodies are capped at 16 KiB and never enter audit payloads.

## HTTP contracts

All new application routes use the existing `{ data: ... }` success and `{ error: { code, message, requestId, fieldErrors? } }` failure envelope.

- `POST /api/orgs` — authenticated first-organization creation; owner is server-derived.
- `POST /api/invites`, `POST /api/invites/accept`, `GET /invite/[token]` — role-gated invite lifecycle with no token echo after consumption.
- `POST /api/apikeys`, `POST /api/apikeys/[id]/revoke` — owner/admin key management; full key returned once.
- `GET /api/v1/verify/[did]` — bearer-key metered public verification with 401/404/429 envelopes and no raw organization data.
- `GET /api/reports/compliance` — IMDA or HKMA JSON/CSV; session or explicitly configured export bearer.
- `POST /api/billing/checkout` — owner-only Stripe Billing checkout; absent config is 503.
- `POST /api/webhooks/stripe-billing` — signed, idempotent subscription state updates.
- `POST /api/comms/inbound` — secret-header authenticated inbound email adapter; 16 KiB body limit and safe recipient resolution.

## Pure report and export design

`src/lib/reports/imda.ts` and `src/lib/reports/hkma.ts` receive a typed `ReportInput` containing period, chain result, agents, decision counts, and approval latency/timeout counts. They return stable section ids, framework labels, findings, and exceptions. Report text never claims a control that is not represented in the input. CSV is generated by one shared formula-injection guard that prefixes cells beginning with `=`, `+`, `-`, `@`, control characters, or whitespace followed by those characters. The dashboard exposes separate IMDA/HKMA download links while retaining the existing print action.

## Provider adapters and release gates

Stripe uses the existing `stripe` dependency and request-time `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, and three price ids. n8n receives an importable `ops/n8n/compliance-report.json` with placeholders, no embedded secret, and a human setup checklist. Cloudflare receives a documented worker payload contract and secret-header requirement; no Cloudflare API call is made. New environment accessors fail closed at request time and are blank in `.env.example`.

`docs/launch-readiness.md` records Singapore-first evidence requirements: Neon/Vercel region and branch separation, secret inventory, RLS two-tenant proof, audit verification after restore, public API rate-limit evidence, report review, penetration testing, and uptime alerting. Unchecked external items keep the release status “preview verified, awaiting approval.”

## Verification strategy

- Unit tests cover API-key generation/hash, invite token hashing/expiry, tier limits, report section/exceptions, CSV formula safety, Stripe price mapping, webhook idempotency, and comms body/address validation.
- PostgreSQL 18 tests apply migrations from the Phase 4 baseline and cover fresh/upgrade paths, forced RLS, role/tier limits, cross-tenant denial, single-use invites and API keys, metering concurrency, audit append integrity, billing-event idempotency, and comms system inserts.
- Browser tests cover signup/onboarding fixtures, invite acceptance, key creation without browser token persistence, report downloads, billing configuration error states, and inbound comms rejection/success fixtures. Existing 39 public routes, five dashboards, interactions, and visual parity remain required.
- Final local gates are frozen install, formatting, lint, typecheck, Vitest, Drizzle check/no-diff, PostgreSQL 18 integration, production build, and Playwright. Hosted Neon, Stripe, n8n, Cloudflare, Vercel, DNS, and production seed gates remain explicit approvals.

## Explicit non-goals

This phase does not execute downstream agent tools, create production Stripe products, register Cloudflare routes, import or run n8n, attach domains, seed customer organizations, change DNS, push branches, open/merge PRs, or claim compliance certification. Transaction take-rate and insurance commission invoicing remain reporting/manual work as described in the supplied brief.
