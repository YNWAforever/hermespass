# Phase 6 production-release gates

Status: **source preflight implementation in progress; external gates unchecked and awaiting approval**.

This ledger is evidence-oriented. Local source checks can be reproduced from the repository; they do not authorize hosted or production mutations.

## Local source gates

- [ ] `bun install --frozen-lockfile` succeeds with the committed lockfile.
- [ ] Formatting, lint, TypeScript, Vitest, Drizzle validation, PostgreSQL 18 integration, production build, and Playwright pass on the Phase 6 commit.
- [ ] `bun run release:phase6` returns a redacted success report with no secret values.
- [ ] Drizzle generation produces no migration diff.
- [ ] The 39 public routes, five dashboards in both auth states, interactions, and visual checks remain green.
- [ ] The inbound communications route accepts the documented worker header aliases with constant-time comparison and bounded bodies.
- [ ] Source/config scans find no provider keys, private key material, owner-role runtime URL, or raw inbound payload logging.

## Neon and deployment evidence

- [ ] Dedicated Neon project is in AWS Singapore and uses Neon Auth on long-lived `development` and `production` branches.
- [ ] Preview branches derive from `development`; production points only to `production`.
- [ ] Deployed requests use the restricted `hermes_app` role; owner/migration credentials are absent from runtime variables.
- [ ] A PITR restore to a disposable branch applies migrations and passes the audit-chain verifier.
- [ ] A populated two-tenant RLS test proves tenant isolation for agents, gateway activity, reports, billing, and inbound messages.
- [ ] Rate limit evidence (rate-limit endpoint) shows the public verification endpoint returns deterministic `429` responses and honors retry behavior.

## Security and operations evidence

- [ ] Secret inventory names, owners, environments, rotation dates, and protected storage locations are recorded without values.
- [ ] Independent penetration testing covers Auth/session, RLS, webhooks, report exports, billing signatures, communications, and n8n handoff.
- [ ] Uptime and error alerting cover Next.js, Neon, Stripe webhooks, report export, n8n delivery, Telegram, and communications retries.
- [ ] Incident contacts, rollback owner, migration owner, and customer-support escalation are recorded.

## Approval gates

- [ ] **Nonproduction provider approval:** connect the dedicated Neon project, configure Auth branches and test secrets, configure Stripe test mode, register n8n/Cloudflare test credentials, and verify a preview with test identities.
- [ ] **Production release approval:** apply additive migrations, generate production issuer material, attach `hermespass.asia`, configure the `www` redirect and email routing, seed only approved customers, and rerun route, interaction, audit, billing, report, and communications checks.

Until each item has an owner and evidence link, release status remains **source verified, external setup unchecked**. No credential, customer data, provider id, or approval is stored in this document.
