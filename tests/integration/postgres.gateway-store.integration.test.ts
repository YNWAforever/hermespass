import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import type { Transaction } from "@/lib/db";
import {
  decideGatewayRequestWithStore,
  type GatewayStore,
  type GatewayTransactionPort,
} from "@/lib/gateway/service";
import { createPostgresGatewayStore } from "@/lib/gateway/postgres-store";
import { generateEd25519KeyPair } from "@/lib/identity/keys";
import {
  canonicalGatewayActionBytes,
  type GatewayActionV1,
  type SignedGatewayRequest,
} from "@/lib/policy/action";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;
const cryptoApi = globalThis.crypto ?? webcrypto;

if (databaseRequired) {
  describe("PostgreSQL production gateway-store test configuration", () => {
    it("requires DATABASE_URL_TEST", () => {
      expect(databaseUrl, "DATABASE_URL_TEST is required for bun run test:db").toBeTruthy();
    });
  });
}

const migrations = [
  "0000_low_human_robot.sql",
  "0001_phase1_security_hardening.sql",
  "0002_policy_gateway.sql",
  "0003_gateway_auth_boundary.sql",
].map((name) => join(process.cwd(), "drizzle", name));

type SigningPair = Awaited<ReturnType<typeof generateEd25519KeyPair>>;

type GatewayFixture = {
  organizationId: string;
  ownerId: string;
  agentId: string;
  agentDid: string;
  keyId: string;
  pair: SigningPair;
};

async function resetAndMigrate(pool: Pool): Promise<void> {
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
    for (const migrationPath of migrations) {
      const migration = await readFile(migrationPath, "utf8");
      await client.query("BEGIN");
      try {
        for (const statement of migration.split("--> statement-breakpoint")) {
          const migrationSql = statement.trim();
          if (migrationSql) await client.query(migrationSql);
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } finally {
    await client.query("RESET ROLE").catch(() => undefined);
    client.release();
  }
}

async function appTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    const result = await operation(client);
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

async function seedGatewayAgent(
  pool: Pool,
  limits: {
    perTransaction?: number;
    daily?: number;
    monthly?: number;
    approvalThreshold?: number;
  } = {},
): Promise<GatewayFixture> {
  const pair = await generateEd25519KeyPair();
  const organizationId = crypto.randomUUID();
  const ownerId = `gateway-store-owner-${crypto.randomUUID()}`;
  const agentDid = `did:web:gateway-store.test:agents:${crypto.randomUUID()}`;
  const slug = `gateway-store-${crypto.randomUUID()}`;
  const perTransaction = limits.perTransaction ?? 10_000;
  const daily = limits.daily ?? 10_000;
  const monthly = limits.monthly ?? 100_000;
  const approvalThreshold = limits.approvalThreshold ?? perTransaction;

  await pool.query(
    "INSERT INTO public.organizations (id, name, slug) VALUES ($1, 'Gateway store org', $2)",
    [organizationId, `gateway-store-org-${crypto.randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO public.org_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [organizationId, ownerId],
  );
  const agent = await pool.query<{ id: string }>(
    `INSERT INTO public.agents (
      organization_id, slug, did, name, role, risk, scopes, spend_cap_cents,
      credential_id, credential_jws, issued_at, expires_at, status, created_by
    ) VALUES (
      $1, $2, $3, 'Production gateway test agent', 'operator', 'low',
      ARRAY['vendor.contract', 'catalog.read', 'crm.read']::text[], 100000,
      $4, 'signed-credential', now(), now() + interval '1 day', 'active', 'integration-test'
    ) RETURNING id`,
    [organizationId, slug, agentDid, `credential-${crypto.randomUUID()}`],
  );
  const agentId = agent.rows[0]!.id;
  const publicJwk = {
    ...pair.publicJwk,
    kid: `${agentDid}#external-1`,
  };
  const key = await pool.query<{ id: string }>(
    `INSERT INTO public.agent_keys (
      agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status
    ) VALUES ($1, $2, $3, $4::jsonb, $5, 'external', 'active') RETURNING id`,
    [agentId, organizationId, `key-${pair.thumbprint}`, JSON.stringify(publicJwk), pair.thumbprint],
  );
  await pool.query(
    `INSERT INTO public.agent_policies (
      organization_id, agent_id, version, currency,
      per_transaction_limit_cents, daily_limit_cents, monthly_limit_cents,
      approval_threshold_cents, mcc_allowlist, mcc_required,
      assigned_reviewer_user_id, created_by_user_id
    ) VALUES ($1, $2, 1, 'HKD', $3, $4, $5, $6,
      ARRAY['7399']::text[], true, $7, $7)`,
    [organizationId, agentId, perTransaction, daily, monthly, approvalThreshold, ownerId],
  );

  return {
    organizationId,
    ownerId,
    agentId,
    agentDid,
    keyId: key.rows[0]!.id,
    pair,
  };
}

function productionStore(pool: Pool): GatewayStore {
  const database = drizzle(pool, { schema });
  return createPostgresGatewayStore(
    async <T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw("SET LOCAL ROLE hermes_app"));
        return callback(transaction as unknown as Transaction);
      }),
  );
}

async function signAction(
  fixture: GatewayFixture,
  overrides: Partial<GatewayActionV1> = {},
): Promise<SignedGatewayRequest> {
  const action: GatewayActionV1 = {
    version: "1",
    agentDid: fixture.agentDid,
    keyId: fixture.keyId,
    tool: "vendor.contract",
    summary: "Authorize the production PostgreSQL gateway digest",
    justification: null,
    payloadDigest: Buffer.alloc(32, 41).toString("base64url"),
    amountCents: 1_000,
    currency: "HKD",
    merchantCategoryCode: "7399",
    nonce: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
  const privateKey = await cryptoApi.subtle.importKey(
    "jwk",
    fixture.pair.privateJwk,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = Buffer.from(
    await cryptoApi.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      canonicalGatewayActionBytes(action),
    ),
  ).toString("base64url");
  return { action, signature };
}

function pauseFirstAuthLookup(store: GatewayStore): {
  store: GatewayStore;
  reached: Promise<void>;
  release: () => void;
} {
  let markReached!: () => void;
  let release!: () => void;
  let firstLookup = true;
  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    reached,
    release,
    store: {
      transaction: <T>(callback: (transaction: GatewayTransactionPort) => Promise<T>) =>
        store.transaction((transaction) => {
          const wrapped = new Proxy(transaction, {
            get(target, property) {
              if (property === "lookupAuthContext") {
                return async (agentDid: string, keyId: string) => {
                  const context = await target.lookupAuthContext(agentDid, keyId);
                  if (firstLookup) {
                    firstLookup = false;
                    markReached();
                    await released;
                  }
                  return context;
                };
              }
              const value = Reflect.get(target, property, target) as unknown;
              return typeof value === "function" ? value.bind(target) : value;
            },
          });
          return callback(wrapped);
        }),
    },
  };
}

dbTest("production PostgreSQL gateway transaction", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 10 });
    await resetAndMigrate(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("persists one exact replay and rejects changed signed bytes for the same nonce", async () => {
    const fixture = await seedGatewayAgent(pool);
    const store = productionStore(pool);
    const signed = await signAction(fixture);

    const first = await decideGatewayRequestWithStore(signed, store);
    const replay = await decideGatewayRequestWithStore(signed, store);
    const changed = await signAction(fixture, {
      nonce: signed.action.nonce,
      summary: "Changed bytes under the same nonce",
    });

    expect(replay).toEqual(first);
    await expect(decideGatewayRequestWithStore(changed, store)).rejects.toMatchObject({
      code: "NONCE_CONFLICT",
      status: 409,
    });
    const stored = await pool.query<{ requests: string; audits: string }>(
      `SELECT
        (SELECT count(*) FROM public.gateway_requests WHERE agent_id = $1)::text AS requests,
        (SELECT count(*) FROM public.agent_audit_logs
          WHERE agent_id = $1 AND action = 'gateway.decision')::text AS audits`,
      [fixture.agentId],
    );
    expect(stored.rows).toEqual([{ requests: "1", audits: "1" }]);
  });

  it("serializes concurrent near-cap signed requests so only one can spend", async () => {
    const fixture = await seedGatewayAgent(pool, { daily: 10_000, monthly: 100_000 });
    const store = productionStore(pool);
    const first = await signAction(fixture, { amountCents: 6_000 });
    const second = await signAction(fixture, { amountCents: 6_000 });

    const decisions = await Promise.all([
      decideGatewayRequestWithStore(first, store),
      decideGatewayRequestWithStore(second, store),
    ]);

    expect(decisions.map(({ decision }) => decision).sort()).toEqual(["allow", "deny"]);
    expect(decisions.map(({ reasonCode }) => reasonCode).sort()).toEqual([
      "DAILY_LIMIT_EXCEEDED",
      "POLICY_ALLOWED",
    ]);
    const spend = await pool.query<{ authorized: string; requests: string }>(
      `SELECT coalesce(sum(amount_cents) FILTER (
          WHERE current_decision = 'allow'
        ), 0)::text AS authorized, count(*)::text AS requests
       FROM public.gateway_requests WHERE agent_id = $1`,
      [fixture.agentId],
    );
    expect(spend.rows).toEqual([{ authorized: "6000", requests: "2" }]);
  });

  it("creates one pending approval and exactly two chained audit events for a hold", async () => {
    const fixture = await seedGatewayAgent(pool, { approvalThreshold: 5_000 });
    const decision = await decideGatewayRequestWithStore(
      await signAction(fixture, { amountCents: 6_000 }),
      productionStore(pool),
    );

    expect(decision).toMatchObject({
      decision: "hold",
      reasonCode: "APPROVAL_REQUIRED",
      approvalId: expect.any(String),
    });
    const stored = await pool.query<{ approvals: string; audits: string; actions: string[] }>(
      `SELECT
        (SELECT count(*) FROM public.pending_approvals WHERE agent_id = $1)::text AS approvals,
        count(*)::text AS audits,
        array_agg(action ORDER BY id) AS actions
       FROM public.agent_audit_logs WHERE agent_id = $1`,
      [fixture.agentId],
    );
    expect(stored.rows).toEqual([
      { approvals: "1", audits: "2", actions: ["gateway.decision", "approval.created"] },
    ]);
  });

  it("rolls back the request when the transactional audit append fails", async () => {
    const fixture = await seedGatewayAgent(pool);
    const nonce = crypto.randomUUID();
    await pool.query(`
      CREATE FUNCTION public.task4_fail_gateway_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'gateway.decision' AND NEW.tool = 'crm.read' THEN
          RAISE EXCEPTION 'task4 injected audit failure';
        END IF;
        RETURN NEW;
      END $$
    `);
    await pool.query(`
      CREATE TRIGGER task4_fail_gateway_audit
      BEFORE INSERT ON public.agent_audit_logs
      FOR EACH ROW EXECUTE FUNCTION public.task4_fail_gateway_audit()
    `);

    try {
      await expect(
        decideGatewayRequestWithStore(
          await signAction(fixture, {
            tool: "crm.read",
            amountCents: null,
            currency: null,
            merchantCategoryCode: null,
            nonce,
          }),
          productionStore(pool),
        ),
      ).rejects.toEqual(expect.any(Error));
    } finally {
      await pool.query("DROP TRIGGER task4_fail_gateway_audit ON public.agent_audit_logs");
      await pool.query("DROP FUNCTION public.task4_fail_gateway_audit()");
    }

    const stored = await pool.query<{ requests: string; audits: string }>(
      `SELECT
        (SELECT count(*) FROM public.gateway_requests WHERE agent_id = $1 AND nonce = $2)::text
          AS requests,
        (SELECT count(*) FROM public.agent_audit_logs WHERE agent_id = $1)::text AS audits`,
      [fixture.agentId, nonce],
    );
    expect(stored.rows).toEqual([{ requests: "0", audits: "0" }]);
  });

  it("finishes BYOK enrollment while production gateway auth is paused, then audits revoked-key denial", async () => {
    const fixture = await seedGatewayAgent(pool);
    const tokenHash = createHash("sha256")
      .update(`gateway-rotation-${crypto.randomUUID()}`)
      .digest();
    await pool.query(
      `INSERT INTO public.agent_key_enrollments (
        organization_id, agent_id, token_hash, expires_at, created_by_user_id, created_at
      ) VALUES ($1, $2, $3, now() + interval '15 minutes', $4, now())`,
      [fixture.organizationId, fixture.agentId, tokenHash, fixture.ownerId],
    );
    const nextPair = await generateEd25519KeyPair();
    const paused = pauseFirstAuthLookup(productionStore(pool));
    const gateway = decideGatewayRequestWithStore(await signAction(fixture), paused.store);

    await Promise.race([
      paused.reached,
      gateway.then(
        () => Promise.reject(new Error("gateway finished before auth pause")),
        (error) => Promise.reject(error),
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("gateway did not reach auth pause")), 2_000),
      ),
    ]);
    const enrollment = appTransaction(pool, (client) =>
      client.query<{ key_id: string }>(
        `SELECT key_id FROM public.hermes_consume_agent_key_enrollment(
          $1, $2, $3::jsonb, $4
        )`,
        [
          tokenHash,
          `key-${nextPair.thumbprint}`,
          JSON.stringify({ ...nextPair.publicJwk, kid: `${fixture.agentDid}#external-2` }),
          nextPair.thumbprint,
        ],
      ),
    );
    const enrollmentFinishedBeforeRelease = await Promise.race([
      enrollment.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    paused.release();

    expect(enrollmentFinishedBeforeRelease).toBe(true);
    const [decision, enrollmentResult] = await Promise.all([gateway, enrollment]);
    expect(enrollmentResult.rows[0]?.key_id).toEqual(expect.any(String));
    expect(decision).toMatchObject({
      decision: "deny",
      reasonCode: "AGENT_KEY_INACTIVE",
    });
    const stored = await pool.query<{ requests: string; audits: string }>(
      `SELECT
        (SELECT count(*) FROM public.gateway_requests WHERE agent_id = $1)::text AS requests,
        (SELECT count(*) FROM public.agent_audit_logs
          WHERE agent_id = $1 AND action = 'gateway.decision')::text AS audits`,
      [fixture.agentId],
    );
    expect(stored.rows).toEqual([{ requests: "1", audits: "1" }]);
  }, 15_000);
});
