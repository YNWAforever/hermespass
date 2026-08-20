# HermesPass launch readiness

Status: **source gates green; external release evidence unchecked and awaiting approval**.

This checklist keeps evidence from local CI separate from provider and production actions. A checked local item does not authorize a Neon, Stripe, n8n, Cloudflare, Vercel, DNS, or customer-data mutation.

## SG-first operating evidence

- [ ] **Singapore-first region:** dedicated Neon project is created in AWS Singapore and the Vercel production integration points to the approved production branch.
- [ ] **Branch isolation:** `development`, preview branches, and `production` are documented with a tested promotion path; no hosted branch is changed by local CI.
- [ ] **Runtime role:** the deployed URL uses `hermes_app`; owner/migration credentials are absent from runtime variables.
- [ ] **PITR restore:** restore a disposable branch from the production point-in-time recovery window, verify migrations, and run the audit-chain verifier before any release.
- [ ] **Two-tenant RLS:** prove member reads stay tenant-scoped, viewers cannot mutate, and a populated foreign tenant remains invisible in agents, gateway activity, reports, billing, and messages.

## Secret inventory (Phase 1–5)

The inventory is a checklist of names and owners, never a place to store values.

- [ ] Neon/Auth: `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `HERMES_KEY_ENVIRONMENT`, `HERMES_KEK_V1`.
- [ ] Identity/gateway: issuer bootstrap material, `CRON_SECRET`, Telegram bot/webhook/cron values, and any preview-only test identity values.
- [ ] Payments/insurance: payment rail and webhook secrets, `INSURANCE_WEBHOOK_SECRET`, and provider signing keys.
- [ ] Productization: `REPORT_EXPORT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_BILLING_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`, and `COMMS_INBOUND_SECRET`.
- [ ] n8n/Google: `HERMES_BASE_URL`, `HERMES_ORG_ID`, `HERMES_DRIVE_FOLDER_ID`, `HERMES_SHEET_ID`, plus human-managed n8n header-auth, Drive, and Sheets credentials.
- [ ] Every production and nonproduction value is distinct, rotated by an identified owner, and absent from Git history, browser bundles, logs, and screenshots.

## Operational evidence

- [ ] Public verification rate-limit evidence includes the deterministic 61st-request `429` and retry behavior.
- [ ] Compliance report review confirms IMDA/HKMA headings, formula-safe CSV, broken-chain and timeout exceptions, and safe filenames.
- [ ] A scoped penetration test covers Auth/session boundaries, RLS, webhooks, report exports, billing signatures, inbound communications, and n8n handoff.
- [ ] Uptime and error alerting cover the Next.js app, Neon, Stripe webhook failures, report export failures, n8n delivery, and Telegram/communications retries.
- [ ] Incident contacts, rollback owner, migration owner, and customer-support escalation are recorded.

## Explicit external gates

- [ ] **Nonproduction provider approval:** create/connect the dedicated Neon project, enable Auth branches, configure Stripe test mode, register n8n credentials, and verify the preview with test identities.
- [ ] **Production release approval:** apply additive migrations, generate production issuer material, attach domains, seed only approved customers, and rerun route, interaction, audit, billing, report, and communications checks.

Until these boxes have independent evidence, the release remains **source verified, external setup unchecked**.
