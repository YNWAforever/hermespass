import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const smokeRequired = process.env["DB_SMOKE_REQUIRED"] === "1";
const smokeTest = databaseUrl ? describe : describe.skip;

if (smokeRequired) {
  describe("PostgreSQL smoke test configuration", () => {
    it("requires DATABASE_URL_TEST", () => {
      expect(databaseUrl, "DATABASE_URL_TEST is required for bun run test:db:smoke").toBeTruthy();
    });
  });
}

smokeTest("PostgreSQL identity schema smoke", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: databaseUrl, max: 1 });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("retains forced RLS on every tenant table", async () => {
    const tenantTables = [
      "organizations",
      "org_members",
      "issuer_keys",
      "agents",
      "agent_keys",
      "agent_audit_logs",
      "agent_policies",
      "gateway_requests",
      "pending_approvals",
      "agent_key_enrollments",
      "telegram_links",
      "telegram_link_tokens",
    ];
    const result = await pool.query(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname",
      [tenantTables],
    );

    expect(result.rows).toHaveLength(tenantTables.length);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
});
