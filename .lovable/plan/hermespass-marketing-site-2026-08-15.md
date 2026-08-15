# HermesPass Marketing Site

Add a public product website that introduces HermesPass to enterprise buyers, and keep the existing dashboard as the live product demo behind `/dashboard`.

## Routing

- Marketing pages get the public root: `/` (home), `/product`, `/solutions`, `/compliance-standards`, `/pricing`, `/about`, `/contact`.
- The current dashboard overview moves from `/` to `/dashboard`; `/agents`, `/approvals`, `/wallets`, `/compliance` become `/dashboard/agents`, `/dashboard/approvals`, `/dashboard/wallets`, `/dashboard/compliance` under a dashboard layout route that renders the existing `AppShell`.
- Marketing pages use a new marketing shell (sticky transparent header with logo, nav links, "Live Demo" CTA to `/dashboard`, plus a footer). No sidebar.
- Every marketing route gets its own `head()` with unique title, description, og:title, og:description.

## Pages

1. **Home (`/`)** — hero ("Know Your Agent infrastructure for autonomous AI"), animated agent-passport visual, trust bar of regulatory frames (IMDA MGF v1.5, HKMA GenA.I. Sandbox, W3C VC, MCP), the problem (agents act without identity, authority or audit), four-pillar solution grid (Passports, Policy Gateway, Scoped Wallets, Audit Chain), a 3-step "how it works" flow diagram, live-metrics teaser strip, logos/use-case row, and a final CTA band.
2. **Product (`/product`)** — deep dive per pillar with alternating text/visual rows: DID + W3C Verifiable Credential issuance, real-time ALLOW/DENY/HOLD policy engine with human-in-the-loop, virtual-card spend caps and MCC whitelists, tamper-evident hash chain and one-click export. Includes an architecture diagram (agent → gateway → tools/payments → audit chain) and an integration snippet block.
3. **Solutions (`/solutions`)** — audience cards: banks and insurers, retail/commerce platforms, ad-tech and agencies, BPO/procurement. Each with the risk it removes and the outcome. Plus a short "for platform teams" section.
4. **Compliance (`/compliance-standards`)** — regulatory readiness page: IMDA Model AI Governance for GenAI, HKMA GenA.I. Sandbox, PDPO/PDPA data handling, W3C VC / DID standards, evidence-and-export section, and a control-mapping table.
5. **Pricing (`/pricing`)** — three tiers (Pilot, Growth, Enterprise) with agent-count, gateway-volume and audit-retention rows, a comparison table, and an FAQ accordion. Marked indicative, with "talk to us" as the conversion path.
6. **About (`/about`)** — mission, the KYA thesis, timeline/milestones, and standards-body alignment. No invented team bios or customer testimonials.
7. **Contact (`/contact`)** — demo-request form (name, work email, company, region, agent estate size, message) with client-side validation and a success state via sonner toast. Front-end only, no submission backend in this pass.

## Design

Reuses the existing dark cybersecurity token set in `src/styles.css` — deep slate base, emerald/cyan accents, hairline borders, glow shadows, Inter + JetBrains Mono. Marketing surfaces add: `grid-backdrop` hero treatment, larger display type scale, gradient rule dividers, and Motion scroll-reveal on sections. No new hardcoded colors; any new token (e.g. marketing hero gradient) is added to `styles.css`.

## Technical notes

- New files: `src/components/marketing/*` (site header, footer, section wrappers, CTA band, feature cards, diagrams) and the seven route files.
- `src/routes/dashboard.tsx` becomes the layout rendering `AppShell` + `<Outlet />`; existing page bodies move into `dashboard.index.tsx`, `dashboard.agents.tsx`, etc., with `createFileRoute` strings updated to match. `AppShell` nav targets and `HermesProvider` usage update to the new paths.
- `__root.tsx` stops wrapping everything in `AppShell`; it keeps the provider, font link, and `<Outlet />` so marketing pages render without the sidebar.
- All content is factual product/positioning copy — no fabricated logos, customer names, metrics, or certifications.
- No backend, database, or auth in this pass; the contact form is local state only. Real lead capture can be added later with Lovable Cloud.
