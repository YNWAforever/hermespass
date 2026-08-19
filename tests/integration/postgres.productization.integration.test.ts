import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;
if (databaseRequired) {
  describe("Phase 5 PostgreSQL test configuration", () => {
    it("requires DATABASE_URL_TEST", () => expect(databaseUrl).toBeTruthy());
  });
}

const migrationDir = join(process.cwd(), "drizzle");
const migrationPaths = readdirSync(migrationDir)
  .filter((name) => /^00(0[0-9]|1[0-3])_.*\.sql$/.test(name))
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
      const sql = await readFile(path, "utf8");
      await client.query("BEGIN");
      try {
        for (const statement of sql.split("--> statement-breakpoint")) {
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

const orgOwner = "product-owner";
const viewer = "product-viewer";
const secondUser = "product-second";
const invitee = "product-invitee";

dbTest("Phase 5 productization PostgreSQL boundaries", () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let organizationId: string;
  let agentId: string;

  beforeAll(async () => {
    await resetAndMigrate(pool);
    organizationId = await appTx(pool, orgOwner, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM public.hermes_create_organization($1, $2, $3, $4, $5)",
        ["Product Org", "product-org", orgOwner, "owner@example.test", "Product Owner"],
      );
      return result.rows[0]!.id;
    });
    await appTx(pool, secondUser, async (client) => {
      const result = await client.query<{ id: string }>(
        "SELECT id FROM public.hermes_create_organization($1, $2, $3, $4, $5)",
        ["Second Org", "second-org", secondUser, "second@example.test", "Second User"],
      );
      expect(result.rows[0]?.id).toBeTruthy();
    });
    agentId = await appTx(pool, orgOwner, async (client) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO public.agents(organization_id, slug, did, name, role, risk, scopes, spend_cap_cents, credential_id, credential_jws, issued_at, expires_at, created_by)
         VALUES ($1, 'product-agent', 'did:web:hermespass.asia:agent:product-agent', 'Product Agent', 'operator', 'low', ARRAY['catalog.read'], 1000, 'credential-product', 'jws-product', now(), now() + interval '1 year', $2)
         RETURNING id`,
        [organizationId, orgOwner],
      );
      return result.rows[0]!.id;
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("maps tiers and prevents viewer mutation/cross-tenant children", async () => {
    const result = await pool.query(
      "SELECT public.hermes_tier_agent_limit(x) AS limit FROM unnest(ARRAY['pilot','starter','growth','scale']) x",
    );
    expect(result.rows.map((row) => Number(row.limit))).toEqual([3, 5, 25, 100]);
    await expect(
      appTx(pool, viewer, async (client) =>
        client.query(
          "INSERT INTO public.api_keys(organization_id,name,prefix,key_hash,created_by_user_id) VALUES ($1,'bad','hp_live_bad','a', $2)",
          [organizationId, viewer],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      appTx(pool, orgOwner, async (client) =>
        client.query(
          "INSERT INTO public.api_usage(api_key_id,organization_id,endpoint,request_id,status) VALUES ($1,$2,'v1/verify','x',200)",
          [crypto.randomUUID(), organizationId],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("creates a hashed invite and consumes it exactly once", async () => {
    const tokenHash = Buffer.alloc(32, 7);
    await appTx(pool, orgOwner, async (client) => {
      await client.query(
        "INSERT INTO public.org_invites(organization_id,email,role,token_hash,invited_by_user_id,expires_at) VALUES ($1,$2,'viewer',$3,$4,now()+interval '15 minutes')",
        [organizationId, "second@example.test", tokenHash, orgOwner],
      );
    });
    const accepted = await appTx(pool, invitee, async (client) =>
      client.query("SELECT * FROM public.hermes_accept_org_invite($1,$2,$3)", [
        tokenHash,
        invitee,
        "second@example.test",
      ]),
    );
    expect(accepted.rows[0]).toMatchObject({ organization_id: organizationId, role: "viewer" });
    await expect(
      appTx(pool, invitee, async (client) =>
        client.query("SELECT * FROM public.hermes_accept_org_invite($1,$2,$3)", [
          tokenHash,
          invitee,
          "second@example.test",
        ]),
      ),
    ).rejects.toMatchObject({ code: "P0002" });
  });

  it("meters a key atomically and returns 429 semantics at the fixed-window boundary", async () => {
    const keyHash = "a".repeat(64);
    await appTx(pool, orgOwner, async (client) =>
      client.query(
        "INSERT INTO public.api_keys(organization_id,name,prefix,key_hash,created_by_user_id) VALUES ($1,'Verification','hp_live_test',$2,$3)",
        [organizationId, keyHash, orgOwner],
      ),
    );
    for (let i = 0; i < 60; i += 1) {
      const result = await appTx(pool, "public-api", async (client) =>
        client.query("SELECT * FROM public.hermes_consume_api_key($1,'v1/verify',$2,200)", [
          keyHash,
          `request-${i}`,
        ]),
      );
      expect(result.rows[0]?.allowed).toBe(true);
    }
    const limited = await appTx(pool, "public-api", async (client) =>
      client.query("SELECT * FROM public.hermes_consume_api_key($1,'v1/verify','request-61',200)", [
        keyHash,
      ]),
    );
    expect(limited.rows[0]).toMatchObject({ allowed: false, retry_after_seconds: 60 });
  });

  it("deduplicates system billing events and appends one comms audit", async () => {
    const digest = Buffer.alloc(32, 3);
    const first = await appTx(pool, "billing-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:billing')");
      return client.query(
        "SELECT public.hermes_record_billing_event($1,'evt_product_1','cus_product','customer.subscription.updated',$2) AS inserted",
        [organizationId, digest],
      );
    });
    const second = await appTx(pool, "billing-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:billing')");
      return client.query(
        "SELECT public.hermes_record_billing_event($1,'evt_product_1','cus_product','customer.subscription.updated',$2) AS inserted",
        [organizationId, digest],
      );
    });
    expect(first.rows[0]?.inserted).toBe(true);
    expect(second.rows[0]?.inserted).toBe(false);

    const message = await appTx(pool, "comms-worker", async (client) => {
      await client.query("SELECT public.hermes_set_productization_claim('system:comms')");
      return client.query(
        "SELECT * FROM public.hermes_insert_agent_message($1,$2,'buyer@example.test','product-agent@agents.hermespass.asia','Hello','Bounded body','provider-1',$3)",
        [organizationId, agentId, digest],
      );
    });
    expect(message.rows[0]).toMatchObject({ agent_id: agentId, inserted: true });
    const audit = await appTx(pool, orgOwner, async (client) =>
      client.query(
        "SELECT action, actor_id FROM public.agent_audit_logs WHERE organization_id = $1 ORDER BY id",
        [organizationId],
      ),
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "organization.created",
        "billing.subscription.updated",
        "email.receive",
      ]),
    );
    expect(audit.rows.find((row) => row.action === "email.receive")?.actor_id).toBe("system:comms");
  });

  it("keeps the audit chain valid after system events", async () => {
    const verified = await appTx(pool, orgOwner, async (client) =>
      client.query("SELECT * FROM public.hermes_verify_audit_chain($1)", [organizationId]),
    );
    expect(verified.rows[0]?.valid).toBe(true);
  });
});
