# HermesPass

HermesPass is a high-trust enterprise control plane for AI-agent identity, authority, spend, and compliance evidence across Hong Kong and Singapore.

The application includes:

- English and Simplified/Traditional Chinese marketing sites.
- Neon-backed Ed25519 agent passports and scoped wallet simulations.
- A live policy-gateway simulation with human review actions.
- A tamper-evident audit chain with local CSV and print exports.

## Stack

- Next.js 16.3.1 App Router
- React 19.2
- Tailwind CSS 4
- Bun 1.3.14
- Neon Postgres 18 with Neon Auth
- Drizzle ORM and reviewed SQL migrations
- Ed25519 / W3C VC 2.0 credentials with envelope-encrypted key material
- Vitest and Testing Library
- Playwright

## Requirements

- Node.js 22.0 or newer
- Bun 1.3.14

## Development

```powershell
bun install --frozen-lockfile
bun run dev
```

Open `http://localhost:3000`. Public marketing routes work without a database. The dashboard starts at `/dashboard`; its four focused views are `/dashboard/agents`, `/dashboard/approvals`, `/dashboard/wallets`, and `/dashboard/compliance`.

Database-backed requests require `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `HERMES_KEK_V1` (a base64url-encoded 32-byte key), and `HERMES_KEY_ENVIRONMENT`. Keep migration credentials in an operator-only context; the deployed runtime uses the restricted `hermes_app` role. Apply the reviewed SQL in `drizzle/` with a migration job—never use `drizzle-kit push` against a hosted branch. The issuer is provisioned separately with `bun run db:bootstrap-issuer` after the environment gate is approved.

## Verification

```powershell
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
```

Browser suites are available through `bun run test:e2e`, with focused route and visual-parity commands under `test:routes` and `test:parity`.

## Identity and audit boundaries

Neon Auth owns user sessions. HermesPass stores only the user ID and one organization membership; it never modifies the managed Auth schema. Tenant tables use forced RLS and a transaction-local verified user claim. Owners and admins can issue or revoke passports; viewers are read-only. Issuer and agent private JWKs are envelope-encrypted with an environment-specific KEK, and the append-only audit trigger computes each hash while holding a per-organization advisory lock.

## App Router boundaries

Route `page.tsx` files remain Server Components and own their metadata. Stateful marketing and dashboard bodies live in explicit client components. Pure locale validation and Chinese conversion stay separate from the client-only locale context so server metadata never imports React client modules.
