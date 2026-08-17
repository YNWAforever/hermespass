import {
  bigint,
  bigserial,
  customType,
  foreignKey,
  index,
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
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    uniqueIndex("org_members_user_id_key").on(table.userId),
    index("org_members_organization_id_idx").on(table.organizationId),
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
    uniqueIndex("agent_keys_agent_fragment_key").on(table.agentId, table.keyFragment),
    uniqueIndex("agent_keys_active_agent_key")
      .on(table.agentId)
      .where(sql`${table.status} = 'active'`),
    index("agent_keys_organization_id_idx").on(table.organizationId),
    foreignKey({
      name: "agent_keys_agent_organization_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [agents.id, agents.organizationId],
    }).onDelete("cascade"),
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
  ],
);

export const schema = {
  organizations,
  orgMembers,
  issuerKeys,
  agents,
  agentKeys,
  agentAuditLogs,
};

export type Organization = typeof organizations.$inferSelect;
export type OrgMember = typeof orgMembers.$inferSelect;
export type AgentRow = typeof agents.$inferSelect;
export type AgentKeyRow = typeof agentKeys.$inferSelect;
export type AuditRow = typeof agentAuditLogs.$inferSelect;
