import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "drizzle", "0002_policy_gateway.sql");
const snapshotPath = join(process.cwd(), "drizzle", "meta", "0002_snapshot.json");
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");
const schemaPath = join(process.cwd(), "src", "db", "schema.ts");

describe("additive Phase 2 policy gateway migration", () => {
  it("journals 0002 without replacing the Phase 0 or Phase 1 migrations", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(snapshotPath)).toBe(true);

    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 0, tag: "0000_low_human_robot" },
      { idx: 1, tag: "0001_phase1_security_hardening" },
      { idx: 2, tag: "0002_policy_gateway" },
    ]);
  });

  it("models every Phase 2 tenant table and external key custody in Drizzle", () => {
    const schema = readFileSync(schemaPath, "utf8");

    for (const tableName of [
      "agent_policies",
      "gateway_requests",
      "pending_approvals",
      "agent_key_enrollments",
      "telegram_links",
      "telegram_link_tokens",
    ]) {
      expect(schema).toContain(`\"${tableName}\"`);
    }

    expect(schema).toMatch(
      /pgEnum\("agent_key_custody",\s*\[\s*"legacy_encrypted",\s*"external",?\s*\]\)/,
    );
    expect(schema).toContain('emailSnapshot: text("email_snapshot")');
    expect(schema).toContain('nameSnapshot: text("name_snapshot")');
    expect(schema).toContain("9007199254740991");
    expect(schema).toContain("gateway_requests_allow_hkd_check");
    expect(schema).toContain("${table.currency} IS NOT NULL");
    expect(schema).not.toMatch(/(?:plain|raw)_?token/i);
  });

  it("contains reviewed RLS, custody, token, tenant-integrity, and lock hardening", () => {
    const sql = readFileSync(migrationPath, "utf8");

    for (const tableName of [
      "agent_policies",
      "gateway_requests",
      "pending_approvals",
      "agent_key_enrollments",
      "telegram_links",
      "telegram_link_tokens",
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${tableName} FORCE ROW LEVEL SECURITY`);
    }

    expect(sql).toContain("agent_keys_custody_material_check");
    expect(sql).toContain("agent_key_enrollments_token_hash_length_check");
    expect(sql).toContain("telegram_link_tokens_token_hash_length_check");
    expect(sql).toContain("gateway_requests_agent_nonce_key");
    expect(sql).toContain("pending_approvals_request_key");
    expect(sql).toContain("hermes_set_verified_agent_claim");
    expect(sql).toContain("hermes_create_agent_key_enrollment");
    expect(sql).toContain("hermes_consume_agent_key_enrollment");
    expect(sql).toContain("hermes_create_telegram_link_token");
    expect(sql).toContain("hermes_consume_telegram_link_token");
    expect(sql).toContain("hermes_resolve_approval");
    expect(sql).toContain("hermes_record_approval_delivery");
    expect(sql).toContain("hermes_next_policy_version");
    expect(sql).toContain("hermes_lock_gateway_decision");
    expect(sql).toContain("hermes_lock_approval_resolution");
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(sql).toContain("agent_audit_logs_amount_safe_integer_check");
    expect(sql).toContain("agents_spend_cap_safe_integer_check");
    expect(sql).toContain("gateway_requests_allow_hkd_check");
    expect(sql).toContain('"gateway_requests"."currency" IS NOT NULL');
    expect(sql).toContain("agent.status = 'active'");
    expect(sql).toContain("key.status = 'active'");
    expect(sql).toContain("agent.expires_at > pg_catalog.clock_timestamp()");
    expect(sql).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|SELECT)[^;]*agent_key_enrollments\s+TO\s+hermes_app/i,
    );
    expect(sql).not.toMatch(
      /GRANT\s+(?:INSERT|UPDATE|SELECT)[^;]*telegram_link_tokens\s+TO\s+hermes_app/i,
    );
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION public.hermes_audit_before_insert");
    expect(sql).not.toContain("CREATE FUNCTION public.hermes_audit_before_insert");
    expect(sql).not.toMatch(/(?:plain|raw)_?token/i);
  });
});
