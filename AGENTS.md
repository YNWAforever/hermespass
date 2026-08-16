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
