# HermesPass Magic-Link Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passwordless Neon Auth magic-link sign-in to the existing HermesPass `/login` page while preserving email/password sign-in, membership authorization, and redirect safety.

**Architecture:** Keep the existing server-owned `signInAction` and add a sibling `requestMagicLinkAction` that calls `getAuth().signIn.magicLink` with the fixed internal callback `/dashboard`. Render a separate client form below the password form and return only generic success/error messages; the existing Neon Auth route handles link verification and the existing dashboard layout remains the membership gate.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2 `useActionState`, Neon Auth `@neondatabase/auth@0.4.2-beta`, TypeScript, Tailwind 4, Vitest, Testing Library, Playwright, Bun 1.3.14.

## Global Constraints

- Preserve the existing email/password form and its `next` redirect behavior.
- Use the existing Neon Auth server adapter; do not add Supabase, another auth provider, new database tables, or new cookies.
- The magic-link callback is always the internal `/dashboard` path; never accept an arbitrary callback URL from the browser.
- Do not render or log provider errors, magic-link tokens, passwords, or session data.
- Return a generic success message so a request does not reveal whether an address is registered; membership authorization still occurs in `DashboardLayout`.
- Treat missing `NEON_AUTH_BASE_URL` or `NEON_AUTH_COOKIE_SECRET` as a safe configuration error.
- Do not send real email or mutate Neon/Vercel/provider configuration in local tests.
- Preserve unrelated untracked patch artifacts and stage only the files listed in each task.

---

### Task 1: Add red tests for the magic-link action and login surface

**Files:**

- Create: `tests/unit/magic-link-login.test.ts`
- Create: `tests/unit/login-form.test.tsx`
- Modify: `tests/e2e/routes.spec.ts`

**Interfaces:**

- The tests will consume the planned action:

```ts
export type MagicLinkState = {
  sent: boolean;
  error?: string;
};

export function requestMagicLinkAction(
  _: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState>;
```

- The UI test will consume `LoginForm({ next }: { next: string })` and require both password controls and a separate magic-link form.

- [ ] **Step 1: Write the failing action tests.** Create `tests/unit/magic-link-login.test.ts` with a hoisted `getAuth` mock whose `signIn.magicLink` is a Vitest spy. Cover these exact cases:

```ts
it("rejects blank and malformed email without calling Neon Auth", async () => {
  const { requestMagicLinkAction } = await import("@/app/login/actions");
  for (const email of ["", "not-an-email", "member @example.com"]) {
    const data = new FormData();
    data.set("email", email);
    await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
      sent: false,
      error: "Enter a valid email address.",
    });
  }
  expect(magicLink).not.toHaveBeenCalled();
});

it("uses the normalized email and fixed dashboard callback", async () => {
  magicLink.mockResolvedValueOnce({ data: { status: true }, error: null });
  const { requestMagicLinkAction } = await import("@/app/login/actions");
  const data = new FormData();
  data.set("email", "  Member@Example.com ");
  data.set("next", "//attacker.example");

  await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
    sent: true,
  });
  expect(magicLink).toHaveBeenCalledWith({
    email: "Member@Example.com",
    callbackURL: "/dashboard",
  });
});

it("does not expose a provider error", async () => {
  magicLink.mockResolvedValueOnce({
    data: null,
    error: { code: "MAGIC_LINK_PROVIDER_SECRET", message: "private details" },
  });
  const { requestMagicLinkAction } = await import("@/app/login/actions");
  const data = new FormData();
  data.set("email", "member@example.com");

  await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
    sent: false,
    error: "We couldn't send a sign-in link right now.",
  });
});

it("fails safely when Auth configuration is unavailable", async () => {
  getAuth.mockImplementationOnce(() => {
    throw new Error("NEON_AUTH_BASE_URL is required for Auth-backed requests");
  });
  const { requestMagicLinkAction } = await import("@/app/login/actions");
  const data = new FormData();
  data.set("email", "member@example.com");

  await expect(requestMagicLinkAction({ sent: false }, data)).resolves.toEqual({
    sent: false,
    error: "Authentication is not available for this environment.",
  });
});
```

- [ ] **Step 2: Run the action tests and verify the expected RED.**

Run:

```powershell
bun x vitest run tests/unit/magic-link-login.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: FAIL because `requestMagicLinkAction` and `MagicLinkState` do not exist yet.

- [ ] **Step 3: Write the failing login-form tests.** Render `LoginForm` with Testing Library, mock `useActionState` for both actions, and assert:

```ts
expect(screen.getByLabelText("Email")).toBeInTheDocument();
expect(screen.getByLabelText("Password")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
expect(screen.getByLabelText("Magic-link email")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Email me a sign-in link" })).toBeInTheDocument();
```

Also assert that the sent state renders `role="status"` with `If an account exists, check your email.` and that the password form remains present.

- [ ] **Step 4: Run the UI test and verify the expected RED.**

Run:

```powershell
bun x vitest run tests/unit/login-form.test.tsx --maxWorkers=1 --fileParallelism=false
```

Expected: FAIL because the login form has no magic-link controls.

- [ ] **Step 5: Add the unauthenticated route contract.** Extend `tests/e2e/routes.spec.ts` with a `/login?next=%2Fdashboard` check that expects HTTP 200 and the text `Email me a sign-in link`; do not submit it or send an email.

- [ ] **Step 6: Commit only the red tests.**

```powershell
git add -- tests/unit/magic-link-login.test.ts tests/unit/login-form.test.tsx tests/e2e/routes.spec.ts
git commit -m "test: specify magic-link login flow"
```

---

### Task 2: Implement the server action and client form

**Files:**

- Modify: `src/app/login/actions.ts`
- Create: `src/components/auth/magic-link-form.tsx`
- Modify: `src/components/auth/login-form.tsx`
- Modify: `src/app/login/page.tsx`

**Interfaces:**

- Produce `MagicLinkState` and `requestMagicLinkAction` exactly as defined in Task 1.
- `MagicLinkForm` accepts `{ next: string }` but must not forward `next` to Neon Auth; it exists only to preserve the page contract and future UI consistency.

- [ ] **Step 1: Add the server action.** In `src/app/login/actions.ts`, add `'use server'` (preserving the existing directive), the `MagicLinkState` type, and this behavior:

```ts
const GENERIC_MAGIC_LINK_ERROR = "We couldn't send a sign-in link right now.";

export async function requestMagicLinkAction(
  _: MagicLinkState,
  formData: FormData,
): Promise<MagicLinkState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { sent: false, error: "Enter a valid email address." };
  }

  try {
    const { error } = await getAuth().signIn.magicLink({
      email,
      callbackURL: "/dashboard",
    });
    if (error) return { sent: false, error: GENERIC_MAGIC_LINK_ERROR };
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("NEON_AUTH_BASE_URL") || message.includes("NEON_AUTH_COOKIE_SECRET")) {
      return { sent: false, error: "Authentication is not available for this environment." };
    }
    return { sent: false, error: GENERIC_MAGIC_LINK_ERROR };
  }
}
```

The action must not call `redirect`; link verification performs the redirect after redemption.

- [ ] **Step 2: Run the action tests and verify GREEN.**

Run:

```powershell
bun x vitest run tests/unit/magic-link-login.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: PASS for all action cases.

- [ ] **Step 3: Create the focused `MagicLinkForm`.** Add a client component using `useActionState(requestMagicLinkAction, { sent: false })`. Render a labeled email input, a submit button, `role="status"` for the generic success message, and `role="alert"` for errors. Disable the button while pending and use the existing `Label`, `Input`, and `Button` primitives/classes.

- [ ] **Step 4: Compose the form below password sign-in.** Keep `LoginForm`’s current password form unchanged and render `<MagicLinkForm next={next} />` below it with a visual divider. Do not remove or rename the existing password fields, action, or button.

- [ ] **Step 5: Run the focused UI tests and verify GREEN.**

Run:

```powershell
bun x vitest run tests/unit/login-form.test.tsx tests/unit/magic-link-login.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: PASS; both password and magic-link controls render, and provider errors do not leak raw text.

- [ ] **Step 6: Commit the implementation slice.**

```powershell
git add -- src/app/login/actions.ts src/components/auth/magic-link-form.tsx src/components/auth/login-form.tsx src/app/login/page.tsx tests/unit/magic-link-login.test.ts tests/unit/login-form.test.tsx
git commit -m "feat: add Neon Auth magic-link login"
```

---

### Task 3: Document provider configuration and verify callback/membership behavior

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `tests/e2e/routes.spec.ts`
- Test: `tests/e2e/interactions.spec.ts`

**Interfaces:**

- No new environment variable is introduced. Existing `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET` remain required for Auth-backed requests.
- The existing `/api/auth/[...path]` handler must continue proxying Neon Auth’s `/sign-in/magic-link` and `/magic-link/verify` paths without a custom route.

- [ ] **Step 1: Add documentation checks before editing docs.** Extend a unit contract (or the existing release-gate contract) to assert `.env.example` and `README.md` mention that Neon Auth email delivery/magic-link support must be enabled for each deployed branch, while the two existing Auth variables remain the only application-side Auth variables.

- [ ] **Step 2: Run the documentation contract and capture RED.**

Run:

```powershell
bun x vitest run tests/unit/magic-link-login.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: the new documentation assertions fail before the text is added.

- [ ] **Step 3: Update `.env.example` and `README.md`.** Add concise text explaining that Neon Console/Auth configuration must enable magic-link email delivery for the branch used by the deployment, that callback verification returns to `/dashboard`, and that a successful Auth session still requires HermesPass organization membership. Do not print or add secrets.

- [ ] **Step 4: Run the documentation contract and verify GREEN.**

Run:

```powershell
bun x vitest run tests/unit/magic-link-login.test.ts --maxWorkers=1 --fileParallelism=false
```

Expected: PASS with no secret values in the checked-in files.

- [ ] **Step 5: Add browser assertions without sending mail.** In `tests/e2e/interactions.spec.ts`, intercept the auth proxy request for `/api/auth/sign-in/magic-link`, return a deterministic `{ data: { status: true }, error: null }` response, submit the magic-link form, and assert the generic status message. Assert the password form remains visible after this interaction.

- [ ] **Step 6: Run the focused browser test.**

Run:

```powershell
bun x playwright test tests/e2e/interactions.spec.ts --grep "magic-link"
```

Expected: PASS without network email delivery or real Neon mutations.

- [ ] **Step 7: Commit docs and browser coverage.**

```powershell
git add -- .env.example README.md tests/e2e/routes.spec.ts tests/e2e/interactions.spec.ts
git commit -m "docs: configure Neon Auth magic-link delivery"
```

---

### Task 4: Run the complete local verification gate and prepare hosted handoff

**Files:**

- Verify only; no additional source files expected.

- [ ] **Step 1: Run formatting, lint, typecheck, and unit tests.**

```powershell
bun run format:check
bun run lint
bun run typecheck
bun run test
```

Expected: all commands exit 0; no unrelated files are staged.

- [ ] **Step 2: Run the production build.**

```powershell
bun run build
```

Expected: Next production build completes and the login route remains dynamic.

- [ ] **Step 3: Run the route and focused browser checks.**

```powershell
bun run test:e2e -- tests/e2e/routes.spec.ts
bun x playwright test tests/e2e/interactions.spec.ts --grep "magic-link"
```

Expected: `/login?next=%2Fdashboard` returns 200, both forms render, and the mocked magic-link request shows the generic status.

- [ ] **Step 4: Verify repository hygiene.**

```powershell
git diff --check
git status --short --branch
```

Expected: only the intentional commits are present; the pre-existing `.mandate-*.patch` and `.test.patch` files remain untouched and unstaged.

- [ ] **Step 5: Report the hosted gate separately.** State that local implementation and tests are complete, then request explicit approval before pushing or deploying to `https://hermespass.vercel.app`. Hosted verification must confirm the target Vercel environment has the matching Neon Auth branch URL, cookie secret, and magic-link email delivery enabled. Do not change Vercel cron, Neon branches, DNS, or production data as part of this feature.

## Self-review checklist

- Spec coverage: password preservation, magic-link request, fixed callback, generic success, safe errors, membership gate, provider documentation, unit/browser verification, and hosted approval are each covered by Tasks 1–4.
- Placeholder scan: no `TODO`, `TBD`, or unspecified implementation steps are used.
- Type consistency: `MagicLinkState`, `requestMagicLinkAction`, and `MagicLinkForm({ next })` signatures are defined once and reused consistently.
