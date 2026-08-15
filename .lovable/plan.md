# HermesPass — KYA Compliance Dashboard

A dark, high-trust enterprise dashboard for issuing and governing AI agent "digital passports". Fully front-end with realistic mock data and working local state (no backend yet).

## Design system

- Dark cybersecurity theme: base `#0B0F19`, elevated slate surfaces, hairline borders, emerald `#10B981` and cyan `#06B6D4` accents with subtle glow shadows.
- Inter (loaded via a `<link>` in the root route), tight tracking on headings, mono for DIDs, hashes and keys.
- Tokens defined once in `src/styles.css` (dark-first): surfaces, accent/glow, risk colors (low/medium/high), decision colors (allow/deny/hold) plus a pulsing "hold" animation. Components use only semantic classes.
- Shadcn cards, dialogs, drawers, sliders, tables, badges; Lucide icons; Recharts for the overview chart; Motion for entrance/stream animations.

## Layout

Persistent app shell in the root route: left sidebar (Overview, Agents, Approvals, Wallets, Compliance), org switcher, and a top bar with environment pill, gateway status dot and pending-approval counter.

## Pages

1. **Overview (`/`)** — KPI cards (active passports, actions gated today, holds pending, blocked spend), decision-mix area chart, recent activity feed. Replaces the placeholder home page.
2. **Agents (`/agents`)** — Grid of Digital Passport cards: glowing status badge (Active / Revoked / Under Audit), agent name, `did:web:hermespass.asia:agent:...`, owner org, risk badge, scopes, spend cap, "W3C VC Verified" pill opening a dialog with decoded JSON-LD credential and public-key thumbprint. Toolbar with search, risk filter, and "Issue New Agent Passport" modal (name, role, org, risk tier, tool scopes, spend cap) that mints a new passport into local state.
3. **Approvals (`/approvals`)** — Simulated live stream of agent actions appending on an interval, tri-state badges ALLOW / DENY / HOLD (amber pulse), filter tabs. Clicking a row opens a review drawer with request detail, policy reason, and Approve / Reject / Escalate to Telegram actions that update the row and toast.
4. **Wallets (`/wallets`)** — Virtual card visualizer per agent (cardholder = agent ID, gradient card face, masked PAN), plus per-tx / daily / monthly spend-cap sliders, MCC whitelist toggles, and a utilization bar. Changes persist in local state.
5. **Compliance (`/compliance`)** — Tamper-evident hash-chain table (block index, timestamp, agent, action, payload hash, previous hash, signature-valid icon, decision) with chain-integrity summary; header bar with IMDA MGF v1.5 and HKMA GenA.I. Sandbox++ readiness badges and a one-click CSV export (client-side download) plus print-to-PDF report action.

## Technical notes

- Mock data + mutations live in a single `HermesProvider` React context (`src/lib/hermes-*.ts(x)`) shared by all routes: 4 seeded agents (Kinnso Recommendation Agent, Fimmick Merchant Concierge, Adfocate Campaign Optimizer, AutoProcure Bot), gateway events, wallets, and a deterministic mock hash chain where each block's `prevHash` links to the last.
- Approvals "WebSocket" is simulated with an interval-driven event generator in the provider; approving a HOLD flips it to ALLOW and appends a new chain block.
- Each route file is a separate TanStack route with its own `head()` metadata (unique title/description/og).
- No database or auth in this pass; state resets on reload. Cloud can be layered on later if you want real persistence.
