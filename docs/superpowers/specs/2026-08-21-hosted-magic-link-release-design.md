# HermesPass Hosted Magic-Link Release Design

**Date:** 2026-08-21  
**Status:** Approved design; implementation and provider operations pending

## Goal

Make the merged magic-link login available at `https://hermespass.vercel.app` through a staged Vercel/Neon release, while preserving the hourly approval-maintenance cron and the existing membership authorization boundary.

## Release architecture

- GitHub `main` is the source of truth.
- Vercel Pro is required so `/api/cron/approvals` can continue running hourly.
- Vercel project `hermespass` uses Neon project `curly-smoke-16875897` under Willy.
- Preview and Development deployments use the Neon `development` branch; Production uses the Neon `production` branch.
- The Vercel/Neon integration supplies database connectivity. Protected Vercel environment settings contain `NEON_AUTH_BASE_URL` and `NEON_AUTH_COOKIE_SECRET`; secrets are never committed or printed.
- Existing Neon Auth email delivery handles magic-link messages. The application keeps the fixed internal callback `/dashboard` and performs organization-membership authorization on the server.

## Staged flow

1. The operator upgrades Vercel to Pro and confirms the Neon/Vercel integration and branch mapping.
2. The operator enables the existing Neon Auth email-delivery configuration on the `production` branch and configures the required protected environment values.
3. Deploy the pushed `main` commit to a Preview sourced from `development`.
4. Verify the public login route, both forms, magic-link redemption with an existing provisioned member, and access denial for a valid session without membership.
5. Deploy the same verified commit to Production and repeat the route and member-flow smoke checks at `hermespass.vercel.app`.

## Safety boundaries

This phase does not change application code, database schema, customer data, issuer material, DNS, custom domains, or unrelated provider integrations. It does not create production identities. Auth failures remain generic and must not expose provider errors, tokens, passwords, or session data.

## Evidence and rollback

Record the preview and production URLs, deployed commit SHA, branch mapping, route status, and authentication-flow results without secret values. If a production smoke check fails, restore the previous READY Vercel deployment alias. No database migration or customer-data rollback is required for this phase.
