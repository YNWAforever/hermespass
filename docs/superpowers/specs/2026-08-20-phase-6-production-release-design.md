# HermesPass Phase 6 — Neon-First Production Release Design

## Status

Approved working design for the repository-side release track. Hosted/provider operations remain separately approval-gated.

## Context

The build-out index defines phases 0 through 5 and makes production launch part of the whole-build definition of done. Phase 4 and Phase 5 source work is complete on verified branches, but the Phase 5 launch-readiness checklist deliberately leaves Neon/Vercel, domain, Cloudflare, Stripe, n8n, PITR, penetration testing, alerting, and production evidence unchecked. The original documents mention Supabase; HermesPass uses Neon by explicit product decision, so this design keeps all release checks Neon-first.

## Goal

Make the repository safe and testable for the production-release gate without pretending that hosted resources, secrets, customer data, or production approvals already exist.

## Scope

Phase 6 contains five repository-side deliverables:

1. A typed, offline release preflight that validates configuration shape, runtime-role separation, branch/base-URL expectations, migration lineage, route contracts, and secret-pattern absence without printing secret values or making network calls.
2. A compatibility closure for the attached Phase 5 communications contract: the inbound route accepts `x-hermespass-comms-secret` in addition to the existing aliases and applies the same constant-time verification.
3. A release-gate document that separates source evidence from nonproduction-provider approval and production-release approval.
4. CI contracts that run the offline preflight and fail closed on migration drift or unsafe repository literals, while keeping provider jobs explicitly approval-gated.
5. A dated launch-readiness update that records evidence links and leaves unchecked items unchecked until independently verified.

Phase 6 does not create or connect Neon, Vercel, Cloudflare, Stripe, n8n, DNS, or email routing; does not apply hosted migrations; does not generate issuer material; and does not seed production customers.

## Architecture

`phase6-release-preflight.ts` is a pure command-line boundary. It receives a small typed input object (environment-name map, repository checks, and optional evidence metadata), validates it with deterministic functions, and returns a JSON-safe report with stable error codes. The command never logs values; diagnostics contain variable names and remediation text only. CI invokes it with fixture values and separately runs the existing format, lint, typecheck, Vitest, Drizzle, build, PostgreSQL, and Playwright gates.

The communications route remains server-only. Its accepted secret-header set is an explicit constant, normalized to the first present value, and passed into the existing constant-time comparison. No browser bundle or public response exposes the header name or secret.

The release document is a human evidence ledger, not a secret store. Every hosted item has an owner/evidence field and an explicit approval state. Local checks link to immutable commit/test evidence; external checks remain unchecked until a provider console, deployment, or operator artifact proves them.

## Preflight contract

The preflight exports:

```ts
export type Phase6CheckCode =
  | "MISSING_REQUIRED_VARIABLE"
  | "UNSAFE_RUNTIME_ROLE"
  | "INVALID_BRANCH_CONFIGURATION"
  | "INVALID_BASE_URL"
  | "MIGRATION_DRIFT"
  | "SECRET_LITERAL_FOUND"
  | "ROUTE_CONTRACT_FAILED";

export type Phase6PreflightResult = {
  ok: boolean;
  checks: Array<{ code: Phase6CheckCode | "OK"; detail: string }>;
};

export function runPhase6Preflight(input: {
  requiredVariables: ReadonlyArray<string>;
  presentVariableNames: ReadonlySet<string>;
  runtimeDatabaseUrl: string | null;
  branch: string;
  baseUrl: string;
  migrationDiff: boolean;
  secretLiteralMatches: number;
  routeContractOk: boolean;
}): Phase6PreflightResult;
```

Rules are deliberately structural: the runtime URL must not contain an owner/migration role, branch must be `development`, `preview`, or `production`, base URL must be HTTPS outside localhost, migration drift and secret-literal matches fail, and every required variable name must be present in the supplied name set. The preflight does not require production secret values and cannot be used to print them.

## Error handling

The CLI exits `0` only when all checks are `OK`; otherwise it exits `1` and prints the redacted JSON report to stdout. Unexpected filesystem or parsing errors exit `2` with a generic failure code and no input values. The inbound route preserves its existing `{ data }`/`{ error }` envelope and maps header, body-size, UTF-8, and JSON failures without revealing secrets.

## Verification

Unit tests cover every preflight failure code, accepted local/production URL rules, redaction, and deterministic ordering. Route tests cover all three secret headers, mismatched secrets, oversized/fatal-UTF8 bodies, and successful message insertion. CI contract tests assert the preflight command, migration no-diff check, and explicit provider approval wording. Existing full unit, PostgreSQL 18, build, and Playwright suites remain required.

## External gates retained

The final release still requires independent evidence for Singapore-region Neon, isolated development/preview/production branches, `hermes_app` runtime role, PITR restore plus audit verification, populated two-tenant RLS checks, secret inventory and rotation, rate limiting, penetration testing, uptime/error alerts, incident ownership, nonproduction provider approval, and production release approval. Phase 6 records these gates; it does not infer or fabricate their completion.
