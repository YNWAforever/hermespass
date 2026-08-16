import { Pool, neonConfig } from "@neondatabase/serverless";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const databaseUrl = process.env["DATABASE_URL_TEST"];
const dbTest = databaseUrl ? describe : describe.skip;

dbTest("Neon/PostgreSQL identity and audit controls", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("has forced RLS on every tenant table", async () => {
    const result = await pool.query(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[]) order by relname",
      [["organizations", "org_members", "issuer_keys", "agents", "agent_keys", "agent_audit_logs"]],
    );
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it("exposes the reviewed audit functions", async () => {
    const result = await pool.query("select proname from pg_proc where proname = any($1::text[])", [
      ["hermes_audit_hash", "hermes_verify_audit_chain", "hermes_public_agent"],
    ]);
    expect(new Set(result.rows.map((row) => row.proname))).toEqual(
      new Set(["hermes_audit_hash", "hermes_verify_audit_chain", "hermes_public_agent"]),
    );
  });

  it("denies tenant reads without a verified user claim", async () => {
    await pool.query("begin");
    try {
      await pool.query("select set_config('hermes.user_id', '', true)");
      const result = await pool.query("select count(*)::int as count from org_members");
      expect(result.rows[0]?.count).toBe(0);
    } finally {
      await pool.query("rollback");
    }
  });
});
