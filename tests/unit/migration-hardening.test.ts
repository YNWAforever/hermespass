import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "drizzle", "0001_phase1_security_hardening.sql");
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");

describe("additive Phase 1 security migration", () => {
  it("keeps 0000 immutable and journals an additive 0001 migration", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.slice(0, 2).map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 0, tag: "0000_low_human_robot" },
      { idx: 1, tag: "0001_phase1_security_hardening" },
    ]);
  });

  it("contains reviewed tenant, role, hash-version, and public-key hardening", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain("agent_keys_agent_organization_fk");
    expect(sql).toContain("agent_audit_logs_agent_organization_fk");
    expect(sql).toContain("pg_auth_members");
    expect(sql).toContain("hermes_audit_hash_v3");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.hermes_audit_hash(");
    expect(sql).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(sql).toContain("hermes_revoke_agent");
    expect(sql).toContain("hermes_public_issuer_keys");
  });
});
