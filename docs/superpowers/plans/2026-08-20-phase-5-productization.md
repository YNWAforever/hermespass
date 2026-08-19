# HermesPass Phase 5 — Neon Productization Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

Goal: Make HermesPass sellable as a Neon-native B2B2B product with organization onboarding, metered public verification, IMDA/HKMA exports, Stripe Billing adapters, inbound agent messaging, and an evidence-based SG-first release checklist.

Architecture: Extend the Phase 4 Neon/Drizzle schema with additive, forced-RLS tables and reviewed SQL functions. Keep authentication, tenant derivation, actor claims, hash-chained audit, and public DID projections behind the existing services; routes remain thin adapters. Stripe, n8n, and Cloudflare are request-time adapters and documented test-mode handoffs only—this phase does not create provider resources or mutate production.

Tech Stack: Next.js 16.3.1, React 19.2, Neon Postgres 18, Neon Auth, Drizzle ORM 0.45.2/Drizzle Kit 0.31.10, Node 22, Bun 1.3.14, Stripe SDK 22.5.0, Vitest, Playwright, and existing Tailwind 4 UI.

## Global Constraints

- Baseline is Phase 4 commit 2c54128b76ae416e93180735da36ff1142380c08; stop if the isolated worktree does not start there.
- Use branch codex/phase-5-productization in .worktrees/phase-5-productization; do not edit the dirty root checkout.
- Use Neon/Drizzle/Neon Auth only; do not add Supabase packages, Supabase migrations, Auth foreign keys, or service-role bypasses.
- Append migrations after 0012_insurance_lifecycle; never edit 0000–0012, never use drizzle-kit push against hosted branches.
- Runtime database access uses hermes_app and transaction-local verified claims; all tenant tables have forced RLS and composite tenant integrity where a child has both organization and entity ids.
- Store only hashes/digests for invite tokens, API keys, provider events, and message replay ids; never log or persist plaintext secrets, private keys, raw Stripe payloads, or full bearer credentials.
- New request-time secrets are REPORT_EXPORT_SECRET, STRIPE_BILLING_WEBHOOK_SECRET, COMMS_INBOUND_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_GROWTH, and STRIPE_PRICE_SCALE; missing values fail closed at request time and never break static builds.
- Preserve all 39 public routes, five dashboard routes, metadata, existing gateway/payments/insurance behavior, and all existing visual/interactions gates.
- External writes (Neon hosted project, Stripe products, n8n import, Cloudflare routing, Vercel, DNS, push/PR, production seed) require separate approval and are not performed by these tasks.

---

### Task 1: Baseline, ADR, environment boundaries, and plan record

Files:
- Create docs/decisions/0006-neon-productization.md
- Create docs/superpowers/specs/2026-08-20-phase-5-productization-design.md
- Create docs/superpowers/plans/2026-08-20-phase-5-productization.md
- Modify src/lib/env.ts and .env.example
- Test tests/unit/productization-env.test.ts

Interfaces:
- reportExportSecret(): string, stripeBillingWebhookSecret(): string, and commsInboundSecret(): string throw only when their request path is used.
- stripeBillingPrice(tier: "starter" | "growth" | "scale"): string returns the configured price id or throws a named configuration error.

- [ ] Step 1: Verify the baseline and worktree.

    git -C C:\Users\laich\Documents\ChatGPT\Hermespass\.worktrees\phase-5-productization rev-parse HEAD
    git -C C:\Users\laich\Documents\ChatGPT\Hermespass\.worktrees\phase-5-productization status --short --branch

  Expected: 2c54128b76ae416e93180735da36ff1142380c08, branch codex/phase-5-productization, and no tracked changes except the design/plan documents.

- [ ] Step 2: Record ADR-0006. Document the unified Neon product layer, additive migrations, actor/system claims, hashed secrets, public verification metering, pure reports, lazy Stripe adapter, Cloudflare/n8n handoffs, and explicit external-release gates.

- [ ] Step 3: Add request-time environment accessors. Use this exact behavior.

    function required(name: string, message: string): string {
      const value = process.env[name];
      if (!value) throw new Error(message);
      return value;
    }
    export function reportExportSecret() {
      return required("REPORT_EXPORT_SECRET", "REPORT_EXPORT_SECRET is required for report exports");
    }
    export function stripeBillingWebhookSecret() {
      return required("STRIPE_BILLING_WEBHOOK_SECRET", "STRIPE_BILLING_WEBHOOK_SECRET is required for billing webhooks");
    }
    export function commsInboundSecret() {
      return required("COMMS_INBOUND_SECRET", "COMMS_INBOUND_SECRET is required for inbound communications");
    }
    export function stripeBillingPrice(tier: "starter" | "growth" | "scale") {
      return required("STRIPE_PRICE_" + tier.toUpperCase(), "Stripe price is required for billing checkout");
    }

  Add blank entries to .env.example. Do not read them at module import time.

- [ ] Step 4: Write and run the failing environment tests, then implement the accessors. Test missing, present, and partial environments; assert static imports do not throw and request calls throw the exact messages above.

  Run: bun x vitest run tests/unit/productization-env.test.ts
  Expected before implementation: module/function-not-found failures. Expected after implementation: all tests pass.

- [ ] Step 5: Commit the documentation/configuration slice.

    git add docs/decisions/0006-neon-productization.md docs/superpowers/specs/2026-08-20-phase-5-productization-design.md docs/superpowers/plans/2026-08-20-phase-5-productization.md src/lib/env.ts .env.example tests/unit/productization-env.test.ts
    git commit -m "docs: record Neon productization boundaries"

---

### Task 2: Productization schema, RLS, and reviewed database functions

Files:
- Modify src/db/schema.ts
- Create drizzle/0013_productization_core.sql
- Create drizzle/meta/0013_snapshot.json
- Modify drizzle/meta/_journal.json
- Test tests/unit/productization-migration.test.ts and tests/integration/postgres.productization.integration.test.ts

Interfaces:
- Tables: orgInvites, apiKeys, apiUsage, billingEvents, agentMessages.
- Enums: organizationTier (pilot, starter, growth, scale), inviteRole (admin, viewer), messageDirection (inbound, outbound).
- SQL functions: hermes_tier_agent_limit(text), hermes_consume_api_key(text,text,text,int), hermes_accept_org_invite(text,text), hermes_insert_agent_message(uuid,uuid,text,text,text,text,text,text), and hermes_record_billing_event(text,text,text,text).

- [ ] Step 1: Write static migration contract tests. Assert that 0013_productization_core.sql exists, the journal appends exactly one entry after 0012_insurance_lifecycle, snapshots have a unique id with prevId equal to the 0012 snapshot id, and the SQL contains FORCE ROW LEVEL SECURITY, hermes_app, no BYPASSRLS, and no auth./Supabase references.

  Run: bun x vitest run tests/unit/productization-migration.test.ts
  Expected: fail because the migration and snapshot do not exist.

- [ ] Step 2: Add Drizzle table definitions. Add organization tier/Stripe columns and the five tables with:
  orgInvites: id, organizationId, email, role, tokenHash, invitedBy, expiresAt, acceptedAt, createdAt.
  apiKeys: id, organizationId, name, prefix, keyHash, createdBy, createdAt, revokedAt, lastUsedAt.
  apiUsage: id, apiKeyId, organizationId, endpoint, requestId, status, createdAt.
  billingEvents: id, organizationId, providerEventId, customerId, eventType, payloadDigest, receivedAt.
  agentMessages: id, organizationId, agentId, direction, fromAddress, toAddress, subject, bodyText, providerMessageId, payloadDigest, receivedAt.
  Use composite FKs (agentId, organizationId) to agents(id, organization_id) and (apiKeyId, organizationId) to apiKeys(id, organization_id), bounded text checks, timestamp indexes, and unique provider/hash constraints.

- [ ] Step 3: Write reviewed SQL. Add the tier enum/columns, tables, indexes, composite constraints, forced RLS, and policies: members read their organization; owner/admin mutate invites/API keys; viewers cannot mutate; public/system functions use fixed pg_catalog, public, pg_temp search paths and schema-qualified relations. Revoke direct hermes_app writes to token/message/event tables and grant only the named functions. Add advisory locking for API-key window checks and idempotent provider events. Keep audit writes inside the existing canonical append function with system:report, system:billing, or system:comms actors.

- [ ] Step 4: Generate and validate the snapshot.

    bun x drizzle-kit generate --name=productization_core
    bun run db:check

  Expected: no untracked schema diff after the checked-in migration/snapshot are reconciled and Everything's fine.

- [ ] Step 5: Add PostgreSQL 18 integration coverage. The suite must create a fresh and an upgrade database, apply 0000–0013, and prove: tier limits are 3/5/25/100; cross-tenant child inserts fail; viewers cannot insert/update; API-key consumption is single-use/rate-limited under concurrent calls; invite acceptance is single-use; billing event replay is idempotent; system message insertion appends exactly one audit row; direct token/message/event access is denied.

  Run: DATABASE_URL_TEST=<disposable-pg18-url> DB_INTEGRATION_REQUIRED=1 bun x vitest run tests/integration/postgres.productization.integration.test.ts --maxWorkers=1 --fileParallelism=false
  Expected after implementation: all integration cases pass. Stop and remove the named disposable container after the run.

- [ ] Step 6: Commit the database slice.

    git add src/db/schema.ts drizzle/0013_productization_core.sql drizzle/meta/0013_snapshot.json drizzle/meta/_journal.json tests/unit/productization-migration.test.ts tests/integration/postgres.productization.integration.test.ts
    git commit -m "feat(db): add Neon productization tables and RLS"

---

### Task 3: Organization signup, invites, and tier-gated issuance

Files:
- Create src/lib/orgs/service.ts and src/lib/invites/service.ts
- Create src/app/api/orgs/route.ts, src/app/api/invites/route.ts, src/app/api/invites/accept/route.ts
- Create src/components/auth/signup-form.tsx, src/app/signup/page.tsx, src/app/invite/[token]/page.tsx
- Modify src/app/api/auth/[...path]/route.ts, src/lib/agents/service.ts, src/lib/http.ts
- Test tests/unit/onboarding.test.ts, tests/unit/onboarding-api.test.ts, tests/e2e/onboarding.spec.ts

Interfaces:

    createOrganization(actor: { userId: string; email: string | null; name: string | null }, input: { name: string; slug: string }): Promise<OrganizationDto>
    createInvite(actor: Actor, input: { email: string; role: "admin" | "viewer" }): Promise<{ id: string; prefix: string; urlPath: string; expiresAt: string }>
    acceptInvite(actor: Actor, token: string): Promise<{ organizationId: string; role: "admin" | "viewer" }>

- [ ] Step 1: Write failing pure onboarding tests. Cover slug normalization, minimum name/slug validation, email normalization, invite token hash non-reversibility, 15-minute expiry, role restriction, one-membership rule, and tier limit mapping. Run bun x vitest run tests/unit/onboarding.test.ts; expect missing-module failures.

- [ ] Step 2: Implement services with actor transactions. createOrganization rejects an actor with an existing membership, inserts the org/member atomically, and appends organization.created. createInvite calls assertCanMutate, hashes a random token, inserts only the hash, and returns plaintext once. acceptInvite calls the reviewed SQL function with the actor user id and token hash, requires matching invite email when present, and appends organization.invite.accepted.

- [ ] Step 3: Add API routes and normalized errors. Each route calls requireActor, validates JSON with Zod, uses ok/errorResponse, never accepts organizationId from the browser, and maps duplicate membership/invite expiry/tier-limit errors to stable codes. Add TIER_LIMIT_REACHED as HTTP 402.

- [ ] Step 4: Add the Neon Auth signup page. Use the existing Neon Auth client adapter; create the organization only after a session is returned. Update the Auth route to allow the supported email signup request while preserving a membership-less state for uncompleted onboarding. The page must not accept a role, tier, invite token, or organization id. Keep login redirect validation dashboard-only.

- [ ] Step 5: Add invite acceptance UI and issuance tier enforcement. The invite page posts only the token, shows safe errors, and refreshes the dashboard. In issueAgent, call hermes_tier_agent_limit inside the same transaction before inserting the agent; a revoked agent does not consume the limit. Do not change passport metadata or key custody behavior.

- [ ] Step 6: Run unit/API tests and authenticated browser tests.

    bun x vitest run tests/unit/onboarding.test.ts tests/unit/onboarding-api.test.ts
    bun x playwright test tests/e2e/onboarding.spec.ts

  Browser coverage must prove a new org becomes owner, a viewer invite cannot issue an agent, a second organization membership is rejected, and pilot/starter limits return 402/allow without exposing the token after creation.

- [ ] Step 7: Commit the onboarding slice.

    git add src/lib/orgs src/lib/invites src/app/api/orgs src/app/api/invites src/components/auth/signup-form.tsx src/app/signup src/app/invite src/app/api/auth/[...path]/route.ts src/lib/agents/service.ts src/lib/http.ts tests/unit/onboarding.test.ts tests/unit/onboarding-api.test.ts tests/e2e/onboarding.spec.ts
    git commit -m "feat(tenancy): add Neon onboarding invites and tier limits"

---

### Task 4: Hashed API keys and public metered verification

Files:
- Create src/lib/productization/api-keys.ts and src/lib/productization/verification.ts
- Create src/app/api/apikeys/route.ts, src/app/api/apikeys/[id]/revoke/route.ts, src/app/api/v1/verify/[did]/route.ts
- Modify src/lib/http.ts
- Test tests/unit/api-keys.test.ts, tests/unit/public-verification.test.ts, tests/integration/postgres.public-verification.integration.test.ts, tests/e2e/public-verification.spec.ts

Interfaces:

    type GeneratedApiKey = { key: string; prefix: string; hash: string };
    generateApiKey(): GeneratedApiKey;
    hashApiKey(value: string): string;
    verifyWithApiKey(request: Request, did: string): Promise<{ status: number; body: SafeVerificationDto }>;

- [ ] Step 1: Write failing key/verification tests. Assert hp_live_ format, 12-character prefix, SHA-256 hex hash, different keys differ, missing/wrong/revoked keys return 401, 61st request in a one-minute window returns 429, unknown DID returns a safe 404, and valid DID output omits organization id, governance notes, credential JWS, keys, and API key material.

- [ ] Step 2: Implement pure key generation and safe DTO mapping. Use randomBytes(24), createHash("sha256"), constant-time hash comparison in the database function, and verifyPublicAgentByDid for the public read. Do not query agents directly from the public route.

- [ ] Step 3: Add protected key management routes. Owner/admin only; create returns the full key exactly once, list returns prefix/status/timestamps only, and revoke is idempotent. Use actor-derived organization and audit api_key.created/api_key.revoked.

- [ ] Step 4: Add the public route and metering boundary. Parse a single Bearer hp_live_ header; call hermes_consume_api_key to lock, rate-limit, and record status; then call the safe DID projection. Limit the body/query to the DID and reject oversized/ambiguous input. Use data envelopes on success and stable error envelopes on failure.

- [ ] Step 5: Run focused unit, PostgreSQL, and browser tests.

    bun x vitest run tests/unit/api-keys.test.ts tests/unit/public-verification.test.ts
    DATABASE_URL_TEST=<disposable-pg18-url> DB_INTEGRATION_REQUIRED=1 bun x vitest run tests/integration/postgres.public-verification.integration.test.ts --maxWorkers=1 --fileParallelism=false
    bun x playwright test tests/e2e/public-verification.spec.ts

- [ ] Step 6: Commit the public API slice.

    git add src/lib/productization src/app/api/apikeys src/app/api/v1/verify src/lib/http.ts tests/unit/api-keys.test.ts tests/unit/public-verification.test.ts tests/integration/postgres.public-verification.integration.test.ts tests/e2e/public-verification.spec.ts
    git commit -m "feat(api): add hashed metered public verification"

---

### Task 5: Pure IMDA/HKMA compliance reports and exports

Files:
- Create src/lib/reports/types.ts, src/lib/reports/imda.ts, src/lib/reports/hkma.ts, src/lib/reports/csv.ts, src/lib/reports/service.ts
- Create src/app/api/reports/compliance/route.ts
- Modify src/components/hermes/dashboard/compliance-client.tsx
- Test tests/unit/reports.test.ts, tests/unit/report-csv.test.ts, tests/unit/reports-api.test.ts, tests/e2e/reports.spec.ts

Interfaces:

    type ReportInput = { orgSlug: string; periodStart: string; periodEnd: string; chainValid: boolean; checkedRows: number; agents: Array<{ did: string; name: string; risk: string; status: string }>; decisions: { allow: number; deny: number; hold: number }; approvals: { resolved: number; byHuman: number; byTimeout: number; medianMinutes: number } };
    buildImdaReport(input: ReportInput): ComplianceReport;
    buildHkmaReport(input: ReportInput): ComplianceReport;
    encodeReportCsv(report: ComplianceReport): string;

- [x] Step 1: Write failing pure report tests. Assert exact framework labels, four stable section ids, agent/decision/approval counts, timeout and broken-chain exceptions, HKMA section title remapping, and deterministic output for the same input. Run bun x vitest run tests/unit/reports.test.ts; expect missing-module failures.

- [x] Step 2: Implement pure report builders. Keep report builders free of database/network imports. IMDA sections are accountability, technical-controls, audit-integrity, and incidents; HKMA reuses the evidence with its own headings. Exceptions explicitly include broken chain and timed-out approvals.

- [x] Step 3: Implement one safe CSV encoder. Quote every cell and prefix values beginning with =, +, -, @, control characters, or whitespace followed by formula characters. Add tests for formula injection and commas/quotes/newlines.

- [x] Step 4: Implement the report read model and route. Resolve the organization from the actor for session requests. For n8n bearer requests, use constant-time comparison against REPORT_EXPORT_SECRET, require a UUID orgId, and use a system read transaction limited to that organization. Query existing audit/gateway/approval tables, call the authoritative chain verifier, build the typed input, and return JSON or text/csv with a safe filename. Never return raw rows or credentials.

- [x] Step 5: Wire the dashboard. Keep the existing print/PDF action and add separate download links labeled Export IMDA report and Export HKMA report. Preserve the live chain verification state and existing visual layout.

- [x] Step 6: Run focused and browser tests.

    bun x vitest run tests/unit/reports.test.ts tests/unit/report-csv.test.ts tests/unit/reports-api.test.ts
    bun x playwright test tests/e2e/reports.spec.ts

- [x] Step 7: Commit the reporting slice.

    git add src/lib/reports src/app/api/reports/compliance src/components/hermes/dashboard/compliance-client.tsx tests/unit/reports.test.ts tests/unit/report-csv.test.ts tests/unit/reports-api.test.ts tests/e2e/reports.spec.ts
    git commit -m "feat(compliance): add IMDA and HKMA report exports"

---

### Task 6: Stripe Billing adapter, checkout, and idempotent webhook

Files:
- Create src/lib/billing/service.ts, src/app/api/billing/checkout/route.ts, src/app/api/webhooks/stripe-billing/route.ts
- Modify src/lib/http.ts
- Test tests/unit/billing.test.ts, tests/unit/billing-api.test.ts, tests/e2e/billing.spec.ts

Interfaces:

    stripeBillingClient(): Stripe;
    tierForPrice(priceId: string): "starter" | "growth" | "scale" | null;
    ensureStripeCustomer(tx: Transaction, actor: Actor): Promise<string>;
    handleBillingEvent(rawBody: string, signature: string | null): Promise<{ received: true }>;

- [ ] Step 1: Write failing billing tests. Cover lazy missing-secret failure, exact price mapping, owner-only checkout, viewer/admin denial, safe success/cancel URLs, invalid signature 400, active/trialing tier mapping, canceled subscription reverting to pilot, and duplicate provider event being a no-op after the first audit/update.

- [ ] Step 2: Implement the lazy adapter. Reuse stripe 22.5.0; construct the client only inside a request path using STRIPE_SECRET_KEY. ensureStripeCustomer reads/updates the actor organization inside withActorTransaction, uses deterministic metadata, and never sends agent or credential data to Stripe.

- [ ] Step 3: Implement owner checkout. Validate { tier }, resolve the price via stripeBillingPrice, ensure the customer, create a subscription-mode Checkout Session, and return only { data: { url } }. Missing env maps to BILLING_UNAVAILABLE 503.

- [ ] Step 4: Implement the signed webhook. Read raw body, verify stripe-signature with stripeBillingWebhookSecret, derive organization from stored customer id, insert the provider event through hermes_record_billing_event, and update tier/subscription only on the first event. Append billing.subscription.updated without storing raw Stripe JSON.

- [ ] Step 5: Run focused tests and the browser configuration contract.

    bun x vitest run tests/unit/billing.test.ts tests/unit/billing-api.test.ts
    bun x playwright test tests/e2e/billing.spec.ts

- [ ] Step 6: Commit the billing slice.

    git add src/lib/billing src/app/api/billing src/app/api/webhooks/stripe-billing src/lib/http.ts tests/unit/billing.test.ts tests/unit/billing-api.test.ts tests/e2e/billing.spec.ts
    git commit -m "feat(billing): add Neon-backed Stripe subscription adapter"

---

### Task 7: Agent communications adapter and n8n workflow artifact

Files:
- Create src/lib/comms/service.ts, src/app/api/comms/inbound/route.ts, ops/n8n/compliance-report.json
- Modify src/lib/http.ts
- Test tests/unit/comms.test.ts, tests/unit/n8n-workflow.test.ts, tests/integration/postgres.comms.integration.test.ts

Interfaces:

    type InboundMessage = { from: string; to: string; subject?: string; text?: string; providerMessageId?: string };
    validateInboundMessage(value: unknown): InboundMessage;
    receiveInboundMessage(input: InboundMessage): Promise<{ messageId: string; agentId: string }>;

- [ ] Step 1: Write failing validation/workflow tests. Cover secret-header rejection, malformed/oversized body rejection, strict <slug>@agents.hermespass.asia recipient parsing, control-character removal, provider idempotency, no raw secret in workflow JSON, HKT monthly cron 0 1 1 * *, and both report HTTP nodes using header-auth placeholders.

- [ ] Step 2: Implement the service and route. Require COMMS_INBOUND_SECRET at request time and compare in constant time. Cap raw body at 16 KiB before JSON parsing; validate sender/recipient/subject/text; resolve the globally unique agent slug; call hermes_insert_agent_message; append email.receive; return data with messageId. Never echo message body or secret.

- [ ] Step 3: Add the importable n8n artifact. Create nodes for monthly IMDA CSV to Drive and JSON summary to Sheets. Use environment placeholders (HERMES_ORG_ID, HERMES_DRIVE_FOLDER_ID, HERMES_SHEET_ID) and no real URL token/credential. Include a README description explaining human credential setup without executing it.

- [ ] Step 4: Run unit and PostgreSQL tests.

    bun x vitest run tests/unit/comms.test.ts tests/unit/n8n-workflow.test.ts
    DATABASE_URL_TEST=<disposable-pg18-url> DB_INTEGRATION_REQUIRED=1 bun x vitest run tests/integration/postgres.comms.integration.test.ts --maxWorkers=1 --fileParallelism=false

- [ ] Step 5: Commit the communications slice.

    git add src/lib/comms src/app/api/comms ops/n8n/compliance-report.json src/lib/http.ts tests/unit/comms.test.ts tests/unit/n8n-workflow.test.ts tests/integration/postgres.comms.integration.test.ts
    git commit -m "feat(comms): add secure inbound agent messages and report workflow"

---

### Task 8: SG-first launch readiness, CI, and complete local verification

Files:
- Create docs/launch-readiness.md and docs/release/phase-5-gates.md
- Modify .github/workflows/ci.yml, README.md, AGENTS.md (append only; preserve the codebase-memory block)
- Test tests/unit/phase5-release-gates.test.ts and tests/e2e/productization.spec.ts

Interfaces:
- CI must expose frozen install, format, lint, typecheck, Vitest, Drizzle no-diff, PostgreSQL 18 integration, build, and Playwright jobs.
- The release runbook must distinguish source evidence from nonproduction-provider approval and production-release approval.

- [ ] Step 1: Write failing release-contract tests. Assert the exact 39-public/5-dashboard route manifest, five visual pages, bun run db:check, Phase 5 naming in the Neon smoke job, no provider secrets in repository files, and the runbook’s separate provider/production approval language.

- [ ] Step 2: Add the checklist and runbook. Include Singapore-first region/branch evidence, secret inventory for all Phase 1–5 values, two-tenant RLS proof, PITR restore/audit verification, rate-limit evidence, report review, pen-test status, uptime/error alerting, and explicit unchecked state for every external item until evidence exists.

- [ ] Step 3: Update CI and documentation. Add Drizzle validation/no-diff and Phase 5 database/productization jobs while retaining all existing Phase 0–4 gates. Do not add live provider credentials or automatically run n8n/Cloudflare/Stripe setup. Add a short Neon productization/client-boundary note to AGENTS.md without modifying the codebase-memory block.

- [ ] Step 4: Run the complete deterministic local gate.

    bun install --frozen-lockfile
    bun run format:check
    bun run lint
    bun run typecheck
    bun run test
    bun run db:check
    bun x drizzle-kit generate --name=phase5_final_consistency
    bun run build
    bun run test:db
    bun run test:e2e

  Expected: all commands exit 0; the disposable PostgreSQL 18 container is stopped and exact-name absence is verified; no hosted provider is contacted.

- [ ] Step 5: Run the final diff/security audit. Verify no Supabase imports, plaintext invite/API keys, raw Stripe payload persistence, private-key exposure, unbounded report/message bodies, or organization ids accepted from browser mutations. Run git diff --check and an explicit credential scan.

- [ ] Step 6: Commit the release slice.

    git add .github/workflows/ci.yml README.md AGENTS.md docs/launch-readiness.md docs/release/phase-5-gates.md tests/unit/phase5-release-gates.test.ts tests/e2e/productization.spec.ts
    git commit -m "chore(release): add Phase 5 productization gates"

## Phase 5 exit evidence

The phase is locally complete only when a fresh authenticated test identity can create one organization, invite a teammate, issue agents up to the active tier, mint a hashed verification key, obtain metered public verification with a deterministic 429, export IMDA/HKMA JSON/CSV, exercise mocked Stripe checkout/webhook idempotency, accept a bounded inbound agent message, and pass all existing route/dashboard/visual gates. Hosted provider setup, publication, production migrations, domain attachment, and customer seed remain “awaiting approval” until separately authorized.

