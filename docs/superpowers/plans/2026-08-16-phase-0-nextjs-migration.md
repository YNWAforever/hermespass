# HermesPass Phase 0 — Next.js 16 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:using-git-worktrees` for setup, then `superpowers:executing-plans` task-by-task. Track steps with checkboxes.

**Goal:** Replace the Lovable/TanStack Start runtime with Next.js App Router while preserving all 44 URLs, metadata, visuals, and mock interactions, then prove parity in CI and a Vercel preview.

**Architecture:** Build Next alongside the existing source until every route passes, then remove TanStack/Lovable in one cleanup task. Keep server page wrappers responsible for metadata and move stateful bodies into focused client components. Split pure locale conversion from React locale context so server metadata never calls client-module exports.

**Tech Stack:** Next.js 16.3.1, React 19.2, Tailwind CSS 4, Bun 1.3.14, Vitest, Playwright, GitHub Actions, Vercel. Next 16 is Active LTS, requires Node 20.9+, and avoids targeting Next 15 shortly before its maintenance window ends. [Next support policy](https://nextjs.org/support-policy), [installation requirements](https://nextjs.org/docs/app/getting-started/installation), [current package](https://registry.npmjs.org/next/latest).

## Global Constraints

- Execution baseline is exactly [`b22f167`](https://github.com/YNWAforever/hermespass/commit/b22f167ae5960dc2a510678524827bfb1427b7ea). Stop and reconcile if `origin/main` differs.
- Phase 0 adds no product features, database, authentication, secrets, or environment variables.
- Preserve the 44-route contract: 13 English marketing routes, 26 Chinese routes, and five dashboard routes.
- Preserve each dashboard page’s metadata; do not accept the supplied plan’s proposed title collapse.
- Use PowerShell-compatible commands and portable TypeScript/JavaScript tooling—no `grep`, `sed`, `xargs`, or shell-dependent codemod.
- External writes remain gated: request approval before pushing branches, opening the PR, connecting Vercel, merging, or changing DNS/domains.
- Persist this approved plan at `docs/superpowers/plans/2026-08-16-phase-0-nextjs-migration.md`.

## Implementation Tasks

### Task 1: Establish the real checkout and decision record

**Files:**

- Create `docs/decisions/0001-nextjs-app-router.md`
- Create `docs/superpowers/plans/2026-08-16-phase-0-nextjs-migration.md`

- [x] Verify the current folder still contains only the empty `.git` directory. If it has acquired files, commits, or a remote, stop instead of overwriting it.
- [x] Connect and recover the checkout:

```powershell
git remote add origin https://github.com/YNWAforever/hermespass.git
git fetch origin --prune
git switch -C main origin/main
git branch --set-upstream-to=origin/main main
git branch legacy/vite b22f167
git show -s --format="%h %s"
```

Expected: `b22f167 Add project README`.

- [x] Use `superpowers:using-git-worktrees` to create `.worktrees/phase-0-nextjs` on `codex/phase-0-nextjs-migration`, based on `b22f167`.
- [x] Index that worktree with codebase-memory in moderate mode and recheck route/import counts.
- [x] Record ADR-0001: Next 16 App Router, Vercel deployment target, frozen `legacy/vite` baseline, React 19/Tailwind 4 retained, and no feature work.
- [x] Commit only the ADR and plan:

```powershell
git add docs/decisions/0001-nextjs-app-router.md docs/superpowers/plans/2026-08-16-phase-0-nextjs-migration.md
git commit -m "docs: record Next.js App Router migration"
```

### Task 2: Add the Next platform foundation and correct shared boundaries

**Files:**

- Modify `package.json`, `tsconfig.json`, `.gitignore`, `bunfig.toml`, `components.json`
- Replace `eslint.config.js` with `eslint.config.mjs`
- Create `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `tests/setup.ts`
- Create `src/app/layout.tsx`, `providers.tsx`, `page.tsx`, `not-found.tsx`, `error.tsx`, `global-error.tsx`, `globals.css`
- Create `src/components/errors/error-panel.tsx`
- Modify the three actual router consumers: `app-shell.tsx`, `site-shell.tsx`, `zh-shell.tsx`

- [x] First add failing tests for root rendering, 404/error fallback, link destinations, dashboard active navigation, and Pricing’s active state.
- [x] Add Next 16.3.1 and the Tailwind PostCSS, Next ESLint, Vitest, Testing Library, Playwright, `pixelmatch`, and `pngjs` dependencies. Retain TanStack/Vite packages temporarily so legacy files continue type-checking during the incremental port.
- [x] Set:

```json
{
  "packageManager": "bun@1.3.14",
  "engines": { "node": ">=20.9.0" },
  "sideEffects": ["**/*.css"],
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "test:routes": "playwright test tests/e2e/routes.spec.ts",
    "test:parity": "playwright test tests/e2e/visual-parity.spec.ts"
  }
}
```

- [x] Configure `eslint-config-next/core-web-vitals`, `eslint-config-next/typescript`, Prettier compatibility, and ignores for `.next`, worktrees, Playwright output, and generated declarations using the [official flat-config shape](https://nextjs.org/docs/app/api-reference/config/eslint).
- [x] Copy `src/styles.css` into `src/app/globals.css` and change Tailwind’s manual source from `@source "../src";` to `@source "../";`; the original path would otherwise resolve to nonexistent `src/src` after the move.
- [x] Set `components.json` to `"rsc": true` and `"css": "src/app/globals.css"`.
- [x] Port root metadata/providers and add both route-level and root-layout error boundaries through `ErrorPanel`; retire Lovable-specific reporting from the new boundary.
- [x] Explicitly migrate the three shared router files:

  - `app-shell.tsx`: `next/link`, `usePathname`, `href`, and existing exact/prefix active matching.
  - `site-shell.tsx`: direct `/zh-hant` and `/zh-hans` links; replace unsupported `activeProps` with `usePathname` plus `cn`.
  - `zh-shell.tsx`: `next/link` and plain string `href`.

- [x] Mark the real client roots explicitly: the three shells, Chinese page/contact/ROI components, Hermes store, `use-mobile`, and hook-owning UI modules (`carousel`, `chart`, `form`, `input-otp`, `sidebar`).
- [x] Port `/` from `src/routes/index.tsx`, retaining its exact metadata and body.
- [x] Verify `bun run test`, `bun run typecheck`, `bun run build`, `/` = 200, unknown route = 404, then commit.

### Task 3: Port all English marketing routes

**Files:**

| Existing source | Next target |
|---|---|
| `src/routes/{about,benefits,compliance-standards,faq,industries,pricing,product,security,solutions,use-cases}.tsx` | `src/app/(marketing)/<slug>/page.tsx` |
| `src/routes/contact.tsx` | `src/components/marketing/en-contact-client.tsx` + `src/app/(marketing)/contact/page.tsx` |
| `src/routes/roi-calculator.tsx` | `src/components/marketing/en-roi-client.tsx` + `src/app/(marketing)/roi-calculator/page.tsx` |

- [x] Add failing metadata/render tests for all 13 English routes using the exact existing title, description, Open Graph title/description, and Twitter card values.
- [x] Port the ten static routes as server pages, removing only `createFileRoute`, converting `head.meta` to `Metadata`, swapping TanStack links, and making the existing page function the default export.
- [x] Keep contact and ROI state in named client exports `EnContactClient` and `EnRoiClient`; their server `page.tsx` files own metadata.
- [x] Verify all English routes return 200 and test:

  - Pricing active navigation.
  - Contact validation and successful simulated submission.
  - ROI input changes recalculate the annual total.
  - Desktop mega-menu and mobile menu navigation.

- [x] Commit the English route slice.

### Task 4: Port Chinese routes with a server-safe locale boundary

**Files:**

- Split `src/lib/i18n/locale.tsx` into `locale.ts` and `locale-context.tsx`
- Replace `zh-head.ts` with `zh-metadata.ts`
- Create `src/app/[locale]/layout.tsx`, `page.tsx`, `[slug]/page.tsx`, `contact/page.tsx`, `roi-calculator/page.tsx`

**Interfaces:**

```ts
export type Locale = "en" | "zh-hans" | "zh-hant";
export type ZhLocale = Exclude<Locale, "en">;
export function isZhLocale(value: string): value is ZhLocale;
export function convert(text: string, locale: Locale): string;
export function localize<T>(value: T, locale: Locale): T;

export function LocaleProvider(props: {
  locale: ZhLocale;
  children: React.ReactNode;
}): React.ReactNode;
export function useLocale(): ZhLocale;

export function zhMetadata(locale: string, slug: string): Metadata;
```

- [ ] Write failing unit tests for locale validation, Simplified/Traditional conversion, metadata locale values, supported slugs, and invalid locale/slug 404s.
- [ ] Keep conversion, constants, types, and validation in server-safe `locale.ts`; put only React context/hooks in client-only `locale-context.tsx`.
- [ ] Update Chinese components to import pure functions and context separately.
- [ ] Generate only `zh-hans` and `zh-hant`; set `dynamicParams = false` for locale and slug segments.
- [ ] Preserve 13 routes per locale, including contact and ROI.
- [ ] Verify 26 Chinese routes return 200, `/zh-xx` and unknown slugs return 404, Traditional Chinese conversion renders, and all language-switcher destinations are correct.
- [ ] Commit the locale slice.

### Task 5: Port the dashboard without metadata loss

**Files:**

- Create `src/app/dashboard/layout.tsx`
- Create server page wrappers at `dashboard/page.tsx` and `dashboard/{agents,approvals,compliance,wallets}/page.tsx`
- Create client bodies under `src/components/hermes/dashboard/`

**Client exports:**

- `DashboardOverviewClient`
- `AgentsClient`
- `ApprovalsClient`
- `ComplianceClient`
- `WalletsClient`

- [ ] Add failing tests for all five exact metadata objects and the core mock-store interactions.
- [ ] Port each existing dashboard body unchanged into its named client component.
- [ ] Make each route wrapper a server component that exports its original metadata and renders the corresponding client component.
- [ ] Keep `AppShell` in the dashboard layout and preserve pathname-based active navigation.
- [ ] Verify:

  - Issue a passport and see the new agent and wallet.
  - Pause/resume the gateway stream.
  - Approve, reject, and escalate held actions.
  - Change wallet limits and freeze a card.
  - Trigger compliance CSV download and print action.

- [ ] Commit the dashboard slice.

### Task 6: Remove the legacy runtime and finish repository configuration

**Delete:**

- `src/routes/`, `src/router.tsx`, `src/routeTree.gen.ts`, `src/server.ts`, `src/start.ts`
- `src/styles.css`, legacy error helpers, `lovable-error-reporting.ts`
- `vite.config.ts`, `.lovable/`

**Update:**

- Remove TanStack Start/router/plugin, Lovable config, Nitro, and `@tailwindcss/vite`.
- Retain Vite, its React plugin, and path plugin only because Vitest uses them.
- Remove Lovable packages from Bun’s release-age exemption while preserving the 24-hour supply-chain guard.
- Replace README stack/development/history with Next 16 instructions.
- Append a short App Router/client-boundary note to `AGENTS.md` without altering its codebase-memory block.

- [ ] Confirm no source imports `@tanstack/react-router`, `@tanstack/react-start`, deleted error helpers, `routeTree.gen`, or Lovable runtime hooks.
- [ ] Run the complete deterministic gate:

```powershell
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

- [ ] Commit the explicit deletions and configuration files.

### Task 7: Add automated route, interaction, and visual parity

**Files:**

- Create `playwright.config.ts`
- Create `tests/fixtures/routes.ts`
- Create `tests/e2e/routes.spec.ts`, `interactions.spec.ts`, `visual-parity.spec.ts`
- Create `tests/e2e/support/stable-page.ts`, `image-diff.ts`

- [ ] Define the exact 44-route manifest once and require every route to return 200 on both legacy and Next; require representative title/meta equality and invalid-route 404s.
- [ ] Run the interaction cases from Tasks 3–5 against Next.
- [ ] Compare legacy and Next in the same Chromium process at 1440×900 and 390×844 for:

  - `/`, `/contact`, `/roi-calculator`
  - `/zh-hant`, `/zh-hans/pricing`
  - `/dashboard` and all four dashboard subpages

- [ ] Freeze time, disable animations/transitions, wait for fonts and hydration, require identical screenshot dimensions, and fail when differing pixels exceed 0.5%. Save legacy, Next, and diff images on failure.
- [ ] Use the root checkout at `b22f167` as the local legacy server and the feature worktree as Next; do not commit platform-dependent golden screenshots.
- [ ] Run all 44 route checks, interactions, and 20 visual comparisons successfully, then commit the parity suite.

### Task 8: CI, draft PR, preview verification, and approval gates

- [ ] Add two CI jobs:

  - `check`: Bun 1.3.14 frozen install, formatting, Next ESLint, TypeScript, Vitest, production build.
  - `parity`: check out the PR branch and `legacy/vite` separately, install both, install Chromium, run both servers, execute route/interaction/visual tests, and upload Playwright artifacts on failure.

- [ ] After explicit publication approval, push `legacy/vite` and `codex/phase-0-nextjs-migration`, then open a draft PR referencing ADR-0001 and the tracked plan.
- [ ] Require green CI and a Vercel preview. If no Vercel project is connected, stop for approval before creating or linking one.
- [ ] Run all 44 route checks and the interaction suite against the preview URL.
- [ ] Present source, CI, browser, visual-parity, and preview evidence, then pause.
- [ ] Only after a separate explicit approval: squash-merge the PR, configure the production deployment, attach `hermespass.asia`, add the `www` redirect, and rerun the route/interaction suite against production.

## Acceptance and Assumptions

- No public API, schema, environment-variable, or product-behavior changes.
- All 44 routes preserve content, metadata, navigation, responsiveness, and mock interactions.
- `legacy/vite` remains an immutable reference at `b22f167`.
- Phases 1–5 are not imported or executed in this slice; each must be re-audited against the merged Phase 0 tree.
- Phase 0 is complete only after production approval and post-deploy verification; before that point its status is “preview verified, awaiting approval.”
