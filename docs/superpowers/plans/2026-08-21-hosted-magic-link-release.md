# Hosted Magic-Link Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to execute this plan task-by-task. Track every step with checkboxes.

**Goal:** Publish the verified magic-link login at `https://hermespass.vercel.app` through a staged Vercel/Neon release while preserving the hourly approval cron and server-side membership gate.

**Architecture:** GitHub `main` is authoritative. Vercel project `hermespass` uses Neon project `curly-smoke-16875897`; Preview/Development use Neon `development`, Production uses Neon `production`. Neon/Vercel supplies database connectivity, protected Vercel settings supply Auth configuration, and redemption returns to `/dashboard`.

**Tech Stack:** GitHub, Vercel CLI 50.28.0, Vercel project `prj_SPqdeEkJhO48jEbiKUTDPnHngIX9`, Neon Auth, Next.js 16.3.1, Bun 1.3.14, Playwright.

## Global Constraints

- Keep `/api/cron/approvals` at `0 * * * *`; Vercel Pro is required.
- Use the existing Neon Auth email-delivery configuration.
- Use only `https://hermespass.vercel.app`; defer custom domains, DNS, and `www`.
- Test with an existing provisioned member; create no production identities and seed no customer data.
- Keep Auth secrets, database URLs, KEKs, and provider secrets in protected settings; never print, commit, or screenshot values.
- Change no application source, schema, migration, issuer material, Stripe, Telegram, n8n, Cloudflare, or DNS.
- Stop before provider mutation if plan, branch, Auth-delivery, or protected-variable gates are not confirmed.
- Preserve untracked `.mandate-*.patch` and `.test.patch` files; never stage them.

---

### Task 1: Baseline and local gates

**Files:** Verify only repository status, remote, and gate output.

- [ ] Confirm the branch, latest commit, and remote:

```powershell
git status --short --branch
git log -1 --format="%H %s"
git remote get-url origin
```

Require `main`, the preserved patch artifacts as the only untracked paths, and the HermesPass GitHub remote.

- [ ] Run the frozen gates; every command exits 0:

```powershell
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

- [ ] Confirm the reviewed source is pushed before provider work:

```powershell
git fetch origin --prune
git rev-parse HEAD
git rev-parse origin/main
git merge-base --is-ancestor HEAD origin/main
```

If ancestry fails, push the reviewed `main` tip and record its SHA. Make no source change in this task.

---

### Task 2: Vercel Pro and project gate

**Files:** Verify only `vercel.json` and the existing Vercel project.

- [ ] Run `vercel whoami`, `vercel project inspect hermespass`, and `Get-Content -LiteralPath vercel.json`. Require team `ynwaforevers-projects`, project `prj_SPqdeEkJhO48jEbiKUTDPnHngIX9`, Next preset, and cron `0 * * * *`.
- [ ] Upgrade the team/project to Pro in the dashboard. Do not change the cron to evade the Hobby restriction.
- [ ] Prove the plan gate with `vercel deploy --prod --yes --force`. If Hobby limits remain, stop and record the billing gate without changing `vercel.json`.
- [ ] Keep generated `.vercel` metadata ignored and uncommitted.

---

### Task 3: Neon branches and protected Auth settings

**Files:** Configure externally only: the existing Vercel/Neon integration and project `curly-smoke-16875897`.

- [ ] Verify long-lived Neon branches exactly named `development` and `production`, with Neon Auth enabled on both; create/delete no branches.
- [ ] Map Vercel Preview and Development to `development`, Production to `production`, and choose the restricted runtime role rather than an owner/migration role.
- [ ] Enable the existing Neon Auth email delivery on the production branch and keep the callback `/dashboard`.
- [ ] Set protected `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` for Preview, Development, and Production. Confirm names only; never display values.
- [ ] Run `vercel env ls preview`, `vercel env ls development`, and `vercel env ls production`; stop if required names or the restricted role are absent.

---

### Task 4: Preview deployment and verification

**Files:** Verify only the READY preview and existing browser suite.

- [ ] Deploy without changing the production alias:

```powershell
$previewOutput = vercel deploy --yes --force
$previewUrl = Read-Host "Paste the READY preview URL returned by Vercel"
$previewUrl = $previewUrl.TrimEnd('/')
vercel inspect $previewUrl
```

Require READY status and a source SHA equal to Task 1.

- [ ] Require HTTP 200 and both sign-in choices:

```powershell
$login = Invoke-WebRequest -UseBasicParsing "$previewUrl/login?next=%2Fdashboard"
if ($login.StatusCode -ne 200) { throw "Preview login returned $($login.StatusCode)" }
if ($login.Content -notmatch 'Sign in') { throw "Password sign-in form is missing" }
if ($login.Content -notmatch 'magic|Magic|link|Link') { throw "Magic-link control is missing" }
```

- [ ] Run existing route, interaction, and visual checks:

```powershell
$env:PLAYWRIGHT_BASE_URL = $previewUrl
bun run test:e2e
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

Require the existing public-route manifest and dashboard checks to pass without changing golden images.

- [ ] With one existing provisioned member, request/redeem one magic link and require `/dashboard`. Record only URL, timestamp, and result; never record address, token, link, cookie, or screenshot containing them.
- [ ] With an already-authenticated no-membership test identity, require the access-denied dashboard state and protected-API `403`. Create no production identity.
- [ ] In Preview only, temporarily remove one Auth variable through protected settings, redeploy, and require a controlled configuration/auth failure without secrets or stack traces; restore the value before Production.

---

### Task 5: Production promotion and verification

**Files:** Verify only Production deployment, login, dashboard, and logs.

- [ ] Compare the inspected preview SHA with Task 1 and obtain separate production-release approval.
- [ ] Deploy the exact verified source:

```powershell
vercel deploy --prod --yes --force
```

Require READY status, Neon branch `production`, and no missing-secret/wrong-branch/cron-plan error.

- [ ] Verify the hosted login:

```powershell
$productionLogin = Invoke-WebRequest -UseBasicParsing "https://hermespass.vercel.app/login?next=%2Fdashboard"
if ($productionLogin.StatusCode -ne 200) { throw "Production login returned $($productionLogin.StatusCode)" }
if ($productionLogin.Content -notmatch 'Sign in') { throw "Production password form is missing" }
if ($productionLogin.Content -notmatch 'magic|Magic|link|Link') { throw "Production magic-link control is missing" }
```

Redeem a fresh link for the same existing member and require `/dashboard`; repeat no-membership denial.

- [ ] Run `vercel ls hermespass --format json`, `vercel inspect https://hermespass.vercel.app`, and `vercel logs https://hermespass.vercel.app --level error --since 1h`. Require the verified SHA and READY status with no Auth/database configuration errors; do not copy secrets.

---

### Task 6: Release evidence and ledger updates

**Files:** Create `docs/release/hosted-magic-link-release.md`; modify `docs/launch-readiness.md` and `docs/release/phase-6-gates.md`.

- [ ] Create the dated evidence document with headings `Source`, `Vercel and Neon configuration`, `Preview verification`, `Production verification`, `Scope and exclusions`, and `Rollback reference`. Fill every field from observed evidence before committing.
- [ ] Include SHA, URLs, deployment states, route states, both form results, member result, denial result, cron expression, and timestamps. State that no customer seed, issuer generation, schema migration, DNS change, or unrelated provider operation occurred. Include no secrets, raw addresses, link URLs, cookies, or raw payloads.
- [ ] Mark only the hosted magic-link, Vercel, and Neon checks proven in Tasks 2–5 complete. Leave custom-domain, DNS, customer-seed, issuer, and unrelated-provider gates unchecked.
- [ ] Run:

```powershell
bun run format:check
git diff --check
git status --short --branch
```

Require only the three intended documentation paths staged; preserve patch artifacts.

- [ ] After explicit publication approval, commit and push only the evidence:

```powershell
git add -- docs/release/hosted-magic-link-release.md docs/launch-readiness.md docs/release/phase-6-gates.md
git commit -m "docs: record hosted magic-link release"
git push origin main
```

---

### Task 7: Stop conditions and rollback

**Files:** Verify only affected Vercel deployment and prior READY Production deployment.

- [ ] Stop on any failed assertion. Do not create identities, alter schema, change cron frequency, disable membership checks, or edit source as a workaround. Capture only safe error category, URL, SHA, timestamp, and failed assertion.
- [ ] Select a prior READY URL from the same project:

```powershell
$deployments = vercel ls hermespass --format json | ConvertFrom-Json
$previousReadyUrl = Read-Host "Paste the previous READY production deployment URL shown by vercel ls"
if ([string]::IsNullOrWhiteSpace($previousReadyUrl)) { throw "A previous READY deployment URL is required for rollback" }
```

- [ ] After separate rollback approval, run:

```powershell
vercel rollback $previousReadyUrl
vercel inspect https://hermespass.vercel.app
```

Require the alias to point to the prior READY deployment, re-run the public login check, and record the result without altering Neon data or source. If rollback occurs, leave both hosted-release ledger gates failed/pending until a new preview is verified and separately approved.

## Acceptance checklist

- [ ] Vercel Pro accepts `0 * * * *` without a cron change.
- [ ] Preview/Development map to Neon `development`; Production maps to `production`.
- [ ] Existing Auth delivery and required protected variable names are verified.
- [ ] Preview and Production login return 200 with password and magic-link controls.
- [ ] Existing member reaches `/dashboard`; no-membership identity is denied by UI and protected APIs.
- [ ] Existing route, dashboard, interaction, and visual checks pass against the READY preview.
- [ ] Production health/log checks are green without secret evidence.
- [ ] Ledgers distinguish completed hosted checks from deferred DNS, seed, issuer, and unrelated-provider gates.
- [ ] Rollback is executable and separately approved.

## Plan self-review

- [ ] The approved decisions are represented: hourly cron, Pro upgrade, Neon branch mapping, existing Auth delivery, `/dashboard` callback, existing-member verification, staged preview, production promotion, and rollback.
- [ ] No task changes source, migrations, customer data, issuer keys, DNS, or unrelated providers.
- [ ] Commands are PowerShell-compatible and do not print secrets.
- [ ] Every external mutation has an explicit approval gate and stop condition.
- [ ] Search this finished plan for TODO, TBD, FIXME, and angle-bracket placeholders before commit.
