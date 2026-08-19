import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const memberRole = pgEnum("member_role", ["owner", "admin", "viewer"]);
export const riskTier = pgEnum("risk_tier", ["low", "medium", "high"]);
export const agentStatus = pgEnum("agent_status", ["active", "revoked"]);
export const keyStatus = pgEnum("key_status", ["active", "revoked"]);
export const agentKeyCustody = pgEnum("agent_key_custody", ["legacy_encrypted", "external"]);
export const gatewayDecision = pgEnum("gateway_decision", ["allow", "deny", "hold"]);
export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "denied",
  "expired",
]);
export const approvalResolutionSource = pgEnum("approval_resolution_source", [
  "web",
  "telegram",
  "expiry",
  "owner_override",
]);
export const telegramDeliveryState = pgEnum("telegram_delivery_state", [
  "not_requested",
  "pending",
  "sent",
  "failed",
]);

export const mandateKind = pgEnum("mandate_kind", ["intent", "cart"]);
export const mandateStatus = pgEnum("mandate_status", ["active", "consumed", "revoked", "expired"]);
export const walletCardStatus = pgEnum("wallet_card_status", [
  "provisioning",
  "active",
  "frozen",
  "canceled",
]);
export const paymentDecision = pgEnum("payment_decision", ["allow", "deny"]);
export const paymentAuthorizationStatus = pgEnum("payment_authorization_status", [
  "pending",
  "approved",
  "declined",
  "reversed",
]);

export type MandateKindValue = "intent" | "cart";

export type MandateBodyV1 = {
  version: "1";
  mandateId: string;
  agentDid: string;
  keyId: string;
  kind: MandateKindValue;
  nonce: string;
  issuedAt: string;
  parentMandateId: string | null;
  constraints: {
    currency: "HKD";
    maxAmountCents: number;
    merchant: string | null;
    mccAllowlist: string[];
    expiresAt: string;
    oneTime: boolean;
  };
};
export type PublicJwk = JsonWebKey & { [key: string]: unknown };

const bytea = customType<{ data: Buffer; driverData: Buffer; columnType: "bytea" }>({
  dataType() {
    return "bytea";
  },
});

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("organizations_slug_key").on(table.slug)],
);

export const orgMembers = pgTable(
  "org_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: memberRole("role").notNull().default("viewer"),
    emailSnapshot: text("email_snapshot"),
    nameSnapshot: text("name_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    uniqueIndex("org_members_user_id_key").on(table.userId),
    index("org_members_organization_id_idx").on(table.organizationId),
    check(
      "org_members_email_snapshot_check",
      sql`${table.emailSnapshot} IS NULL
        OR (length(${table.emailSnapshot}) BETWEEN 3 AND 320
          AND ${table.emailSnapshot} !~ '[[:cntrl:]]')`,
    ),
    check(
      "org_members_name_snapshot_check",
      sql`${table.nameSnapshot} IS NULL
        OR (length(btrim(${table.nameSnapshot})) BETWEEN 1 AND 200
          AND ${table.nameSnapshot} !~ '[[:cntrl:]]')`,
    ),
  ],
);

export const issuerKeys = pgTable(
  "issuer_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    did: text("did").notNull(),
    keyFragment: text("key_fragment").notNull(),
    publicJwk: jsonb("public_jwk").$type<PublicJwk>().notNull(),
    thumbprint: text("thumbprint").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    iv: bytea("iv").notNull(),
    wrappedDek: bytea("wrapped_dek").notNull(),
    kekVersion: text("kek_version").notNull(),
    encryptionAlgorithm: text("encryption_algorithm").notNull(),
    status: keyStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("issuer_keys_did_key_fragment_key").on(table.did, table.keyFragment),
    uniqueIndex("issuer_keys_active_did_key")
      .on(table.did)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    did: text("did").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    risk: riskTier("risk").notNull(),
    scopes: text("scopes").array().notNull(),
    spendCapCents: bigint("spend_cap_cents", { mode: "number" }).notNull().default(0),
    governanceNotes: text("governance_notes"),
    status: agentStatus("status").notNull().default("active"),
    credentialId: text("credential_id").notNull(),
    credentialJws: text("credential_jws").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("agents_slug_key").on(table.slug),
    uniqueIndex("agents_did_key").on(table.did),
    uniqueIndex("agents_credential_id_key").on(table.credentialId),
    unique("agents_id_organization_id_key").on(table.id, table.organizationId),
    index("agents_organization_id_idx").on(table.organizationId),
    index("agents_status_idx").on(table.status),
    check("agents_spend_cap_safe_integer_check", sql`${table.spendCapCents} <= 9007199254740991`),
  ],
);

export const agentKeys = pgTable(
  "agent_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    keyFragment: text("key_fragment").notNull(),
    publicJwk: jsonb("public_jwk").$type<PublicJwk>().notNull(),
    thumbprint: text("thumbprint").notNull(),
    custody: agentKeyCustody("custody").notNull().default("legacy_encrypted"),
    ciphertext: bytea("ciphertext"),
    iv: bytea("iv"),
    wrappedDek: bytea("wrapped_dek"),
    kekVersion: text("kek_version"),
    encryptionAlgorithm: text("encryption_algorithm"),
    status: keyStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("agent_keys_agent_fragment_key").on(table.agentId, table.keyFragment),
    uniqueIndex("agent_keys_active_agent_key")
      .on(table.agentId)
      .where(sql`${table.status} = 'active'`),
    unique("agent_keys_id_agent_organization_key").on(
      table.id,
      table.agentId,
      table.organizationId,
    ),
    index("agent_keys_organization_id_idx").on(table.organizationId),
    foreignKey({
      name: "agent_keys_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("cascade"),
    check(
      "agent_keys_custody_material_check",
      sql`(
        ${table.custody} = 'legacy_encrypted'
        AND ${table.ciphertext} IS NOT NULL
        AND ${table.iv} IS NOT NULL
        AND ${table.wrappedDek} IS NOT NULL
        AND ${table.kekVersion} IS NOT NULL
        AND ${table.encryptionAlgorithm} IS NOT NULL
      ) OR (
        ${table.custody} = 'external'
        AND ${table.ciphertext} IS NULL
        AND ${table.iv} IS NULL
        AND ${table.wrappedDek} IS NULL
        AND ${table.kekVersion} IS NULL
        AND ${table.encryptionAlgorithm} IS NULL
      )`,
    ),
  ],
);

export const agentPolicies = pgTable(
  "agent_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").notNull(),
    version: integer("version").notNull(),
    currency: text("currency").notNull().default("HKD"),
    perTransactionLimitCents: bigint("per_transaction_limit_cents", { mode: "number" }).notNull(),
    dailyLimitCents: bigint("daily_limit_cents", { mode: "number" }).notNull(),
    monthlyLimitCents: bigint("monthly_limit_cents", { mode: "number" }).notNull(),
    approvalThresholdCents: bigint("approval_threshold_cents", { mode: "number" }).notNull(),
    mccAllowlist: text("mcc_allowlist").array().notNull().default([]),
    mccRequired: boolean("mcc_required").notNull().default(false),
    assignedReviewerUserId: text("assigned_reviewer_user_id").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_policies_id_agent_organization_key").on(
      table.id,
      table.agentId,
      table.organizationId,
    ),
    unique("agent_policies_agent_organization_version_key").on(
      table.agentId,
      table.organizationId,
      table.version,
    ),
    uniqueIndex("agent_policies_active_agent_key")
      .on(table.agentId)
      .where(sql`${table.isActive} = true`),
    index("agent_policies_organization_id_idx").on(table.organizationId),
    index("agent_policies_agent_version_idx").on(table.agentId, table.version),
    foreignKey({
      name: "agent_policies_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "agent_policies_reviewer_organization_fk",
      columns: [table.organizationId, table.assignedReviewerUserId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "agent_policies_creator_organization_fk",
      columns: [table.organizationId, table.createdByUserId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    check("agent_policies_version_positive_check", sql`${table.version} > 0`),
    check("agent_policies_currency_hkd_check", sql`${table.currency} = 'HKD'`),
    check(
      "agent_policies_limits_ordered_check",
      sql`${table.perTransactionLimitCents} >= 0
        AND ${table.perTransactionLimitCents} <= 9007199254740991
        AND ${table.dailyLimitCents} >= ${table.perTransactionLimitCents}
        AND ${table.dailyLimitCents} <= 9007199254740991
        AND ${table.monthlyLimitCents} >= ${table.dailyLimitCents}
        AND ${table.monthlyLimitCents} <= 9007199254740991
        AND ${table.approvalThresholdCents} >= 0
        AND ${table.approvalThresholdCents} <= 9007199254740991
        AND ${table.approvalThresholdCents} <= ${table.perTransactionLimitCents}`,
    ),
    check(
      "agent_policies_mcc_requirement_check",
      sql`NOT ${table.mccRequired} OR cardinality(${table.mccAllowlist}) > 0`,
    ),
    check(
      "agent_policies_mcc_values_check",
      sql`cardinality(${table.mccAllowlist}) = 0
        OR array_to_string(${table.mccAllowlist}, ',', '<invalid>')
          ~ '^[0-9]{4}(,[0-9]{4})*$'`,
    ),
    check(
      "agent_policies_active_state_check",
      sql`(${table.isActive} AND ${table.supersededAt} IS NULL)
        OR (NOT ${table.isActive} AND ${table.supersededAt} IS NOT NULL)`,
    ),
  ],
);

export const gatewayRequests = pgTable(
  "gateway_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").notNull(),
    keyId: uuid("key_id").notNull(),
    nonce: text("nonce").notNull(),
    requestDigest: bytea("request_digest").notNull(),
    payloadDigest: bytea("payload_digest").notNull(),
    signatureDigest: bytea("signature_digest").notNull(),
    actionVersion: text("action_version").notNull().default("1"),
    tool: text("tool").notNull(),
    summary: text("summary").notNull(),
    justification: text("justification"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    merchantCategoryCode: text("merchant_category_code"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    decision: gatewayDecision("decision").notNull(),
    currentDecision: gatewayDecision("current_decision").notNull(),
    reasonCode: text("reason_code").notNull(),
    reason: text("reason").notNull(),
    policyVersion: integer("policy_version"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    currentResultUpdatedAt: timestamp("current_result_updated_at", {
      withTimezone: true,
    }).notNull(),
    authorizedAt: timestamp("authorized_at", { withTimezone: true }),
    authorizationExpiresAt: timestamp("authorization_expires_at", { withTimezone: true }),
  },
  (table) => [
    unique("gateway_requests_id_agent_organization_key").on(
      table.id,
      table.agentId,
      table.organizationId,
    ),
    unique("gateway_requests_agent_nonce_key").on(table.agentId, table.nonce),
    index("gateway_requests_organization_decided_idx").on(table.organizationId, table.decidedAt),
    index("gateway_requests_agent_authorized_idx").on(table.agentId, table.authorizedAt),
    foreignKey({
      name: "gateway_requests_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "gateway_requests_key_agent_organization_fk",
      columns: [table.keyId, table.agentId, table.organizationId],
      foreignColumns: [agentKeys.id, agentKeys.agentId, agentKeys.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "gateway_requests_policy_agent_organization_fk",
      columns: [table.agentId, table.organizationId, table.policyVersion],
      foreignColumns: [agentPolicies.agentId, agentPolicies.organizationId, agentPolicies.version],
    }).onDelete("restrict"),
    check(
      "gateway_requests_nonce_not_blank_check",
      sql`length(btrim(${table.nonce})) BETWEEN 1 AND 255`,
    ),
    check(
      "gateway_requests_request_digest_length_check",
      sql`octet_length(${table.requestDigest}) = 32`,
    ),
    check(
      "gateway_requests_payload_digest_length_check",
      sql`octet_length(${table.payloadDigest}) = 32`,
    ),
    check(
      "gateway_requests_signature_digest_length_check",
      sql`octet_length(${table.signatureDigest}) = 32`,
    ),
    check("gateway_requests_action_version_check", sql`${table.actionVersion} = '1'`),
    check(
      "gateway_requests_tool_allowed_check",
      sql`${table.tool} = ANY(ARRAY[
        'catalog.read', 'crm.read', 'refund.issue', 'email.dispatch',
        'checkout.external', 'invoice.approve', 'ads.bid', 'vendor.contract'
      ]::text[])`,
    ),
    check(
      "gateway_requests_summary_length_check",
      sql`length(btrim(${table.summary})) BETWEEN 1 AND 500`,
    ),
    check(
      "gateway_requests_justification_length_check",
      sql`${table.justification} IS NULL OR length(${table.justification}) <= 2000`,
    ),
    check(
      "gateway_requests_reason_fields_check",
      sql`length(btrim(${table.reasonCode})) BETWEEN 1 AND 100
        AND length(btrim(${table.reason})) BETWEEN 1 AND 1000`,
    ),
    check(
      "gateway_requests_mcc_format_check",
      sql`${table.merchantCategoryCode} IS NULL OR ${table.merchantCategoryCode} ~ '^[0-9]{4}$'`,
    ),
    check(
      "gateway_requests_amount_nonnegative_check",
      sql`${table.amountCents} IS NULL
        OR (${table.amountCents} >= 0 AND ${table.amountCents} <= 9007199254740991)`,
    ),
    check(
      "gateway_requests_spend_metadata_check",
      sql`(${table.amountCents} IS NULL AND ${table.currency} IS NULL AND ${table.merchantCategoryCode} IS NULL)
        OR (${table.amountCents} IS NOT NULL AND ${table.currency} IS NOT NULL
          AND ${table.currency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "gateway_requests_allow_hkd_check",
      sql`${table.amountCents} IS NULL
        OR ${table.currentDecision} <> 'allow'
        OR (${table.currency} IS NOT NULL AND ${table.currency} = 'HKD')`,
    ),
    check(
      "gateway_requests_authorization_timing_check",
      sql`(
          ${table.currentDecision} = 'allow'
          AND ${table.authorizedAt} IS NOT NULL
          AND ${table.authorizationExpiresAt} > ${table.authorizedAt}
          AND ${table.authorizationExpiresAt} <= ${table.authorizedAt} + interval '5 minutes'
        ) OR (
          ${table.currentDecision} <> 'allow'
          AND ${table.authorizedAt} IS NULL
          AND ${table.authorizationExpiresAt} IS NULL
        )`,
    ),
    check(
      "gateway_requests_result_timing_check",
      sql`${table.decidedAt} >= ${table.receivedAt}
        AND ${table.currentResultUpdatedAt} >= ${table.decidedAt}
        AND (${table.authorizedAt} IS NULL OR ${table.authorizedAt} >= ${table.decidedAt})`,
    ),
  ],
);

export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
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
    mccAllowlist: text("mcc_allowlist")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    merchant: text("merchant"),
    parentMandateId: uuid("parent_mandate_id"),
    status: mandateStatus("status").notNull().default("active"),
    oneTime: boolean("one_time").notNull().default(false),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("mandates_id_agent_organization_key").on(table.id, table.agentId, table.organizationId),
    unique("mandates_agent_nonce_key").on(table.agentId, table.nonce),
    index("mandates_active_agent_idx").on(
      table.organizationId,
      table.agentId,
      table.status,
      table.expiresAt,
    ),
    foreignKey({
      name: "mandates_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "mandates_key_agent_organization_fk",
      columns: [table.keyId, table.agentId, table.organizationId],
      foreignColumns: [agentKeys.id, agentKeys.agentId, agentKeys.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "mandates_parent_agent_organization_fk",
      columns: [table.parentMandateId, table.agentId, table.organizationId],
      foreignColumns: [table.id, table.agentId, table.organizationId],
    }).onDelete("restrict"),
    check("mandates_version_positive_check", sql`${table.version} > 0`),
    check("mandates_nonce_not_blank_check", sql`length(btrim(${table.nonce})) BETWEEN 1 AND 255`),
    check("mandates_body_version_check", sql`${table.body} ->> 'version' = '1'`),
    check("mandates_signature_length_check", sql`octet_length(${table.signature}) = 64`),
    check("mandates_body_digest_length_check", sql`octet_length(${table.bodyDigest}) = 32`),
    check("mandates_currency_hkd_check", sql`${table.currency} = 'HKD'`),
    check(
      "mandates_max_amount_safe_integer_check",
      sql`${table.maxAmountCents} > 0 AND ${table.maxAmountCents} <= 9007199254740991`,
    ),
    check(
      "mandates_mcc_values_check",
      sql`cardinality(${table.mccAllowlist}) = 0
        OR array_to_string(${table.mccAllowlist}, ',', '<invalid>') ~ '^[0-9]{4}(,[0-9]{4})*$'`,
    ),
    check("mandates_expiry_check", sql`${table.expiresAt} > ${table.issuedAt}`),
    check(
      "mandates_status_timestamps_check",
      sql`(
          ${table.status} = 'active'
          AND ${table.consumedAt} IS NULL
          AND ${table.revokedAt} IS NULL
        ) OR (
          ${table.status} = 'consumed'
          AND ${table.consumedAt} IS NOT NULL
          AND ${table.revokedAt} IS NULL
        ) OR (
          ${table.status} = 'revoked'
          AND ${table.revokedAt} IS NOT NULL
        ) OR (
          ${table.status} = 'expired'
          AND ${table.consumedAt} IS NULL
        )`,
    ),
  ],
);

export const walletCards = pgTable(
  "wallet_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").notNull(),
    rail: text("rail").notNull(),
    railCardholderId: text("rail_cardholder_id").notNull(),
    railCardId: text("rail_card_id").notNull(),
    last4: text("last4").notNull(),
    brand: text("brand").notNull(),
    currency: text("currency").notNull(),
    status: walletCardStatus("status").notNull().default("provisioning"),
    policyVersion: integer("policy_version").notNull(),
    provisioningToken: uuid("provisioning_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (table) => [
    unique("wallet_cards_id_agent_organization_key").on(
      table.id,
      table.agentId,
      table.organizationId,
    ),
    unique("wallet_cards_agent_key").on(table.organizationId, table.agentId),
    unique("wallet_cards_rail_card_key").on(table.rail, table.railCardId),
    index("wallet_cards_agent_status_idx").on(table.organizationId, table.agentId, table.status),
    foreignKey({
      name: "wallet_cards_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "wallet_cards_policy_agent_organization_fk",
      columns: [table.agentId, table.organizationId, table.policyVersion],
      foreignColumns: [agentPolicies.agentId, agentPolicies.organizationId, agentPolicies.version],
    }).onDelete("restrict"),
    check("wallet_cards_rail_not_blank_check", sql`length(btrim(${table.rail})) BETWEEN 1 AND 50`),
    check(
      "wallet_cards_cardholder_not_blank_check",
      sql`length(btrim(${table.railCardholderId})) BETWEEN 1 AND 255`,
    ),
    check(
      "wallet_cards_card_not_blank_check",
      sql`length(btrim(${table.railCardId})) BETWEEN 1 AND 255`,
    ),
    check("wallet_cards_last4_check", sql`${table.last4} ~ '^[0-9]{4}$'`),
    check("wallet_cards_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("wallet_cards_policy_version_positive_check", sql`${table.policyVersion} > 0`),
    check(
      "wallet_cards_frozen_state_check",
      sql`(${table.status} = 'frozen' AND ${table.frozenAt} IS NOT NULL)
        OR (${table.status} <> 'frozen' AND ${table.frozenAt} IS NULL)`,
    ),
  ],
);

export const paymentAuthorizations = pgTable(
  "payment_authorizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
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
  },
  (table) => [
    unique("payment_authorizations_rail_event_key").on(table.rail, table.eventId),
    unique("payment_authorizations_rail_authorization_key").on(
      table.rail,
      table.railAuthorizationId,
    ),
    index("payment_authorizations_spend_idx").on(
      table.organizationId,
      table.agentId,
      table.decidedAt,
    ),
    foreignKey({
      name: "payment_authorizations_card_agent_organization_fk",
      columns: [table.walletCardId, table.agentId, table.organizationId],
      foreignColumns: [walletCards.id, walletCards.agentId, walletCards.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_authorizations_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_authorizations_mandate_agent_organization_fk",
      columns: [table.mandateId, table.agentId, table.organizationId],
      foreignColumns: [mandates.id, mandates.agentId, mandates.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "payment_authorizations_policy_agent_organization_fk",
      columns: [table.agentId, table.organizationId, table.policyVersion],
      foreignColumns: [agentPolicies.agentId, agentPolicies.organizationId, agentPolicies.version],
    }).onDelete("restrict"),
    check(
      "payment_authorizations_event_not_blank_check",
      sql`length(btrim(${table.eventId})) BETWEEN 1 AND 255`,
    ),
    check(
      "payment_authorizations_authorization_not_blank_check",
      sql`length(btrim(${table.railAuthorizationId})) BETWEEN 1 AND 255`,
    ),
    check(
      "payment_authorizations_amount_safe_integer_check",
      sql`${table.amountCents} > 0 AND ${table.amountCents} <= 9007199254740991`,
    ),
    check("payment_authorizations_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "payment_authorizations_mcc_format_check",
      sql`${table.merchantCategoryCode} IS NULL OR ${table.merchantCategoryCode} ~ '^[0-9]{4}$'`,
    ),
    check(
      "payment_authorizations_reason_fields_check",
      sql`length(btrim(${table.reasonCode})) BETWEEN 1 AND 100
        AND length(btrim(${table.reason})) BETWEEN 1 AND 1000`,
    ),
    check(
      "payment_authorizations_decision_status_check",
      sql`(${table.decision} = 'allow' AND ${table.status} = 'approved')
        OR (${table.decision} = 'deny' AND ${table.status} IN ('pending', 'declined', 'reversed'))`,
    ),
    check("payment_authorizations_latency_nonnegative_check", sql`${table.latencyMs} >= 0`),
    check(
      "payment_authorizations_timing_check",
      sql`${table.decidedAt} >= ${table.receivedAt}
        AND (${table.reversedAt} IS NULL OR ${table.reversedAt} >= ${table.decidedAt})`,
    ),
  ],
);
export const pendingApprovals = pgTable(
  "pending_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").notNull(),
    gatewayRequestId: uuid("gateway_request_id").notNull(),
    assignedReviewerUserId: text("assigned_reviewer_user_id").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    resolution: gatewayDecision("resolution"),
    resolutionSource: approvalResolutionSource("resolution_source"),
    resolutionReason: text("resolution_reason"),
    resolvedByUserId: text("resolved_by_user_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    telegramDeliveryState: telegramDeliveryState("telegram_delivery_state")
      .notNull()
      .default("not_requested"),
    telegramDeliveryAttempts: integer("telegram_delivery_attempts").notNull().default(0),
    telegramLastAttemptAt: timestamp("telegram_last_attempt_at", { withTimezone: true }),
    telegramDeliveredAt: timestamp("telegram_delivered_at", { withTimezone: true }),
    telegramLastErrorCode: text("telegram_last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("pending_approvals_request_key").on(table.gatewayRequestId),
    unique("pending_approvals_id_agent_organization_key").on(
      table.id,
      table.agentId,
      table.organizationId,
    ),
    index("pending_approvals_organization_status_idx").on(table.organizationId, table.status),
    index("pending_approvals_reviewer_status_idx").on(table.assignedReviewerUserId, table.status),
    foreignKey({
      name: "pending_approvals_gateway_agent_organization_fk",
      columns: [table.gatewayRequestId, table.agentId, table.organizationId],
      foreignColumns: [gatewayRequests.id, gatewayRequests.agentId, gatewayRequests.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "pending_approvals_reviewer_organization_fk",
      columns: [table.organizationId, table.assignedReviewerUserId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "pending_approvals_resolver_organization_fk",
      columns: [table.organizationId, table.resolvedByUserId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    check(
      "pending_approvals_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}
        AND ${table.expiresAt} <= ${table.createdAt} + interval '4 hours'`,
    ),
    check(
      "pending_approvals_resolution_state_check",
      sql`(
          ${table.status} = 'pending'
          AND ${table.resolution} IS NULL
          AND ${table.resolutionSource} IS NULL
          AND ${table.resolvedByUserId} IS NULL
          AND ${table.resolvedAt} IS NULL
        ) OR (
          ${table.status} = 'approved'
          AND ${table.resolution} = 'allow'
          AND ${table.resolutionSource} IS NOT NULL
          AND ${table.resolvedByUserId} IS NOT NULL
          AND ${table.resolvedAt} IS NOT NULL
        ) OR (
          ${table.status} = 'denied'
          AND ${table.resolution} = 'deny'
          AND ${table.resolutionSource} IS NOT NULL
          AND ${table.resolvedByUserId} IS NOT NULL
          AND ${table.resolvedAt} IS NOT NULL
        ) OR (
          ${table.status} = 'expired'
          AND ${table.resolution} = 'deny'
          AND ${table.resolutionSource} = 'expiry'
          AND ${table.resolvedByUserId} IS NULL
          AND ${table.resolvedAt} IS NOT NULL
        )`,
    ),
    check("pending_approvals_delivery_attempts_check", sql`${table.telegramDeliveryAttempts} >= 0`),
    check(
      "pending_approvals_delivery_state_check",
      sql`(${table.telegramDeliveryState} = 'sent' AND ${table.telegramDeliveredAt} IS NOT NULL)
        OR (${table.telegramDeliveryState} <> 'sent' AND ${table.telegramDeliveredAt} IS NULL)`,
    ),
  ],
);

export const agentKeyEnrollments = pgTable(
  "agent_key_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedKeyId: uuid("consumed_key_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_key_enrollments_token_hash_key").on(table.tokenHash),
    index("agent_key_enrollments_agent_expiry_idx").on(table.agentId, table.expiresAt),
    foreignKey({
      name: "agent_key_enrollments_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "agent_key_enrollments_creator_organization_fk",
      columns: [table.organizationId, table.createdByUserId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "agent_key_enrollments_consumed_key_fk",
      columns: [table.consumedKeyId, table.agentId, table.organizationId],
      foreignColumns: [agentKeys.id, agentKeys.agentId, agentKeys.organizationId],
    }).onDelete("restrict"),
    check(
      "agent_key_enrollments_token_hash_length_check",
      sql`octet_length(${table.tokenHash}) = 32`,
    ),
    check(
      "agent_key_enrollments_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}
        AND ${table.expiresAt} <= ${table.createdAt} + interval '15 minutes'`,
    ),
    check(
      "agent_key_enrollments_consumption_check",
      sql`(${table.consumedAt} IS NULL AND ${table.consumedKeyId} IS NULL)
        OR (${table.consumedAt} IS NOT NULL
          AND ${table.consumedKeyId} IS NOT NULL
          AND ${table.consumedAt} >= ${table.createdAt}
          AND ${table.consumedAt} <= ${table.expiresAt})`,
    ),
  ],
);

export const telegramLinks = pgTable(
  "telegram_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    telegramChatId: bigint("telegram_chat_id", { mode: "number" }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    linkedAt: timestamp("linked_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    unique("telegram_links_id_organization_user_key").on(
      table.id,
      table.organizationId,
      table.userId,
    ),
    uniqueIndex("telegram_links_active_member_key")
      .on(table.organizationId, table.userId)
      .where(sql`${table.isActive} = true`),
    uniqueIndex("telegram_links_active_user_key")
      .on(table.telegramUserId)
      .where(sql`${table.isActive} = true`),
    index("telegram_links_organization_id_idx").on(table.organizationId),
    foreignKey({
      name: "telegram_links_member_organization_fk",
      columns: [table.organizationId, table.userId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    check(
      "telegram_links_active_state_check",
      sql`(${table.isActive} AND ${table.revokedAt} IS NULL)
        OR (NOT ${table.isActive} AND ${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

export const telegramLinkTokens = pgTable(
  "telegram_link_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedLinkId: uuid("consumed_link_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("telegram_link_tokens_token_hash_key").on(table.tokenHash),
    index("telegram_link_tokens_member_expiry_idx").on(
      table.organizationId,
      table.userId,
      table.expiresAt,
    ),
    foreignKey({
      name: "telegram_link_tokens_member_organization_fk",
      columns: [table.organizationId, table.userId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "telegram_link_tokens_creator_organization_fk",
      columns: [table.organizationId, table.createdByUserId],
      foreignColumns: [orgMembers.organizationId, orgMembers.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "telegram_link_tokens_consumed_link_fk",
      columns: [table.consumedLinkId, table.organizationId, table.userId],
      foreignColumns: [telegramLinks.id, telegramLinks.organizationId, telegramLinks.userId],
    }).onDelete("restrict"),
    check(
      "telegram_link_tokens_token_hash_length_check",
      sql`octet_length(${table.tokenHash}) = 32`,
    ),
    check(
      "telegram_link_tokens_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}
        AND ${table.expiresAt} <= ${table.createdAt} + interval '10 minutes'`,
    ),
    check(
      "telegram_link_tokens_consumption_check",
      sql`(${table.consumedAt} IS NULL AND ${table.consumedLinkId} IS NULL)
        OR (${table.consumedAt} IS NOT NULL
          AND ${table.consumedLinkId} IS NOT NULL
          AND ${table.consumedAt} >= ${table.createdAt}
          AND ${table.consumedAt} <= ${table.expiresAt})`,
    ),
  ],
);

export const agentAuditLogs = pgTable(
  "agent_audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    chainPosition: bigint("chain_position", { mode: "number" }).notNull().default(0),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    decision: text("decision"),
    tool: text("tool"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    hashVersion: smallint("hash_version").notNull().default(3),
    prevHash: bytea("prev_hash"),
    hash: bytea("hash").notNull(),
  },
  (table) => [
    index("agent_audit_logs_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("agent_audit_logs_organization_chain_position_key").on(
      table.organizationId,
      table.chainPosition,
    ),
    index("agent_audit_logs_agent_id_idx").on(table.agentId),
    foreignKey({
      name: "agent_audit_logs_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("restrict"),
    check(
      "agent_audit_logs_amount_safe_integer_check",
      sql`${table.amountCents} IS NULL
        OR ${table.amountCents} BETWEEN -9007199254740991 AND 9007199254740991`,
    ),
  ],
);

export const schema = {
  organizations,
  orgMembers,
  issuerKeys,
  agents,
  agentKeys,
  agentPolicies,
  gatewayRequests,
  mandates,
  walletCards,
  paymentAuthorizations,
  pendingApprovals,
  agentKeyEnrollments,
  telegramLinks,
  telegramLinkTokens,
  agentAuditLogs,
};

export type Organization = typeof organizations.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type AgentKeyRow = typeof agentKeys.$inferSelect;
export type AgentPolicyRow = typeof agentPolicies.$inferSelect;
export type GatewayRequestRow = typeof gatewayRequests.$inferSelect;
export type MandateRow = typeof mandates.$inferSelect;
export type WalletCardRow = typeof walletCards.$inferSelect;
export type PaymentAuthorizationRow = typeof paymentAuthorizations.$inferSelect;
export type PendingApprovalRow = typeof pendingApprovals.$inferSelect;
export type AgentKeyEnrollmentRow = typeof agentKeyEnrollments.$inferSelect;
export type TelegramLinkRow = typeof telegramLinks.$inferSelect;
export type TelegramLinkTokenRow = typeof telegramLinkTokens.$inferSelect;
export type AuditRow = typeof agentAuditLogs.$inferSelect;
