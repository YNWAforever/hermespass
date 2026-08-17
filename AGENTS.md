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
