import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = join(process.cwd(), "drizzle", "0003_gateway_auth_boundary.sql");
const snapshotPath = join(process.cwd(), "drizzle", "meta", "0003_snapshot.json");
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");

describe("additive gateway authentication boundary migration", () => {
  it("journals a function-only 0003 migration without rewriting 0002", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(existsSync(snapshotPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual([
      { idx: 0, tag: "0000_low_human_robot" },
      { idx: 1, tag: "0001_phase1_security_hardening" },
      { idx: 2, tag: "0002_policy_gateway" },
      { idx: 3, tag: "0003_gateway_auth_boundary" },
    ]);
  });

  it("exposes only safe historical public-key context and a scoped gateway claim", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain("hermes_gateway_auth_context");
    expect(migration).toContain("hermes_set_signature_authenticated_agent_claim");
    expect(migration).toContain("LANGUAGE plpgsql VOLATILE SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog, public, pg_temp");
    expect(migration).toContain("key.custody = 'external'");
    expect(migration).toContain("key.id = p_key_id");
    expect(migration).toContain("agent.did = p_agent_did");
    expect(migration).toContain("REVOKE ALL ON FUNCTION");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION");
    expect(migration).toContain("TO hermes_app");
    expect(migration).not.toMatch(/ciphertext|wrapped_dek|private_jwk|p_public_jwk/i);
  });
});
