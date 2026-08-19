import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;
if (databaseRequired) {
  describe("public verification PostgreSQL test configuration", () => {
    it("requires DATABASE_URL_TEST", () => expect(databaseUrl).toBeTruthy());
  });
}

const migrationDir = join(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDir)
  .filter((name) => /^00(0[0-9]|1[0-4])_.*\.sql$/.test(name))
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
    await client.query("SET ROLE migration_owner");
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

const owner = "verification-owner";

dbTest("metered public verification boundaries", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let organizationId: string;
  let agentDid: string;
  const apiKey = "hp_live_" + "a".repeat(32);
  const keyHash = "b".repeat(64);
  const rateApiKey = "hp_live_" + "c".repeat(32);
  const rateKeyHash = "d".repeat(64);

  beforeAll(async () => {
    await resetAndMigrate(pool);
    organizationId = await appTx(pool, owner, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM public.hermes_create_organization($1,$2,$3,$4,$5)",
        ["Verification Org", "verification-org", owner, "owner@example.test", "Owner"],
      );
      return result.rows[0]!.id;
    });
    agentDid = "did:web:hermespass.asia:agent:verification-agent";
    await appTx(pool, owner, async (client) => {
      await client.query(
        "INSERT INTO public.agents(organization_id,slug,did,name,role,risk,scopes,spend_cap_cents,credential_id,credential_jws,issued_at,expires_at,created_by) VALUES ($1,'verification-agent',$2,'Verification Agent','operator','low',ARRAY['catalog.read'],1000,'credential-verification','jws-verification',now(),now()+interval '1 year',$3)",
        [organizationId, agentDid, owner],
      );
      await client.query(
        "INSERT INTO public.api_keys(organization_id,name,prefix,key_hash,created_by_user_id) VALUES ($1,'Verification API',left($2,12),$3,$4), ($1,'Rate API',left($5,12),$6,$4)",
        [organizationId, apiKey, keyHash, owner, rateApiKey, rateKeyHash],
      );
    });
  });

  afterAll(async () => pool.end());

  it("rejects unknown, wrong, and revoked keys without exposing tenant data", async () => {
    const missing = await appTx(pool, "public-api", (client) =>
      client.query("SELECT * FROM public.hermes_consume_api_key($1,'v1/verify',$2,200)", [
        "c".repeat(64),
        randomUUID(),
      ]),
    );
    expect(missing.rows[0]).toMatchObject({ api_key_id: null, allowed: false });

    const publicProjection = await appTx(pool, "public-api", (client) =>
      client.query("SELECT * FROM public.hermes_public_agent_by_did($1)", [agentDid]),
    );
    expect(publicProjection.rows[0]).toMatchObject({
      did: agentDid,
      organization_slug: "verification-org",
    });
    expect(publicProjection.rows[0]).toHaveProperty("credential_jws", "jws-verification");

    const keyId = await appTx(pool, owner, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM public.api_keys WHERE organization_id = $1 AND key_hash = $2",
        [organizationId, keyHash],
      );
      return result.rows[0]!.id;
    });
    await appTx(pool, owner, (client) =>
      client.query("SELECT * FROM public.hermes_revoke_api_key($1,$2,$3)", [
        organizationId,
        keyId,
        owner,
      ]),
    );
    const revoked = await appTx(pool, "public-api", (client) =>
      client.query("SELECT * FROM public.hermes_consume_api_key($1,'v1/verify',$2,200)", [
        keyHash,
        randomUUID(),
      ]),
    );
    expect(revoked.rows[0]).toMatchObject({ api_key_id: null, allowed: false });
  });

  it("returns 429 semantics exactly on the 61st request in a fixed minute", async () => {
    for (let index = 0; index < 60; index += 1) {
      const result = await appTx(pool, "public-api", (client) =>
        client.query("SELECT * FROM public.hermes_consume_api_key($1,'v1/verify',$2,200)", [
          rateKeyHash,
          "verification-" + index,
        ]),
      );
      expect(result.rows[0]?.allowed).toBe(true);
    }
    const limited = await appTx(pool, "public-api", (client) =>
      client.query("SELECT * FROM public.hermes_consume_api_key($1,'v1/verify',$2,200)", [
        rateKeyHash,
        "verification-61",
      ]),
    );
    expect(limited.rows[0]).toMatchObject({ allowed: false, retry_after_seconds: 60 });
  });
});
