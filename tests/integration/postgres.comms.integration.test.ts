import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;
if (databaseRequired) {
  describe("communications PostgreSQL test configuration", () => {
    it("requires DATABASE_URL_TEST", () => expect(databaseUrl).toBeTruthy());
  });
}

const migrationDir = join(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDir)
  .filter((name) => /^00(0[0-9]|1[0-7])_.*\.sql$/.test(name))
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

async function appTx<T>(pool: Pool, userId: string, fn: (client: PoolClient) => Promise<T>) {
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

async function migrationTx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>) {
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

dbTest("communications inbound boundary", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  const owner = "comms-owner";
  let organizationId: string;
  let agentId: string;

  beforeAll(async () => {
    await resetAndMigrate(pool);
    organizationId = await appTx(pool, owner, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM public.hermes_create_organization($1,$2,$3,$4,$5)",
        ["Comms Org", "comms-org", owner, "owner@example.test", "Comms Owner"],
      );
      return result.rows[0]!.id;
    });
    agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await migrationTx(pool, async (client) => {
      await client.query(
        "INSERT INTO public.agents(id,organization_id,slug,did,name,role,risk,scopes,spend_cap_cents,credential_id,credential_jws,issued_at,expires_at,created_by) VALUES ($1,$2,'comms-agent',$3,'Comms Agent','operator','low',ARRAY['email.dispatch'],0,'credential-comms','jws-comms',pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()+interval '1 year',$4)",
        [agentId, organizationId, "did:web:hermespass.asia:agent:comms-agent", owner],
      );
    });
  });

  afterAll(async () => pool.end());

  it("resolves only active agents through the claimed communications function", async () => {
    const result = await appTx(pool, "system-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:comms')");
      return client.query<{ agent_id: string; organization_id: string }>(
        "SELECT * FROM public.hermes_find_agent_by_slug($1)",
        ["comms-agent"],
      );
    });
    expect(result.rows).toEqual([{ agent_id: agentId, organization_id: organizationId }]);
  });

  it("is provider-idempotent and appends one email.receive audit row", async () => {
    const first = await appTx(pool, "system-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:comms')");
      return client.query<{ id: string; inserted: boolean }>(
        "SELECT id, inserted FROM public.hermes_insert_agent_message($1,$2,$3,$4,$5,$6,$7,decode(repeat('11',32),'hex'))",
        [
          organizationId,
          agentId,
          "sender@example.test",
          "comms-agent@agents.hermespass.asia",
          "Subject",
          "Message",
          "provider-1",
        ],
      );
    });
    const second = await appTx(pool, "system-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:comms')");
      return client.query<{ id: string; inserted: boolean }>(
        "SELECT id, inserted FROM public.hermes_insert_agent_message($1,$2,$3,$4,$5,$6,$7,decode(repeat('11',32),'hex'))",
        [
          organizationId,
          agentId,
          "sender@example.test",
          "comms-agent@agents.hermespass.asia",
          "Subject",
          "Message",
          "provider-1",
        ],
      );
    });
    expect(first.rows[0]?.inserted).toBe(true);
    expect(second.rows[0]?.inserted).toBe(false);
    expect(second.rows[0]?.id).toBe(first.rows[0]?.id);
    const audit = await migrationTx(pool, (client) =>
      client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.agent_audit_logs WHERE organization_id=$1 AND action='email.receive'",
        [organizationId],
      ),
    );
    expect(audit.rows[0]?.count).toBe("1");
  });

  it("denies unclaimed or unknown communication lookups", async () => {
    await expect(
      appTx(pool, "system-worker", (client) =>
        client.query("SELECT * FROM public.hermes_find_agent_by_slug($1)", ["comms-agent"]),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    const result = await appTx(pool, "system-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:comms')");
      return client.query("SELECT * FROM public.hermes_find_agent_by_slug($1)", ["missing-agent"]);
    });
    expect(result.rows).toEqual([]);
  });
});
