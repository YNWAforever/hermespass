# ADR-0004: Scoped payment rail boundary

Date: 2026-08-18
Status: accepted for sandbox implementation; production disabled

## Context

HermesPass Phase 2 already owns Neon identity, BYOK agent keys, versioned HKD
policies, per-agent advisory locking, human approvals, and the hash-chained audit
log. The payment layer must reuse those boundaries. The attached roadmap's Supabase
examples do not apply to this checkout.

Stripe Issuing provides a documented test-mode virtual-card and synchronous
`issuing_authorization.request` webhook flow, but availability and card currencies
depend on the Stripe account and region. HermesPass entities are HK/SG, while the
current policy table is intentionally HKD-only.

## Decision

- Define `PaymentRail` in `src/lib/payments/rails/types.ts`; only rail adapters may
  import a provider SDK.
- Implement Stripe test mode behind an `sk_test_` guard and a deterministic HKD
  `MockPaymentRail` for CI. No FX conversion is introduced. Non-HKD authorization
  requests decline with `RAIL_CURRENCY_UNSUPPORTED`.
- Use the existing `evaluateGatewayPolicy` rule order through a payment adapter;
  payment authorization cannot return `hold`, so a hold result declines with
  `PAYMENT_REQUIRES_PREAUTHORIZATION` and the mandate is the preauthorization.
- Store mandates, wallet cards, and payment authorizations in Neon with forced RLS,
  composite tenant foreign keys, idempotency constraints, and existing audit-chain
  triggers. Private card data is never stored.
- Airwallex (HK) and Nium (SG) remain commercial/partner gates, not code paths in
  this sandbox slice. Production credentials remain blocked until the E2E gate and
  a signed rail contract are both approved.

## Consequences

A provider adapter can be swapped without changing mandate verification, policy
evaluation, audit, or dashboard read models. Stripe sandbox availability is verified
separately; CI does not require provider secrets. The payment authorization path has
no network calls after webhook receipt and is measured against the two-second rail
deadline.

## Gate log

- Phase 3 deterministic E2E: recorded by Task 9 with its commit SHA.
- Stripe sandbox probe: recorded only when an approved `sk_test_` environment exists.
- Production rail contract: blocked until a human records the signed Airwallex/Nium
  agreement and explicitly approves production credentials.
