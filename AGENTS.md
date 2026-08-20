<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## Next.js App Router boundaries

- Keep `src/app/**/page.tsx` and route layouts as Server Components unless a browser API or React hook requires a client boundary.
- Route wrappers own metadata; move stateful UI into focused files marked `"use client"` under `src/components/`.
- Keep locale conversion and metadata helpers server-safe; import React locale context only from client components.

## Neon identity and audit boundaries

- Treat `src/app/**/page.tsx` and protected route handlers as server-owned authorization boundaries. Resolve the Neon Auth session and organization membership on the server; do not trust organization IDs, roles, or DIDs supplied by the browser.
- Use the restricted `hermes_app` role at runtime and keep migration URLs, owner connections, KEKs, and Auth secrets out of client bundles. Schema changes belong in reviewed Drizzle migrations and SQL policies; never run `drizzle-kit push` against hosted branches.
- Keep issuer and agent private JWKs inside the envelope-encryption adapter. Public DID and verification responses may expose only the documented safe columns, and audit rows are append-only.

## Neon productization boundaries

- Productization adapters remain request-time and lazy: missing report, Stripe, or communications secrets must fail closed without breaking static builds.
- Persist only hashes/digests for invite, API-key, provider-event, and message replay identifiers; keep raw provider payloads and credentials out of logs and browser responses.
- Keep n8n and Stripe artifacts inactive/test-mode until the separate nonproduction provider approval; production migrations, DNS, publication, and customer seed require a separate production release approval.

## Phase 6 release boundaries

- The offline Phase 6 preflight validates configuration shape, migration hygiene, route contracts, and secret-pattern absence without network or provider calls; it must never print secret values.
- Neon is the authoritative database provider. Hosted Neon/Vercel, Cloudflare, Stripe, n8n, DNS, production migrations, issuer generation, and customer seed remain separate approval-gated operations.
- Keep the launch ledger dated and evidence-linked; unchecked external items are not implied to be complete by green local CI.
