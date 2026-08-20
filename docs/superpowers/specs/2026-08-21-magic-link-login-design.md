# HermesPass Magic-Link Login Design

## Context

HermesPass currently authenticates control-plane users through Neon Auth email/password sign-in at `/login`. The login page is intentionally restricted to provisioned organization members. The existing password flow must remain available while adding passwordless sign-in for the same users.

## Goal

Add a second, passwordless sign-in path that sends a Neon Auth magic link and returns the user to `/dashboard` after the link is redeemed. Preserve the current password form, membership checks, redirect safety, styling, and no-signup policy for direct Auth API calls.

## User experience

- The existing email/password form remains unchanged.
- A separate email-only form is labeled “Email me a sign-in link.”
- On a valid request, the page shows a generic “If an account exists, check your email” message. The response must not disclose whether the address belongs to a Neon Auth account or HermesPass organization.
- The link callback lands at `/dashboard`; the existing dashboard layout redirects unauthenticated users to `/login` and renders the existing membership-denied state for authenticated users without an `org_members` row.
- Provider or configuration failures show a safe, non-secret error message and never expose raw Neon Auth responses.

## Architecture

1. Add a server action beside `signInAction` in `src/app/login/actions.ts`.
2. Validate and normalize the submitted email before calling `getAuth().signIn.magicLink` from the existing Neon Auth server adapter.
3. Pass only the safe internal callback `/dashboard`; do not accept an arbitrary callback from the browser.
4. Add a focused client component or action-state form in `src/components/auth/` and render it below the password form in `src/app/login/page.tsx`.
5. Reuse the existing auth route and Neon Auth magic-link verification endpoint; no new database tables, cookies, or provider-specific API route are introduced.

## Security and failure behavior

- Blank or malformed email input is rejected locally.
- Success and unknown-account cases use the same generic message to reduce account enumeration.
- Callback destinations remain dashboard-only and are never taken from an untrusted absolute URL.
- Existing membership authorization remains authoritative after link redemption; authentication alone does not grant dashboard access.
- No password, token, or provider response is logged or rendered.
- The deployed Neon Auth email/magic-link provider must be enabled and configured; missing configuration returns a safe error.

## Verification

- Unit tests cover valid submission, blank/malformed email, provider failure, generic success messaging, safe callback, and preservation of the password action.
- Typecheck, lint, formatting, Vitest, and Next production build must pass.
- Browser verification should exercise the login page structure without sending a real email; the provider call is mocked or intercepted.
- Hosted deployment verification is separate and requires explicit approval because it writes to Vercel.

## Non-goals

- Replacing password sign-in.
- Adding social login, email OTP, password reset, or a new auth provider.
- Changing organization membership or Neon Auth schemas.
- Provisioning users or sending real emails from local tests.
