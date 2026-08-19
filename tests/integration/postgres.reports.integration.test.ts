import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;
if (databaseRequired) {
  describe("report PostgreSQL test configuration", () => {
    it("requires DATABASE_URL_TEST", () => expect(databaseUrl).toBeTruthy());
  });
}

const migrationDir = join(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDir)
  .filter((name) => /^00(0[0-9]|1[0-5])_.*\.sql$/.test(name))
  .sort()
  .map((name) => join(migrationDir, name));

async function resetAndMigrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    await client.query("DROP ROLE IF EXISTS hermes_app");
    await client.query("DROP ROLE IF EXISTS migration_owner");
    await client.query("CREATE ROLE migration_owner LOGIN CREATEROLE");
    await client.query("ALTER SCHEMA public OWNER TO migration_owner");
    await client.query("GRANT CREATE ON SCHEMA public TO PUBLIC");
    await client.query("CREATE ROLE hermes_app NOLOGIN INHERIT");
    await client.query("GRANT hermes_app TO migration_owner WITH ADMIN OPTION");
    await client.query("GRANT CREATE ON SCHEMA public TO hermes_app");
    await client.query("SET ROLE postgres");
    for (const path of migrationPaths) {
      const migration = await readFile(path, "utf8");
      await client.query("BEGIN");
      try {
        for (const statement of migration.split("--> statement-breakpoint")) {
          if (statement.trim()) await client.query(statement);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

async function appTx<T>(
  pool: Pool,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await client.query("SELECT set_config('hermes.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

async function migrationTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE postgres");
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}
dbTest("compliance report read boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const owner = "report-owner";
  let organizationId: string;

  beforeAll(async () => {
    await resetAndMigrate(pool);
    organizationId = await appTx(pool, owner, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM public.hermes_create_organization($1,$2,$3,$4,$5)",
        ["Report Org", "report-org", owner, "owner@example.test", "Report Owner"],
      );
      return result.rows[0]!.id;
    });
    await migrationTx(pool, async (client) => {
      const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const keyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      await client.query(
        "INSERT INTO public.agents(id,organization_id,slug,did,name,role,risk,scopes,spend_cap_cents,credential_id,credential_jws,issued_at,expires_at,created_by) VALUES ($1,$2,'report-agent',$3,'Report Agent','operator','low',ARRAY['catalog.read'],10000,'credential-report','jws-report','2026-08-01T00:00:00Z','2027-08-01T00:00:00Z',$4)",
        [agentId, organizationId, "did:web:hermespass.asia:agent:report-agent", owner],
      );
      await client.query(
        "INSERT INTO public.agent_keys(id,agent_id,organization_id,key_fragment,public_jwk,thumbprint,custody,status) VALUES ($1,$2,$3,'key-1',$4::jsonb,'thumbprint-report','external','active')",
        [
          keyId,
          agentId,
          organizationId,
          JSON.stringify({
            kty: "OKP",
            crv: "Ed25519",
            x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          }),
        ],
      );
      const requestValues = [
        [
          "10000000-0000-4000-8000-000000000001",
          "allow",
          null,
          null,
          null,
          "2026-08-10T00:00:00Z",
          "2026-08-10T00:00:00Z",
          "2026-08-10T00:00:00Z",
          "2026-08-10T00:05:00Z",
        ],
        [
          "10000000-0000-4000-8000-000000000002",
          "deny",
          1000,
          "HKD",
          "5812",
          "2026-08-10T01:00:00Z",
          "2026-08-10T01:00:00Z",
          "2026-08-10T01:00:00Z",
          null,
        ],
        [
          "10000000-0000-4000-8000-000000000003",
          "hold",
          5000,
          "HKD",
          "5812",
          "2026-08-10T02:00:00Z",
          "2026-08-10T02:00:00Z",
          "2026-08-10T02:00:00Z",
          null,
        ],
      ] as const;
      for (const [
        id,
        decision,
        amount,
        currency,
        mcc,
        signedAt,
        receivedAt,
        decidedAt,
        authorizationExpiresAt,
      ] of requestValues) {
        await client.query(
          "INSERT INTO public.gateway_requests(id,organization_id,agent_id,key_id,nonce,request_digest,payload_digest,signature_digest,tool,summary,amount_cents,currency,merchant_category_code,signed_at,received_at,decision,current_decision,reason_code,reason,decided_at,current_result_updated_at,authorized_at,authorization_expires_at) VALUES ($1,$2,$3,$4,$5,decode(repeat('11',32),'hex'),decode(repeat('22',32),'hex'),decode(repeat('33',32),'hex'),'catalog.read','Report fixture',$6,$7,$8,$9,$10,$11,$11,'fixture','Fixture decision',$14,$10,$12,$13)",
          [
            id,
            organizationId,
            agentId,
            keyId,
            id,
            amount,
            currency,
            mcc,
            signedAt,
            receivedAt,
            decision,
            authorizationExpiresAt ? receivedAt : null,
            authorizationExpiresAt,
            decidedAt,
          ],
        );
      }
      await client.query(
        "INSERT INTO public.pending_approvals(id,organization_id,agent_id,gateway_request_id,assigned_reviewer_user_id,status,expires_at,created_at) VALUES ('20000000-0000-4000-8000-000000000001',$1,$2,'10000000-0000-4000-8000-000000000003',$3,'pending',pg_catalog.clock_timestamp() + interval '3 hours 30 minutes',pg_catalog.clock_timestamp() - interval '30 minutes')",
        [organizationId, agentId, owner],
      );
      await client.query("SELECT set_config('hermes.user_id',$1,true)", [owner]);
      await client.query(
        "UPDATE public.pending_approvals SET status='approved', resolution='allow', resolution_source='web', resolved_by_user_id=$1, resolved_at=pg_catalog.clock_timestamp() WHERE id='20000000-0000-4000-8000-000000000001'",
        [owner],
      );
      await client.query(
        "UPDATE public.gateway_requests SET current_decision='allow', reason_code='APPROVED', reason='Approved fixture', current_result_updated_at=pg_catalog.clock_timestamp(), authorized_at=pg_catalog.clock_timestamp(), authorization_expires_at=pg_catalog.clock_timestamp() + interval '5 minutes' WHERE id='10000000-0000-4000-8000-000000000003'",
      );
    });
  });

  afterAll(async () => pool.end());

  it("returns only the safe deterministic read model for a member", async () => {
    const result = await appTx(pool, owner, (client) =>
      client.query<{ hermes_report_read_model: Record<string, unknown> }>(
        "SELECT public.hermes_report_read_model($1,$2::timestamptz,$3::timestamptz,$4) AS hermes_report_read_model",
        [organizationId, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z", owner],
      ),
    );
    const report = result.rows[0]!.hermes_report_read_model;
    expect(report).toMatchObject({
      orgSlug: "report-org",
      agents: [
        {
          did: "did:web:hermespass.asia:agent:report-agent",
          name: "Report Agent",
          risk: "low",
          status: "active",
        },
      ],
      decisions: { allow: 2, deny: 1, hold: 0 },
      approvals: { resolved: 1, byHuman: 1, byTimeout: 0 },
      chainValid: true,
      checkedRows: 1,
    });
    const approvals = report["approvals"] as { medianMinutes: number };
    expect(Number(approvals.medianMinutes)).toBeCloseTo(30, 1);
    expect(JSON.stringify(report)).not.toContain("credential");
    expect(JSON.stringify(report)).not.toContain("governance");
  });

  it("allows only the claimed report worker to use the system boundary", async () => {
    const result = await appTx(pool, "report-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:report')");
      return client.query(
        "SELECT public.hermes_report_read_model($1,$2::timestamptz,$3::timestamptz,$4) AS report",
        [organizationId, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z", "system:report"],
      );
    });
    expect(result.rows[0]?.report).toMatchObject({ orgSlug: "report-org", chainValid: true });
  });

  it("does not let an unclaimed app role verify a tenant audit chain", async () => {
    const result = await appTx(pool, "other-user", (client) =>
      client.query<{ valid: boolean; checked: number }>(
        "SELECT valid, checked FROM public.hermes_verify_audit_chain($1)",
        [organizationId],
      ),
    );
    expect(result.rows[0]?.valid).toBe(false);
    expect(Number(result.rows[0]?.checked)).toBe(0);
  });

  it("denies a cross-tenant or unclaimed system actor", async () => {
    await expect(
      appTx(pool, "other-user", (client) =>
        client.query(
          "SELECT public.hermes_report_read_model($1,$2::timestamptz,$3::timestamptz,$4)",
          [organizationId, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z", "other-user"],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      appTx(pool, "other-user", (client) =>
        client.query(
          "SELECT public.hermes_report_read_model($1,$2::timestamptz,$3::timestamptz,$4)",
          [organizationId, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z", "system:report"],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
