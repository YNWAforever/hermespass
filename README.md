# HermesPass

HermesPass is a high-trust enterprise control plane for AI-agent identity, authority, spend, and compliance evidence across Hong Kong and Singapore.

The application includes:

- English and Simplified/Traditional Chinese marketing sites.
- Verifiable mock agent passports and scoped wallets.
- A live policy-gateway simulation with human review actions.
- A tamper-evident audit chain with local CSV and print exports.

## Stack

- Next.js 16.3.1 App Router
- React 19.2
- Tailwind CSS 4
- Bun 1.3.14
- Vitest and Testing Library
- Playwright

## Requirements

- Node.js 20.9 or newer
- Bun 1.3.14

## Development

```powershell
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:3000`. The dashboard starts at `/dashboard`; its four focused views are `/dashboard/agents`, `/dashboard/approvals`, `/dashboard/wallets`, and `/dashboard/compliance`.

## Verification

```powershell
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

Browser suites are available through `bun run test:e2e`, with focused route and visual-parity commands under `test:routes` and `test:parity`.

## App Router boundaries

Route `page.tsx` files remain Server Components and own their metadata. Stateful marketing and dashboard bodies live in explicit client components. Pure locale validation and Chinese conversion stay separate from the client-only locale context so server metadata never imports React client modules.
