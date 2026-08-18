# HermesPass Phase 3 — Scoped Payment Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add signed AP2-style intent/cart mandates, policy-scoped virtual-card provisioning, and a synchronous payment-authorization path on Neon while preserving the existing 44-route product and keeping all payment rails sandbox-only.

**Architecture:** Phase 3 extends the completed Neon/Drizzle Phase 2 model; it does not introduce Supabase or a second policy engine. Mandates, cards, and payment authorizations are tenant rows protected by the same pooled `hermes_app` role, forced RLS, transaction-local claims, per-agent advisory locks, and hash-chained audit trigger. A narrow `PaymentRail` adapter owns all Stripe SDK imports; the authorization service translates a rail authorization into the existing pure policy engine, rejects `hold` because a card network requires a synchronous answer, and records an idempotent decision before returning the direct webhook response.

**Tech Stack:** Next.js 16.3.1 App Router, React 19.2, Neon Postgres 18, Drizzle ORM 0.45.2 / Drizzle Kit 0.31.10, `@neondatabase/serverless` 1.1.0, Node 22, Bun 1.3.14, Ed25519 from `@noble/curves` 2.3.0, RFC 8785 `canonicalize` 3.0.0, Stripe Node SDK pinned to `stripe@22.5.0`, Vitest, Playwright, and the existing React Query client.

## Global Constraints

- Execution starts only after `origin/main` contains Phase 2 final commit `5ce842410432e59c752b4686d581b0ed082198e6` as an ancestor and the Phase 2 preview has passed its route, dashboard, database, and policy-gateway checks.
- The execution branch is `codex/phase-3-scoped-payments` in `.worktrees/phase-3-scoped-payments`, based on the merged Phase 2 commit; do not implement directly on `main` or on the Phase 2 PR branch.
- The attached `2026-08-16-phase-3-payments.md` is a requirements brief, not an instruction to copy its Supabase paths. Its `supabase/*`, `src/server/*`, `evaluatePolicy`, and `AGENT_DID_PREFIX` examples are translated below to the current Neon/Drizzle, `src/lib/*`, `evaluateGatewayPolicy`, and `did:web` boundaries.
- No Supabase package, Supabase migration, Supabase admin client, Realtime service, raw PAN/CVC, raw merchant payload, agent private JWK, or production payment credential may be added.
- No provider, Vercel, Neon, Stripe Dashboard, webhook registration, domain, partner, PR, push, merge, or production migration write is performed without the separate approval gate stated in the task.
- `STRIPE_SECRET_KEY` must start with `sk_test_`; any other value fails closed before the SDK is constructed. `PAYMENT_RAIL=airwallex` and `PAYMENT_RAIL=nium` remain disabled until a signed rail contract and approved adapter exist.
- HermesPass policy currency remains HKD because Phase 2 enforces `agent_policies.currency = 'HKD'`. There is no implicit FX. A rail authorization in another currency returns `RAIL_CURRENCY_UNSUPPORTED`; the deterministic CI rail uses HKD. Stripe test cards may be USD because Stripe Issuing card currency is account/region constrained; a Stripe sandbox check must prove that mismatch is declined rather than silently converted.
- All payment decisions are authorization-only. HermesPass never captures, settles, refunds, or executes a downstream merchant tool in Phase 3.
- Mandates and payment rows use the existing organization/agent composite foreign-key pattern, forced RLS, reviewed additive SQL, and append-only audit events. `drizzle-kit push` is prohibited against hosted branches.
- Preserve all marketing metadata, all 39 public marketing checks, all five dashboard routes and metadata, and existing mock wallets/approvals/events only until the live payment read model replaces their callers.
- The synchronous authorization endpoint must return a valid decision within a 1.5-second application budget and within Stripe's two-second webhook window. It must not make an outbound rail call while deciding.

## Source-of-truth interfaces

The following names are fixed before implementation so later tasks do not invent incompatible boundaries:

```ts
export type MandateKind = "intent" | "cart";
export type MandateStatus = "active" | "consumed" | "revoked" | "expired";

export type MandateConstraints = {
  currency: "HKD";
  maxAmountCents: number;
  merchant: string | null;
  mccAllowlist: string[];
  expiresAt: string;
  oneTime: boolean;
};

export type MandateBodyV1 = {
  version: "1";
  mandateId: string;
  agentDid: string;
  keyId: string;
  kind: MandateKind;
  nonce: string;
  issuedAt: string;
  parentMandateId: string | null;
  constraints: MandateConstraints;
};

export type SignedMandateV1 = {
  body: MandateBodyV1;
  signature: string; // unpadded base64url Ed25519 signature
};

export type PaymentAuthorizationInput = {
  eventId: string;
  railAuthorizationId: string;
  railCardId: string;
  amountCents: number;
  currency: string;
  merchantCategoryCode: string | null;
  merchantName: string | null;
  receivedAt: Date;
};

export type PaymentDecision = {
  authorizationId: string;
  approved: boolean;
  reasonCode: string;
  reason: string;
  mandateId: string | null;
  policyVersion: number | null;
  decidedAt: string;
  latencyMs: number;
};

export type RailCard = {
  railCardId: string;
  cardholderId: string;
  last4: string;
  brand: string;
  currency: string;
  status: "active" | "inactive";
};

export interface PaymentRail {
  readonly name: "mock" | "stripe" | "airwallex" | "nium";
  ensureCardholder(input: { organizationId: string; organizationName: string }): Promise<string>;
  createVirtualCard(input: {
    cardholderId: string;
    agentSlug: string;
    policyVersion: number;
    currency: "HKD" | "USD";
  }): Promise<RailCard>;
  updateCardControls(input: { railCardId: string; policyVersion: number }): Promise<void>;
  setCardStatus(input: { railCardId: string; status: "active" | "inactive" }): Promise<void>;
  verifyAuthorizationWebhook(payload: string, signature: string | null): unknown;
  parseAuthorizationRequest(event: unknown): PaymentAuthorizationInput | null;
  directDecisionBody(decision: PaymentDecision): { approved: boolean };
}
```

---

### Task 1: Baseline, worktree, and payment-rail decision record

**Files:**

- Create: `docs/decisions/0004-payment-rail.md`
- Create: `docs/superpowers/plans/2026-08-18-phase-3-scoped-payments.md` (this plan)
- Later worktree: `.worktrees/phase-3-scoped-payments`

**Interfaces:** Consumes the Phase 2 merge commit and its Neon project/role. Produces ADR-0004 and the execution branch name used by every later task.

- [ ] **Step 1: Verify the release prerequisite without changing anything.**

  Run from the root checkout:

  ```powershell
  git fetch origin --prune
  git merge-base --is-ancestor 5ce842410432e59c752b4686d581b0ed082198e6 origin/main
  if ($LASTEXITCODE -ne 0) { throw "Phase 2 is not merged into origin/main" }
  git show -s --format="%H %s" origin/main
  ```

  Expected: the ancestor command exits `0`; the displayed `origin/main` subject includes `fix: revalidate held approvals before authorization`. If the check fails, stop and report “blocked on Phase 2 merge”; do not create a Phase 3 worktree from an older commit.

- [ ] **Step 2: Create the isolated worktree after the baseline passes.**

  ```powershell
  git worktree add -b codex/phase-3-scoped-payments .worktrees/phase-3-scoped-payments origin/main
  git -C .worktrees/phase-3-scoped-payments status --short --branch
  git -C .worktrees/phase-3-scoped-payments log -1 --oneline
  ```

  Expected: a clean `codex/phase-3-scoped-payments` checkout whose HEAD is the verified Phase 2 ancestor.

- [ ] **Step 3: Record ADR-0004 using the current Neon architecture.**

  Write `docs/decisions/0004-payment-rail.md` with this content, replacing only the execution date and final commit SHA when the gate is actually completed:

  ```markdown
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
  ```

- [ ] **Step 4: Commit documentation only.**

  ```powershell
  git add docs/decisions/0004-payment-rail.md docs/superpowers/plans/2026-08-18-phase-3-scoped-payments.md
  git commit -m "docs: record scoped payment rail boundary"
  ```

  Expected: the commit contains no source, dependency, migration, provider, or environment change.

---

### Task 2: Neon payment schema, RLS, and migration contracts

**Files:**

- Modify: `src/db/schema.ts` — add `mandateKind`, `mandateStatus`, `walletCardStatus`, `paymentDecision`, `paymentAuthorizationStatus` enums and `mandates`, `walletCards`, `paymentAuthorizations` tables.
- Create: `drizzle/0006_scoped_payments.sql`
- Modify: `drizzle/meta/_journal.json` and the snapshot file generated by Drizzle Kit (do not hand-edit or invent the generated filename).
- Create: `tests/unit/payment-migration-contract.test.ts`
- Create: `tests/integration/postgres.payments.integration.test.ts`
- Modify: `scripts/run-db-tests.ts` to include the payment integration file in the serialized PG18 suite.

**Interfaces:** Consumes `organizations`, `agents`, `agent_keys`, `agent_policies`, `gateway_requests`, `agent_audit_logs`, and the existing RLS/helper functions. Produces typed Drizzle rows and SQL constraints used by Tasks 4–8.

- [ ] **Step 1: Write the static migration contract before the schema.**

  Add tests that read only `drizzle/0006_scoped_payments.sql` and the journal and assert the exact safety clauses:

  ```ts
  it("is additive and contains all payment tables", () => {
    expect(sql).toContain("CREATE TABLE \"mandates\"");
    expect(sql).toContain("CREATE TABLE \"wallet_cards\"");
    expect(sql).toContain("CREATE TABLE \"payment_authorizations\"");
    expect(sql).toContain("ALTER TABLE \"mandates\" FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE \"wallet_cards\" FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER TABLE \"payment_authorizations\" FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("UNIQUE(\"agent_id\", \"nonce\")");
    expect(sql).toContain("UNIQUE(\"rail\", \"rail_authorization_id\")");
    expect(sql).toContain("PAYMENT");
    expect(sql).not.toMatch(/supabase/i);
  });

  it("does not mutate 0000 through 0005", () => {
    expect(readFile("drizzle/0000_initial_schema.sql")).toBe(original0000);
    expect(readFile("drizzle/0005_approval_revalidation.sql")).toBe(original0005);
    expect(journalEntries.slice(0, 6).map((entry) => entry.tag)).toEqual([
      "0000_initial_schema", "0001_phase1_security_hardening", "0002_policy_gateway",
      "0003_gateway_auth_boundary", "0004_approval_operations", "0005_approval_revalidation",
    ]);
  });
  ```

  Run `bun x vitest run tests/unit/payment-migration-contract.test.ts`; expected RED is missing `0006` and its journal entry.

- [ ] **Step 2: Define the Drizzle table shape.**

  Add the following columns and constraints in `src/db/schema.ts`; use the existing `uuid`, `bigint`, `jsonb`, enum, composite FK, and tenant-index conventions already used by Phase 2:

  ```ts
  export const mandateKind = pgEnum("mandate_kind", ["intent", "cart"]);
  export const mandateStatus = pgEnum("mandate_status", ["active", "consumed", "revoked", "expired"]);
  export const walletCardStatus = pgEnum("wallet_card_status", ["provisioning", "active", "frozen", "canceled"]);
  export const paymentDecision = pgEnum("payment_decision", ["allow", "deny"]);
  export const paymentAuthorizationStatus = pgEnum("payment_authorization_status", ["pending", "approved", "declined", "reversed"]);

  export const mandates = pgTable("mandates", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    kind: mandateKind("kind").notNull(),
    version: integer("version").notNull().default(1),
    nonce: text("nonce").notNull(),
    agentDid: text("agent_did").notNull(),
    keyId: uuid("key_id").notNull(),
    keyThumbprint: text("key_thumbprint").notNull(),
    body: jsonb("body").$type<MandateBodyV1>().notNull(),
    signature: bytea("signature").notNull(),
    bodyDigest: bytea("body_digest").notNull(),
    currency: text("currency").notNull().default("HKD"),
    maxAmountCents: bigint("max_amount_cents", { mode: "number" }).notNull(),
    mccAllowlist: text("mcc_allowlist").array().notNull().default(sql`'{}'::text[]`),
    merchant: text("merchant"),
    parentMandateId: uuid("parent_mandate_id"),
    status: mandateStatus("status").notNull().default("active"),
    oneTime: boolean("one_time").notNull().default(false),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  }, (table) => ({
    agentTenantFk: foreignKey({ columns: [table.agentId, table.organizationId], foreignColumns: [agents.id, agents.organizationId] }),
    keyTenantFk: foreignKey({ columns: [table.keyId, table.agentId, table.organizationId], foreignColumns: [agentKeys.id, agentKeys.agentId, agentKeys.organizationId] }),
    parentTenantFk: foreignKey({ columns: [table.parentMandateId, table.agentId, table.organizationId], foreignColumns: [table.id, table.agentId, table.organizationId] }),
    agentNonceUnique: unique().on(table.agentId, table.nonce),
    activeAgentIdx: index().on(table.organizationId, table.agentId, table.status, table.expiresAt),
  }));

  export const walletCards = pgTable("wallet_cards", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    rail: text("rail").notNull(),
    railCardholderId: text("rail_cardholder_id").notNull(),
    railCardId: text("rail_card_id").notNull(),
    last4: text("last4").notNull(),
    brand: text("brand").notNull(),
    currency: text("currency").notNull(),
    status: walletCardStatus("status").notNull().default("provisioning"),
    policyVersion: integer("policy_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  }, (table) => ({
    agentTenantFk: foreignKey({ columns: [table.agentId, table.organizationId], foreignColumns: [agents.id, agents.organizationId] }),
    agentUnique: unique().on(table.organizationId, table.agentId),
    railCardUnique: unique().on(table.rail, table.railCardId),
  }));

  export const paymentAuthorizations = pgTable("payment_authorizations", {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    walletCardId: uuid("wallet_card_id").notNull(),
    rail: text("rail").notNull(),
    eventId: text("event_id").notNull(),
    railAuthorizationId: text("rail_authorization_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    merchantCategoryCode: text("merchant_category_code"),
    merchantName: text("merchant_name"),
    mandateId: uuid("mandate_id"),
    decision: paymentDecision("decision").notNull(),
    status: paymentAuthorizationStatus("status").notNull(),
    reasonCode: text("reason_code").notNull(),
    reason: text("reason").notNull(),
    policyVersion: integer("policy_version"),
    latencyMs: integer("latency_ms").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
  }, (table) => ({
    cardTenantFk: foreignKey({ columns: [table.walletCardId, table.agentId, table.organizationId], foreignColumns: [walletCards.id, walletCards.agentId, walletCards.organizationId] }),
    agentTenantFk: foreignKey({ columns: [table.agentId, table.organizationId], foreignColumns: [agents.id, agents.organizationId] }),
    mandateTenantFk: foreignKey({ columns: [table.mandateId, table.agentId, table.organizationId], foreignColumns: [mandates.id, mandates.agentId, mandates.organizationId] }),
    eventUnique: unique().on(table.rail, table.eventId),
    authorizationUnique: unique().on(table.rail, table.railAuthorizationId),
    spendIdx: index().on(table.organizationId, table.agentId, table.decidedAt),
  }));
  ```

  Use `mode: "number"` only after the same `Number.isSafeInteger` bounds used by Phase 2; PostgreSQL `bigint` remains the storage type.

- [ ] **Step 3: Generate and review the additive SQL.**

  ```powershell
  bun x drizzle-kit generate --name=scoped_payments
  bun run db:check
  ```

  Review `drizzle/0006_scoped_payments.sql` and add reviewed SQL for:

  - `CHECK` constraints: HKD mandate currency, positive safe cents, `expires_at > issued_at`, 4-digit MCC values, no card secret columns, `payment_authorizations.decision='allow'` iff status is `approved`, and `latency_ms >= 0`.
  - Composite tenant FKs and unique `(rail,event_id)` / `(rail,rail_authorization_id)` idempotency keys.
  - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY; ALTER TABLE ... FORCE ROW LEVEL SECURITY;` for all three tables.
  - Member read policies for owner/admin/viewer and owner/admin mutation policies for cards/mandates; payment authorization inserts/updates only through reviewed `SECURITY DEFINER` functions.
  - A narrow `hermes_payment_spend_totals(agent, org, day_start, month_start)` `SECURITY DEFINER` function that sums only approved payment authorizations plus existing allowed gateway requests and returns cents, with `SET search_path = pg_catalog, public, pg_temp` and fully qualified public relations.
  - An append-only trigger for `mandates`, `wallet_cards`, and `payment_authorizations` identity fields; ordinary `UPDATE`/`DELETE` must fail. Audit rows are written by the service/function that performs the state change.

- [ ] **Step 4: Run the static contract to verify the expected GREEN.**

  ```powershell
  bun x vitest run tests/unit/payment-migration-contract.test.ts
  ```

  Expected: all migration/journal/constraint tests pass and `bun run db:check` prints `Everything's fine`.

- [ ] **Step 5: Add the PG18 integration RED cases before implementation helpers.**

  The test file must exercise a fresh database and an upgrade database and contain these exact assertions:

  ```ts
  it("denies cross-tenant mandate/card/payment rows", async () => {
    await expect(insertMandate({ organizationId: otherOrg, agentId: localAgent })).rejects.toMatchObject({ code: "23503" });
    await expect(asViewer(localUser).insertWalletCard(otherOrgCard)).rejects.toMatchObject({ code: "42501" });
  });

  it("deduplicates the same rail event and rejects different bytes", async () => {
    const first = await recordPaymentAuthorization(samplePayment);
    const replay = await recordPaymentAuthorization(samplePayment);
    expect(replay.id).toBe(first.id);
    await expect(recordPaymentAuthorization({ ...samplePayment, amountCents: 999 })).rejects.toMatchObject({ code: "23505" });
  });

  it("sums payment and gateway spend in Asia/Hong_Kong windows", async () => {
    expect(await readSpendTotals(agentId, orgId, hongKongDayStart, hongKongMonthStart)).toEqual({ spentTodayCents: 6000, spentMonthCents: 9000 });
  });
  ```

  Run with a disposable PostgreSQL 18 URL already exported by the test harness: `if (-not $env:DATABASE_URL_TEST) { throw "DATABASE_URL_TEST is required" }; $env:DB_INTEGRATION_REQUIRED = "1"; bun x vitest run tests/integration/postgres.payments.integration.test.ts --maxWorkers=1 --fileParallelism=false`. Expected RED is missing tables/functions.

- [ ] **Step 6: Implement the transaction functions and RLS, then rerun PG18.**

  Add `src/lib/payments/postgres-store.ts` with `withPaymentTransaction`, `recordPaymentAuthorization`, `readPaymentSpendTotals`, and `lockPaymentAgent`. The service must set the verified user/agent claim before tenant reads and must acquire the same `hermes.agent:` advisory-lock namespace used by gateway and approval paths, concatenated with the agent UUID.

  Expected: fresh/upgrade migration, RLS, idempotency, cross-tenant, spend-window, append-only, and rollback tests pass; no existing `0000`–`0005` file changes.

- [ ] **Step 7: Commit the database slice.**

  ```powershell
  git add src/db/schema.ts drizzle/0006_scoped_payments.sql drizzle/meta tests/unit/payment-migration-contract.test.ts tests/integration/postgres.payments.integration.test.ts scripts/run-db-tests.ts
  git commit -m "feat(db): add Neon mandate card and payment authorization tables"
  ```

---

### Task 3: Pure signed mandates and payment-policy adapter

**Files:**

- Create: `src/lib/payments/mandates.ts`
- Create: `src/lib/payments/types.ts`
- Create: `src/lib/payments/policy-adapter.ts`
- Create: `tests/unit/payment-mandates.test.ts`
- Create: `tests/unit/payment-policy-adapter.test.ts`

**Interfaces:** Consumes Phase 2 `canonicalize`, `verifyGatewaySignature` primitives, policy result types, and the schema DTOs. Produces `canonicalMandateBytes`, `verifyMandate`, `mandateMatchesCharge`, `toPaymentPolicyAction`, and `paymentDecisionFromPolicy` with no database, network, or React imports.

- [ ] **Step 1: Write the failing canonicalization/signature tests.**

  ```ts
  const BODY: MandateBodyV1 = {
    version: "1",
    mandateId: "4c0c7b5b-5d2e-4e56-a03a-4cbf2464e6bc",
    agentDid: "did:web:hermespass.asia:agent:demo-agent",
    keyId: "fbb9a6a1-2d6b-4f4c-8c29-6c7c4f0a54dd",
    kind: "intent",
    nonce: "7d5b9d85-f7c8-4b94-9610-1a5c4e6a8d60",
    issuedAt: "2026-08-18T01:00:00.000Z",
    parentMandateId: null,
    constraints: {
      currency: "HKD", maxAmountCents: 50000, merchant: "AWS",
      mccAllowlist: ["5734", "7372"], expiresAt: "2026-09-18T01:00:00.000Z", oneTime: false,
    },
  };

  it("uses RFC 8785 bytes independent of object insertion order", () => {
    const reordered = { constraints: BODY.constraints, nonce: BODY.nonce, version: BODY.version, parentMandateId: null, kind: BODY.kind, keyId: BODY.keyId, agentDid: BODY.agentDid, issuedAt: BODY.issuedAt, mandateId: BODY.mandateId } satisfies MandateBodyV1;
    expect(Buffer.from(canonicalMandateBytes(BODY))).toEqual(Buffer.from(canonicalMandateBytes(reordered)));
  });

  it("accepts the active external key and rejects tamper, wrong key, expired, and wrong agent", () => {
    const signed = signFixture(BODY);
    expect(verifyMandate(signed, fixtureKey(BODY.keyId), new Date("2026-08-19T00:00:00Z"))).toEqual({ valid: true });
    expect(verifyMandate({ ...signed, body: { ...BODY, nonce: crypto.randomUUID() } }, fixtureKey(BODY.keyId), now)).toMatchObject({ valid: false, reasonCode: "MANDATE_SIGNATURE_INVALID" });
    expect(verifyMandate(signed, fixtureKey(crypto.randomUUID()), now)).toMatchObject({ valid: false, reasonCode: "MANDATE_KEY_MISMATCH" });
    expect(verifyMandate(signed, fixtureKey(BODY.keyId), new Date("2026-10-01T00:00:00Z"))).toMatchObject({ valid: false, reasonCode: "MANDATE_EXPIRED" });
  });
  ```

  Run `bun x vitest run tests/unit/payment-mandates.test.ts`; expected RED is missing `src/lib/payments/mandates.ts`.

- [ ] **Step 2: Implement canonical bytes and strict verification.**

  Use `canonicalize(body)` and UTF-8 bytes; never use `JSON.stringify` for a signature. Enforce:

  ```ts
  export function canonicalMandateBytes(body: MandateBodyV1): Uint8Array {
    const json = canonicalize(body);
    if (json === undefined) throw new PaymentInputError("MANDATE_NOT_CANONICAL");
    return new TextEncoder().encode(json);
  }

  export function verifyMandate(
    signed: SignedMandateV1,
    key: { id: string; agentId: string; agentDid: string; publicJwk: JsonWebKey; status: "active" | "revoked"; custody: "external" | "legacy_encrypted" },
    now: Date,
  ): { valid: true } | { valid: false; reasonCode: string } {
    if (key.custody !== "external" || key.status !== "active") return { valid: false, reasonCode: "MANDATE_KEY_INACTIVE" };
    if (signed.body.keyId !== key.id || signed.body.agentDid !== key.agentDid) return { valid: false, reasonCode: "MANDATE_KEY_MISMATCH" };
    if (new Date(signed.body.issuedAt).getTime() > now.getTime() || new Date(signed.body.constraints.expiresAt).getTime() <= now.getTime()) return { valid: false, reasonCode: "MANDATE_EXPIRED" };
    try {
      const signature = b64uToBytes(signed.signature);
      const publicKey = b64uToBytes(String((key.publicJwk as { x?: unknown }).x));
      if (!ed25519.verify(signature, canonicalMandateBytes(signed.body), publicKey)) return { valid: false, reasonCode: "MANDATE_SIGNATURE_INVALID" };
      return { valid: true };
    } catch { return { valid: false, reasonCode: "MANDATE_SIGNATURE_INVALID" }; }
  }
  ```

  The submitted body carries `keyId`; the server obtains the public JWK from Neon and does not accept a browser-supplied public key. Use unpadded base64url signatures and reject malformed UTF-8/JSON before verification.

- [ ] **Step 3: Add charge matching and policy translation tests.**

  ```ts
  it.each([
    ["amount", { amountCents: 50001, currency: "HKD" }, "MANDATE_AMOUNT_EXCEEDED"],
    ["merchant", { amountCents: 1000, currency: "HKD", merchantName: "Other" }, "MANDATE_MERCHANT_MISMATCH"],
    ["mcc", { amountCents: 1000, currency: "HKD", merchantCategoryCode: "7995" }, "MANDATE_MCC_MISMATCH"],
    ["currency", { amountCents: 1000, currency: "USD" }, "RAIL_CURRENCY_UNSUPPORTED"],
  ])("rejects %s", (_label, charge, reasonCode) => {
    expect(mandateMatchesCharge(BODY.constraints, { ...charge, at: new Date("2026-08-19T00:00:00Z") })).toMatchObject({ matches: false, reasonCode });
  });

  it("maps payment spend to the existing checkout.external policy tool", () => {
    expect(toPaymentPolicyAction({ agentDid: BODY.agentDid, amountCents: 1200, currency: "HKD", merchantCategoryCode: "5734", merchantName: "AWS", nonce: "payment-1", timestamp: BODY.issuedAt })).toMatchObject({ tool: "checkout.external", amountCents: 1200, currency: "HKD", merchantCategoryCode: "5734" });
  });

  it("turns policy hold into synchronous deny", () => {
    expect(paymentDecisionFromPolicy({ decision: "hold", reasonCode: "APPROVAL_REQUIRED", reason: "review", policyVersion: 3 })).toMatchObject({ approved: false, reasonCode: "PAYMENT_REQUIRES_PREAUTHORIZATION" });
  });
  ```

- [ ] **Step 4: Implement the pure adapter.**

  `mandateMatchesCharge` checks currency, expiry, max amount, merchant, MCC, and one-time semantics. `toPaymentPolicyAction` uses `tool: "checkout.external"` so the current scope union remains unchanged. `paymentDecisionFromPolicy` preserves allow/deny reasons and maps hold/high-risk to a deterministic deny; it never calls the database.

- [ ] **Step 5: Run the focused unit suites and commit.**

  ```powershell
  bun x vitest run tests/unit/payment-mandates.test.ts tests/unit/payment-policy-adapter.test.ts
  git add src/lib/payments/mandates.ts src/lib/payments/types.ts src/lib/payments/policy-adapter.ts tests/unit/payment-mandates.test.ts tests/unit/payment-policy-adapter.test.ts
  git commit -m "feat(payments): add signed mandate and policy adapter primitives"
  ```

  Expected: all pure tests pass without a database URL or provider secret.

---

### Task 4: Mandate issuance, listing, and revocation APIs

**Files:**

- Create: `src/app/api/mandates/route.ts`
- Create: `src/app/api/mandates/[id]/revoke/route.ts`
- Create: `src/lib/payments/mandate-service.ts`
- Create: `src/lib/payments/mandate-client.ts`
- Create: `scripts/payment-mandate.ts`
- Create: `tests/unit/payment-mandate-api.test.ts`
- Create: `tests/integration/postgres.mandates.integration.test.ts`

**Interfaces:** Consumes the pure mandate module, `lookupAuthContext`/signature claim boundaries, `withActorTransaction`, `requestId`/`errorResponse`, and the `mandates` table. Produces `{ data: { mandate } }` success envelopes and `{ error: { code, message, requestId, fieldErrors? } }` failures.

- [ ] **Step 1: Write route contract tests first.**

  Tests must cover: body over 16 KiB → `413 REQUEST_TOO_LARGE`; invalid shape → `400 VALIDATION_ERROR`; unknown/bad key/signature → `401 AGENT_AUTH_FAILED`; inactive key/passport → `401 AGENT_AUTH_FAILED`; duplicate nonce with identical bytes → stored mandate; duplicate nonce with different bytes → `409 NONCE_CONFLICT`; invalid parent or wrong tenant → `409 MANDATE_PARENT_INVALID`; viewer dashboard mutation → `403 FORBIDDEN`; revoke is idempotent for the same mandate.

  ```ts
  it("returns the standard error envelope and request id", async () => {
    const response = await POST(jsonRequest("/api/mandates", { body: { version: "1" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR", requestId: expect.any(String) } });
  });

  it("does not expose the submitted signature or raw body in a public DTO", async () => {
    const response = await POST(agentSignedMandateRequest());
    const json = await response.json();
    expect(json.data.mandate).not.toHaveProperty("signature");
    expect(json.data.mandate).not.toHaveProperty("body");
    expect(json.data.mandate).toMatchObject({ kind: "intent", status: "active", currency: "HKD" });
  });
  ```

- [ ] **Step 2: Implement the server service with one transaction.**

  `issueMandate(signed: SignedMandateV1)` must:

  1. validate the safe schema and request byte limit;
  2. look up the DID/key through the existing signature-authenticated Neon boundary;
  3. verify the Ed25519 proof and current passport/key lifecycle;
  4. lock the agent before checking nonce/parent rows;
  5. insert only safe constraint columns plus `bodyDigest`/signature digest;
  6. append `mandate.issued` with no merchant raw payload beyond the bounded safe merchant label;
  7. return a DTO without signature, public JWK, private material, or raw body.

  Cart mandates require an active same-agent intent parent and may set `oneTime: true`; intent mandates may be reusable until expiry. `revokeMandate` locks the agent, marks active rows revoked, appends `mandate.revoked`, and returns the existing state on replay.

- [ ] **Step 3: Implement the routes.**

  `POST /api/mandates` accepts `SignedMandateV1`; `GET /api/mandates` uses the signed-in actor to list safe rows for the organization; `POST /api/mandates/[id]/revoke` requires owner/admin and a UUID route parameter. Every route calls `requestId(request)` and `errorResponse` for failures. Never return Drizzle errors or encrypted fields.

- [ ] **Step 4: Add the external-agent CLI without printing private material.**

  `scripts/payment-mandate.ts` accepts `--private-jwk C:\secure\hermespass\agent.jwk --agent-did did:web:hermespass.asia:agent:demo-agent --key-id 4c0c7b5b-5d2e-4e56-a03a-4cbf2464e6bc --max-cents 50000 --merchant AWS`; it reads the JWK from a path outside the repository, signs canonical bytes, posts to `APP_BASE_URL/api/mandates`, and prints only HTTP status, mandate ID, and reason code. It must refuse a path under the repository and must never log the JWK, signature, or response body.

- [ ] **Step 5: Verify API and database behavior.**

  ```powershell
  bun x vitest run tests/unit/payment-mandate-api.test.ts tests/integration/postgres.mandates.integration.test.ts --maxWorkers=1 --fileParallelism=false
  ```

  Expected: route envelope, replay, nonce conflict, parent isolation, revocation idempotency, RLS, and audit-chain assertions pass against local PG18. `GET /api/mandates` returns only safe organization rows.

- [ ] **Step 6: Commit the mandate slice.**

  ```powershell
  git add src/app/api/mandates src/lib/payments/mandate-service.ts src/lib/payments/mandate-client.ts scripts/payment-mandate.ts tests/unit/payment-mandate-api.test.ts tests/integration/postgres.mandates.integration.test.ts
  git commit -m "feat(payments): issue and revoke signed mandates on Neon"
  ```

---

### Task 5: PaymentRail interface, deterministic mock, and Stripe test adapter

**Files:**

- Modify: `package.json`, `bun.lock` — add exact `stripe@22.5.0`.
- Create: `src/lib/payments/rails/types.ts`
- Create: `src/lib/payments/rails/mock.ts`
- Create: `src/lib/payments/rails/stripe.ts`
- Create: `src/lib/payments/rails/index.ts`
- Create: `src/lib/payments/rail-config.ts`
- Create: `tests/unit/payment-rail.test.ts`
- Create: `scripts/payment-rail-gate.ts`

**Interfaces:** Consumes `PaymentRail` types from this plan and mandate/policy DTOs. Produces `activePaymentRail()` and provider-specific card/webhook behavior while keeping all Stripe imports inside `src/lib/payments/rails/stripe.ts`.

- [ ] **Step 1: Add the exact server dependency and config contract.**

  ```powershell
  bun add --exact stripe@22.5.0
  ```

  `src/lib/payments/rail-config.ts` must parse:

  ```ts
  export const paymentRailName = z.enum(["mock", "stripe", "airwallex", "nium"]);
  export function configuredPaymentRail(): "mock" | "stripe" | "airwallex" | "nium" {
    return paymentRailName.parse(process.env.PAYMENT_RAIL ?? "stripe");
  }
  export function requireStripeTestKey(): string {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key || !key.startsWith("sk_test_")) throw new Error("PAYMENT_RAIL_TEST_KEY_REQUIRED");
    return key;
  }
  ```

  `STRIPE_API_VERSION` is fixed in code to `2026-03-25.dahlia` for the pinned Stripe SDK; there is no unpinned runtime fallback. `STRIPE_ISSUING_WEBHOOK_SECRET` is required only by the Stripe adapter.

- [ ] **Step 2: Write the rail safety tests before adapters.**

  ```ts
  it("rejects live Stripe keys before constructing the SDK", async () => {
    process.env.PAYMENT_RAIL = "stripe";
    process.env.STRIPE_SECRET_KEY = "sk_live_never-use";
    await expect(activePaymentRail().ensureCardholder({ organizationId: crypto.randomUUID(), organizationName: "Test Org" })).rejects.toThrow("PAYMENT_RAIL_TEST_KEY_REQUIRED");
  });

  it("mock rail creates deterministic non-secret card metadata", async () => {
    const card = await mockRail.createVirtualCard({ cardholderId: "mock-org", agentSlug: "demo-agent", policyVersion: 1, currency: "HKD" });
    expect(card).toMatchObject({ railCardId: "mock_card_demo-agent", last4: "4242", currency: "HKD", status: "active" });
    expect(card).not.toHaveProperty("number");
    expect(card).not.toHaveProperty("cvc");
  });

  it("does not silently activate Airwallex or Nium", () => {
    process.env.PAYMENT_RAIL = "airwallex";
    expect(() => activePaymentRail()).toThrow("PAYMENT_RAIL_PROVIDER_DISABLED");
  });
  ```

- [ ] **Step 3: Implement `MockPaymentRail`.**

  It must be deterministic, in-memory, HKD-only, and test-only. `ensureCardholder` returns `mock_cardholder_` concatenated with the organization UUID; card IDs are derived from the agent slug; `verifyAuthorizationWebhook` parses the test event envelope only; `directDecisionBody` returns `{ approved: decision.approved }`.

- [ ] **Step 4: Implement the Stripe test adapter.**

  Add `import "server-only"` and construct `new Stripe(requireStripeTestKey(), { apiVersion: "2026-03-25.dahlia" })` only inside request-time functions. Implement cardholder/card creation with no PAN/CVC expansion and only safe metadata (`organization_id`, `agent_slug`, `policy_version`). Configure card-side spending limits only when the requested rail currency is supported; do not convert HKD to USD. Parse the raw `issuing_authorization.request` event and return its event ID, card ID, amount, currency, MCC, and bounded merchant name only.

  Use Stripe's direct synchronous response body rather than approve/decline API calls. The route will set `Stripe-Version: 2026-03-25.dahlia` and `Content-Type: application/json`; the adapter never logs secrets or raw events.

- [ ] **Step 5: Add the rail gate script and run focused checks.**

  `scripts/payment-rail-gate.ts` sets a synthetic `sk_live_` only inside the process, calls the rail factory, and prints the fixed error code. It must not call Stripe or print environment values.

  ```powershell
  bun x vitest run tests/unit/payment-rail.test.ts
  bun run scripts/payment-rail-gate.ts
  ```

  Expected: all tests pass and the script prints `PAYMENT_RAIL_TEST_KEY_REQUIRED`; no network call occurs.

- [ ] **Step 6: Commit the adapter slice.**

  ```powershell
  git add package.json bun.lock src/lib/payments/rails src/lib/payments/rail-config.ts tests/unit/payment-rail.test.ts scripts/payment-rail-gate.ts
  git commit -m "feat(payments): add sandbox payment rail adapters"
  ```

---

### Task 6: Card provisioning APIs and live Wallets dashboard

**Files:**

- Create: `src/lib/payments/card-service.ts`
- Create: `src/app/api/wallets/route.ts`
- Create: `src/app/api/wallets/[id]/status/route.ts`
- Create: `src/lib/payments/wallets-client.ts`
- Modify: `src/components/hermes/dashboard/wallets-client.tsx`
- Modify: `src/components/hermes/dashboard/dashboard-overview-client.tsx`
- Modify: `src/components/hermes/app-shell.tsx` and `src/components/hermes/dashboard/approvals-client.tsx` only where they still read `useHermes()`.
- Create: `src/lib/hermes-constants.ts` for retained static MCC/tool/format constants.
- Modify: `src/app/providers.tsx`; remove `HermesProvider` after every caller is migrated.
- Delete: `src/lib/hermes-store.tsx`, `src/lib/hermes-data.ts` after the import graph is empty.
- Create: `tests/unit/payment-card-service.test.tsx`
- Modify: `tests/integration/postgres.payments.integration.test.ts`

**Interfaces:** Consumes `PaymentRail`, `walletCards`, `agents`, active policy DTOs, `useAgents`, and actor authorization. Produces idempotent card provisioning, status controls, and React Query hooks `useWalletCards`, `useProvisionCard`, `useSetWalletStatus`.

- [ ] **Step 1: Write the API and UI failing tests.**

  ```ts
  it("requires owner/admin and an active policy", async () => {
    await expect(provisionCard(viewerActor, agentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(provisionCard(adminActor, agentWithoutPolicy)).rejects.toMatchObject({ code: "POLICY_REQUIRED" });
  });

  it("is idempotent across concurrent provisioning requests", async () => {
    const [first, second] = await Promise.all([provisionCard(ownerActor, agentId), provisionCard(ownerActor, agentId)]);
    expect(new Set([first.card.id, second.card.id]).size).toBe(1);
    expect(mockRail.createCalls).toBe(1);
  });

  it("renders live card metadata and a provisioning action without PAN/CVC", async () => {
    render(<WalletsClient />, { actor: ownerActor, queryData: seededWalletQuery });
    expect(await screen.findByText("•••• 4242")).toBeInTheDocument();
    expect(screen.queryByText(/cvc|pan|full card number/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Provision card" }));
    expect(await screen.findByText(/provisioning/i)).toBeInTheDocument();
  });
  ```

  Run `bun x vitest run tests/unit/payment-card-service.test.tsx`; expected RED is missing the live card service/hooks.

- [ ] **Step 2: Implement two-phase idempotent provisioning.**

  `provisionCard(actor, agentId)` must:

  1. `assertCanMutate(actor)` and validate UUID;
  2. open a Neon transaction, lock the agent, verify the organization, active passport, active policy, and absence of a non-canceled card;
  3. insert a `provisioning` reservation with `policyVersion` and a deterministic idempotency key; commit before any rail network call;
  4. call `ensureCardholder` and `createVirtualCard` outside the database transaction;
  5. finalize the same row in a second transaction, append `wallet.card_provisioned`, and invalidate card/policy/agent queries;
  6. on rail failure, mark the reservation canceled with a safe `RAIL_PROVISION_FAILED` reason and leave no active card;
  7. on a retry, return the existing active/provisioning row rather than creating a second card.

  The database row stores only `railCardId`, cardholder ID, brand, last four, currency, status, and policy version. A status change locks the row and agent, calls `setCardStatus` only after authorization, updates `active`/`frozen`, and appends `wallet.card_frozen` or `wallet.card_unfrozen`.

- [ ] **Step 3: Add the protected routes.**

  `POST /api/wallets` accepts `{ agentId }`; `GET /api/wallets` lists safe rows for the current organization; `POST /api/wallets/[id]/status` accepts `{ status: "active" | "frozen" }`. Use the standard request ID/error envelope, 16 KiB body limit, UUID validation, owner/admin mutation gate, and no raw rail errors.

- [ ] **Step 4: Replace mock reads with React Query.**

  `src/lib/payments/wallets-client.ts` must query `/api/wallets`, `/api/agents`, and `/api/agents/:id/policy` using query keys `payment-wallets`, `agents`, and `agent-policy`. `WalletsClient` maps `last4`, `brand`, `rail`, `currency`, `policyVersion`, and status; spend-to-date remains `—` until Task 7 supplies the payment aggregate. Cap edits remain in the existing policy dialog. Dashboard overview consumes live card/payment aggregates, not `wallets` from a context.

- [ ] **Step 5: Retire the Hermes mock store only after graph verification.**

  Use the code graph to trace `useHermes` callers. Migrate `WalletsClient`, `DashboardOverviewClient`, `AppShell`, and `ApprovalsClient` to live hooks or constants. Copy only static `MCC_CATEGORIES`, `TOOL_SCOPES`, `formatHKD`, and `DECISION_TREND` to `src/lib/hermes-constants.ts`; do not copy mock events, wallets, approvals, streams, or mutation functions. Confirm:

  ```powershell
  rg -n "hermes-store|hermes-data|useHermes|HermesProvider" src tests
  ```

  Expected: no matches after deleting the two mock files and removing `HermesProvider` from `Providers`.

- [ ] **Step 6: Run card/database/dashboard checks and commit.**

  ```powershell
  bun x vitest run tests/unit/payment-card-service.test.tsx tests/integration/postgres.payments.integration.test.ts --maxWorkers=1 --fileParallelism=false
  bun run typecheck
  bun run lint
  git add src/app/api/wallets src/lib/payments src/components/hermes/dashboard src/components/hermes/app-shell.tsx src/app/providers.tsx src/lib/hermes-constants.ts tests/unit/payment-card-service.test.tsx tests/integration/postgres.payments.integration.test.ts
  git rm src/lib/hermes-store.tsx src/lib/hermes-data.ts
  git commit -m "feat(payments): provision scoped cards and make Wallets live"
  ```

---

### Task 7: Synchronous payment authorization, audit, and reconciliation

**Files:**

- Create: `src/lib/payments/authorization-service.ts`
- Create: `src/lib/payments/authorization-store.ts`
- Create: `src/app/api/webhooks/issuing/route.ts`
- Create: `src/app/api/webhooks/issuing/events/route.ts`
- Create: `tests/unit/payment-authorization.test.ts`
- Create: `tests/unit/issuing-webhook-route.test.ts`
- Create: `tests/integration/postgres.payment-authorization.integration.test.ts`
- Modify: `src/lib/audit/service.ts` only for safe payment event DTO fields.

**Interfaces:** Consumes `PaymentRail`, `mandateMatchesCharge`, `evaluateGatewayPolicy`, `readPaymentSpendTotals`, `lockPaymentAgent`, and audit append helpers. Produces `authorizePayment(input, store): Promise<PaymentDecision>` and raw-body webhook routes with idempotent allow/deny behavior.

- [ ] **Step 1: Write the pure authorization decision tests.**

  ```ts
  it.each([
    ["unknown card", "CARD_NOT_FOUND"],
    ["frozen card", "CARD_INACTIVE"],
    ["inactive agent", "AGENT_INACTIVE"],
    ["no mandate", "MANDATE_REQUIRED"],
    ["wrong currency", "RAIL_CURRENCY_UNSUPPORTED"],
    ["over mandate", "MANDATE_AMOUNT_EXCEEDED"],
    ["policy cap", "POLICY_TRANSACTION_LIMIT"],
    ["daily cap", "POLICY_DAILY_LIMIT"],
    ["hold", "PAYMENT_REQUIRES_PREAUTHORIZATION"],
  ])("fails closed for %s", async (_label, reasonCode) => {
    const result = await authorizePayment(fixtureInputFor(reasonCode), fixtureStore);
    expect(result).toMatchObject({ approved: false, reasonCode });
  });

  it("allows one matching HKD charge and consumes a one-time cart mandate", async () => {
    const result = await authorizePayment(matchingFixture, fixtureStore);
    expect(result).toMatchObject({ approved: true, reasonCode: "PAYMENT_ALLOWED", mandateId: matchingFixture.mandateId });
    expect(fixtureStore.auditActions).toEqual(["payment.authorization"]);
    expect(fixtureStore.mandateStatus).toBe("consumed");
  });

  it("never returns hold to a card network", async () => {
    const result = await authorizePayment(highRiskFixture, fixtureStore);
    expect(result.approved).toBe(false);
    expect(result.reasonCode).toBe("PAYMENT_REQUIRES_PREAUTHORIZATION");
  });
  ```

  Run `bun x vitest run tests/unit/payment-authorization.test.ts`; expected RED is the missing service/store.

- [ ] **Step 2: Implement the authorization transaction in the required order.**

  `authorizePayment` must run inside one Neon transaction:

  1. capture a database receipt time and reject malformed/unsupported input;
  2. lock the card/agent with the existing per-agent advisory lock;
  3. replay by `(rail,event_id)` or `(rail,rail_authorization_id)` before creating any audit/spend row; identical bytes return the stored decision and different bytes return `409 PAYMENT_EVENT_CONFLICT` at the route;
  4. verify card status, agent status, passport expiry, and active external key/history; no private key is decrypted;
  5. select the active same-agent mandate with `FOR UPDATE` only when `oneTime=true`, then run `mandateMatchesCharge`;
  6. read combined HKD spend totals from the narrow SQL function and call `evaluateGatewayPolicy` through `toPaymentPolicyAction`;
  7. map `allow` to approved, `deny` to declined, and `hold`/high-risk to declined `PAYMENT_REQUIRES_PREAUTHORIZATION`;
  8. insert the safe payment authorization, consume one-time mandate if approved, and append exactly one `payment.authorization` audit event containing IDs, digests, safe MCC, policy version, reason code, and latency;
  9. return a DTO with no merchant payload, card number, JWK, or raw event.

  The transaction must use `pg_advisory_xact_lock(hashtextextended('hermes.agent:' || agentId, 0))` before any spend read or mandate consumption. No Stripe/Airwallex/Nium call is permitted in this function.

- [ ] **Step 3: Implement raw-body Stripe webhook handling.**

  `POST /api/webhooks/issuing` reads `await request.text()` exactly once, verifies `stripe-signature` through the active rail, and never calls `request.json()`. Invalid signature returns `400 WEBHOOK_SIGNATURE_INVALID`; non-authorization events return `200 { received: true }`; an authorization request returns HTTP `200` with:

  ```json
  { "approved": true }
  ```

  plus `Stripe-Version: 2026-03-25.dahlia`. The route catches service errors and returns `{ approved: false }` for safe declines, but returns `500` only for an unavailable database/configuration state so Stripe's timeout behavior remains observable. The direct response contains no human reason because Stripe only accepts the approved boolean; the reason is retained in Neon/audit.

  `POST /api/webhooks/issuing/events` handles `issuing_authorization.created`, `issuing_authorization.updated`, and `issuing_transaction.created` asynchronously. It stores only event ID, authorization ID, status, amount/currency, and timestamps; reversals update `payment_authorizations.status = 'reversed'` and append `payment.authorization_reversed` idempotently.

- [ ] **Step 4: Add live PG18 race/rollback tests.**

  ```ts
  it("allows only one concurrent request through a daily cap", async () => {
    const results = await Promise.all(Array.from({ length: 2 }, (_, i) => authorizeInDatabase({ eventId: `evt-${i}`, amountCents: 6000 })));
    expect(results.filter((result) => result.approved)).toHaveLength(1);
  });

  it("replays a payment event without duplicate audit or spend", async () => {
    const first = await authorizeInDatabase(matchingInput);
    const replay = await authorizeInDatabase(matchingInput);
    expect(replay).toEqual(first);
    expect(await countAudits("payment.authorization", matchingInput.railAuthorizationId)).toBe(1);
  });

  it("rolls back mandate consumption and payment row when audit append fails", async () => {
    await expect(authorizeWithInjectedAuditFailure(matchingInput)).rejects.toThrow();
    expect(await readMandateStatus(matchingInput.mandateId)).toBe("active");
    expect(await findPayment(matchingInput.railAuthorizationId)).toBeNull();
  });

  it("measures the local decision path below the application budget", async () => {
    const result = await authorizeInDatabase(matchingInput);
    expect(result.latencyMs).toBeLessThan(1500);
  });
  ```

- [ ] **Step 5: Run focused unit/PG18 gates and commit.**

  ```powershell
  bun x vitest run tests/unit/payment-authorization.test.ts tests/unit/issuing-webhook-route.test.ts
  if (-not $env:DATABASE_URL_TEST) { throw "DATABASE_URL_TEST is required" }; $env:DB_INTEGRATION_REQUIRED = "1"; bun x vitest run tests/integration/postgres.payment-authorization.integration.test.ts --maxWorkers=1 --fileParallelism=false
  git add src/lib/payments/authorization-service.ts src/lib/payments/authorization-store.ts src/app/api/webhooks/issuing tests/unit/payment-authorization.test.ts tests/unit/issuing-webhook-route.test.ts tests/integration/postgres.payment-authorization.integration.test.ts src/lib/audit/service.ts
  git commit -m "feat(payments): authorize scoped card requests synchronously"
  ```

  Expected: duplicate events have one audit row, cross-tenant rows are invisible, cap races serialize, non-HKD/frozen/revoked/expired cases decline, and local latency stays below 1.5 seconds.

---

### Task 8: Payment read models, dashboard activity, and retained mock boundaries

**Files:**

- Create: `src/app/api/payment-authorizations/route.ts`
- Create: `src/lib/payments/authorizations-client.ts`
- Modify: `src/components/hermes/dashboard/wallets-client.tsx`
- Modify: `src/components/hermes/dashboard/dashboard-overview-client.tsx`
- Modify: `src/components/hermes/dashboard/compliance-client.tsx`
- Modify: `src/lib/agents/client.ts` or add `src/lib/payments/client.ts` for query invalidation.
- Create: `tests/unit/payment-dashboard.test.tsx`
- Modify: `tests/e2e/interactions.spec.ts` and `tests/e2e/routes.spec.ts` only for live payment fixtures.

**Interfaces:** Consumes safe wallet/payment DTOs and existing React Query providers. Produces `usePaymentAuthorizations`, payment totals, live Wallets rows, and Compliance entries without exposing raw rail events.

- [ ] **Step 1: Write dashboard failing tests.**

  ```tsx
  it("shows authorization metadata and no secrets", async () => {
    render(<WalletsClient />, { queryData: paymentFixture });
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("HK$20.00")).toBeInTheDocument();
    expect(screen.getByText(/MCC 5734/)).toBeInTheDocument();
    expect(screen.queryByText(/sk_test|whsec|cvc|pan|signature/i)).not.toBeInTheDocument();
  });

  it("keeps payment activity tenant-scoped and refreshes after provisioning", async () => {
    render(<DashboardOverviewClient />, { queryData: localOrgFixture });
    expect(await screen.findByText("HK$20.00 authorized")).toBeInTheDocument();
    expect(screen.queryByText("Other tenant payment")).not.toBeInTheDocument();
  });
  ```

- [ ] **Step 2: Implement safe read endpoints/hooks.**

  `GET /api/payment-authorizations?agentId=&limit=` validates a bounded limit (1–100), uses actor transaction/RLS, returns `{ data: { items, totals } }`, and maps amounts/timestamps/reason codes only. `usePaymentAuthorizations` polls every three seconds while the existing dashboard stream is resumed and stops while paused; it invalidates after card provisioning, freeze/unfreeze, mandate issue/revoke, and a webhook fixture in tests.

- [ ] **Step 3: Wire Wallets, Overview, and Compliance.**

  Wallet rows show card last four/brand/rail/status, policy version and HKD caps, plus live approved/declined totals. Overview KPIs/charts use `payment_authorizations` aggregates merged with gateway activity. Compliance displays the server audit chain and payment reason codes; it continues to use the hardened server CSV download and verification state from Phase 1. No client-side signature/export calculation is reintroduced.

- [ ] **Step 4: Verify no mock behavior remains.**

  ```powershell
  rg -n "hermes-store|hermes-data|useHermes|mock.*wallet|issuePassport|agentBySlug|mock.*payment" src tests
  ```

  Expected: no payment/wallet mock source remains. Retain only explicitly named deterministic UI fixtures under `tests/fixtures` and the `MockPaymentRail` implementation used by test configuration.

- [ ] **Step 5: Run focused browser checks and commit.**

  ```powershell
  bun x vitest run tests/unit/payment-dashboard.test.tsx
  PAYMENT_RAIL=mock bun x playwright test tests/e2e/interactions.spec.ts --grep "wallet|payment|authorization"
  git add src/app/api/payment-authorizations src/lib/payments src/components/hermes/dashboard tests/unit/payment-dashboard.test.tsx tests/e2e/interactions.spec.ts tests/e2e/routes.spec.ts
  git commit -m "feat(payments): show live card authorizations in the dashboard"
  ```

---

### Task 9: Sandbox E2E, CI, and release gates

**Files:**

- Create: `tests/e2e/payments.spec.ts`
- Create: `tests/unit/payment-release-gates.test.ts`
- Create: `tests/fixtures/payments.ts`
- Create: `docs/release/phase-3-gates.md`
- Modify: `package.json` scripts (`test:payments`, `test:e2e:payments`)
- Modify: `playwright.config.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/run-db-tests.ts` and `scripts/run-db-smoke.ts` only for payment test selection.
- Modify: `README.md` with the sandbox environment map and no-production-key policy.

**Interfaces:** Consumes all Phase 3 routes/services and existing 39-route/five-dashboard manifests. Produces deterministic CI evidence, an optional protected Stripe sandbox job, and a release runbook that blocks production until the E2E and rail-contract gates are approved.

- [ ] **Step 1: Add deterministic Playwright fixtures before the E2E flow.**

  `tests/fixtures/payments.ts` must seed the mock rail with one active external-key agent, one owner, one HKD intent mandate, one one-time cart mandate, one active policy, and no private key. It intercepts `/api/mandates`, `/api/wallets`, `/api/payment-authorizations`, and the webhook fixture only when `PAYMENT_RAIL=mock`; it must not intercept public marketing routes or conceal authorization failures.

- [ ] **Step 2: Write the end-to-end flow.**

  `tests/e2e/payments.spec.ts` must run in an authorized storage state and assert:

  1. signed mandate POST succeeds and the tampered signature receives `401`/`403` without a row;
  2. owner provisions exactly one mock HKD card and Wallets shows last four only;
  3. an in-mandate, in-cap webhook returns `{ approved: true }` and one `payment.authorization` audit row;
  4. a no-mandate, over-mandate, frozen-card, revoked-agent, expired-mandate, unsupported-currency, and policy-cap webhook each returns `{ approved: false }` with the expected stored reason code;
  5. replaying the same event returns the same decision and does not duplicate payment/audit rows;
  6. Compliance audit verification remains valid and CSV formula-injection guards remain active;
  7. the local decision's `latencyMs < 1500` and the response has no raw event/card/key field.

  Run:

  ```powershell
  PAYMENT_RAIL=mock bun x playwright test tests/e2e/payments.spec.ts
  ```

  Expected: all deterministic payment tests pass without `STRIPE_SECRET_KEY`.

- [ ] **Step 3: Add the optional Stripe sandbox probe without weakening CI.**

  `tests/integration/stripe.sandbox.test.ts` runs only when `STRIPE_SECRET_KEY` starts with `sk_test_`, `STRIPE_ISSUING_WEBHOOK_SECRET` is present, `PAYMENT_RAIL=stripe`, and `PAYMENT_SANDBOX_APPROVED=1`. It creates/uses only a test card, sends a signed authorization fixture through the raw webhook, asserts the adapter returns the direct `{ approved }` body, and records whether the account currency is compatible with HKD. Missing preconditions skip with an explicit `PROVIDER_GATE_SKIPPED` message; they never make the deterministic CI job pass as if Stripe were verified. No test prints the key, webhook secret, card number, or CVC.

- [ ] **Step 4: Add CI jobs and release contract tests.**

  Update `.github/workflows/ci.yml` with:

  - `check`: frozen Bun install, format, ESLint, TypeScript, Drizzle check, full Vitest, and production build;
  - `postgres-integration`: PostgreSQL 18 service, migrations 0000→0006, `bun run test:db`, and artifact upload on failure;
  - `parity`: existing 39 public routes, five dashboards signed out/authorized, interactions, and visual checks with `PAYMENT_RAIL=mock`;
  - `payment-sandbox`: `workflow_dispatch` only, protected test secrets, `needs: [postgres-integration, parity]`, and no production environment/secret access. It runs the optional Stripe probe and uploads redacted Playwright/Stripe response metadata only.

  `tests/unit/payment-release-gates.test.ts` must assert 44 unique route checks, the payment tests are included in `test:db`, the CI payment job is approval-gated, `sk_live_` is rejected, and no workflow references Supabase or a production Stripe secret.

- [ ] **Step 5: Write the release runbook.**

  `docs/release/phase-3-gates.md` must list exact commands and evidence for:

  ```text
  bun install --frozen-lockfile
  bun run format:check
  bun run lint
  bun run typecheck
  bun run db:check
  bun run test
  bun run test:db
  PAYMENT_RAIL=mock bun run test:e2e
  bun run build
  ```

  It must separately list the Stripe test-mode variable map (`STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_ISSUING_WEBHOOK_SECRET=whsec_...`, `PAYMENT_RAIL=stripe`, `PAYMENT_SANDBOX_APPROVED=1`), the no-secret-print rule, the HKD/no-FX rule, the two-second webhook evidence, the required Airwallex/Nium contract evidence, and the approvals needed before provider/PR/production actions. It must explicitly state: “Until the E2E suite and rail contract are approved, Phase 3 status is sandbox verified, production payment rail blocked.”

- [ ] **Step 6: Run the complete deterministic gate and inspect the diff.**

  ```powershell
  bun install --frozen-lockfile
  bun run format:check
  bun run lint
  bun run typecheck
  bun run db:check
  bun run test
  bun run test:db
  PAYMENT_RAIL=mock bun run test:e2e
  bun run build
  git diff --check
  rg -n "sk_live_|SUPABASE|supabase|PAN|CVC|privateJwk|private_key|STRIPE_SECRET_KEY" src tests .github docs
  ```

  Expected: all local gates pass; the scan finds only intentional `sk_live_` rejection tests and documentation references, never a real key or secret; no Supabase source/config is introduced; the route and visual suites remain green.

- [ ] **Step 7: Commit the release slice; do not publish.**

  ```powershell
  git add tests/e2e tests/unit/payment-release-gates.test.ts tests/fixtures/payments.ts docs/release/phase-3-gates.md package.json playwright.config.ts .github/workflows/ci.yml scripts/run-db-tests.ts scripts/run-db-smoke.ts README.md
  git commit -m "test(payments): add sandbox payment release gates"
  git status --short --branch
  ```

  Expected: clean worktree and a local commit. Do not run `git push`, `gh pr create`, `stripe listen`, Neon/Vercel commands, production migrations, partner outreach, or domain changes in this plan execution without a separate explicit approval.

## Acceptance Evidence

- Phase 2 is merged and its final commit is the ancestor of the Phase 3 branch.
- `mandates`, `wallet_cards`, and `payment_authorizations` are additive Drizzle migrations with forced RLS, composite tenant FKs, idempotency keys, safe public DTOs, and valid audit-chain entries.
- RFC 8785 mandate bytes and Ed25519 signatures are stable under reordered fields; tampering, wrong key, inactive key, wrong DID, parent mismatch, expiry, and replay fail deterministically.
- Mandate, card, and authorization transactions are tenant-scoped and rollback-safe; one-time mandates are consumed once; concurrent cap checks serialize on the existing per-agent advisory lock.
- Payment policy evaluation uses `checkout.external` and the existing Phase 2 rule order; no `hold` reaches a card network; non-HKD requests fail closed without FX.
- Stripe adapter rejects every non-`sk_test_` key, uses raw-body signature verification, direct webhook response mode, and no outbound calls in the authorization decision transaction.
- Wallets and overview read Neon payment/card data; the legacy Hermes mock store is deleted only after the import graph is empty; no PAN/CVC/private key reaches the browser or audit log.
- Deterministic Playwright proves mandate → card → authorization → audit, idempotent replay, declines, audit verification, 39 public routes, five dashboards, and visual parity. Optional Stripe sandbox evidence is separately labeled and never substitutes for the deterministic gate.
- Production remains blocked until a human separately approves a signed Airwallex/Nium rail contract, production key creation, webhook registration, Vercel/Neon configuration, PR publication, and post-deploy verification.

## Self-review performed while writing this plan

- **Spec coverage:** all eight attached implementation tasks are represented across Tasks 1–9, with the Supabase paths translated to Neon, the Stripe test-mode safety gate retained, the two-second webhook requirement covered by service and integration tests, live Wallets migration covered, and the production/partner gates preserved.
- **Placeholder scan:** no `TBD`, `TODO`, angle-bracket placeholder, or unspecified error-handling step remains; execution-time dates/SHA values are recorded by the named gate task rather than left as empty fields.
- **Type consistency:** mandate, rail, payment authorization, policy adapter, store, route, hook, and E2E names match the source-of-truth interfaces above; all later tasks consume the exact names and enum values defined earlier.
- **Current-repository check:** the plan uses `src/lib/http.ts`, `src/lib/gateway/service.ts`, `src/lib/policies/service.ts`, `src/lib/agents/service.ts`, the `hermes_app` RLS model, Drizzle migration 0006, and the existing Playwright/PG18 runners rather than the obsolete Supabase files in the attached brief.
