import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;

if (databaseRequired) {
  describe("PostgreSQL gateway-auth test configuration", () => {
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

type Fixtures = {
  organizationId: string;
  ownerId: string;
  agentId: string;
  agentDid: string;
  externalKeyId: string;
  legacyKeyId: string;
  otherOrganizationId: string;
  otherAgentId: string;
  otherAgentDid: string;
  otherExternalKeyId: string;
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
          const sql = statement.trim();
          if (sql) await client.query(sql);
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

async function seed(pool: Pool): Promise<Fixtures> {
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const ownerId = `gateway-owner-${crypto.randomUUID()}`;
  const agentDid = `did:web:gateway.test:agents:${crypto.randomUUID()}`;
  const otherAgentDid = `did:web:gateway.test:agents:${crypto.randomUUID()}`;

  await pool.query(
    `INSERT INTO public.organizations (id, name, slug) VALUES
      ($1, 'Gateway auth org', $2), ($3, 'Other gateway org', $4)`,
    [
      organizationId,
      `gateway-auth-${crypto.randomUUID()}`,
      otherOrganizationId,
      `gateway-other-${crypto.randomUUID()}`,
    ],
  );
  await pool.query(
    `INSERT INTO public.org_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner')`,
    [organizationId, ownerId],
  );
  const agents = await pool.query<{ id: string; did: string }>(
    `INSERT INTO public.agents (
      organization_id, slug, did, name, role, risk, scopes, spend_cap_cents,
      credential_id, credential_jws, issued_at, expires_at, status, created_by
    ) VALUES
      ($1, $2, $3, 'Revoked gateway agent', 'operator', 'high',
       ARRAY['vendor.contract']::text[], 100000, $4, 'signed-credential',
       now() - interval '1 day', now() - interval '1 minute', 'revoked', 'integration-test'),
      ($5, $6, $7, 'Other gateway agent', 'operator', 'low',
       ARRAY['catalog.read']::text[], 100000, $8, 'signed-credential',
       now(), now() + interval '1 day', 'active', 'integration-test')
     RETURNING id, did`,
    [
      organizationId,
      `gateway-agent-${crypto.randomUUID()}`,
      agentDid,
      `credential-${crypto.randomUUID()}`,
      otherOrganizationId,
      `gateway-other-agent-${crypto.randomUUID()}`,
      otherAgentDid,
      `credential-${crypto.randomUUID()}`,
    ],
  );
  const agentId = agents.rows.find((row) => row.did === agentDid)!.id;
  const otherAgentId = agents.rows.find((row) => row.did === otherAgentDid)!.id;
  const publicJwk = JSON.stringify({
    kty: "OKP",
    crv: "Ed25519",
    x: Buffer.alloc(32, 17).toString("base64url"),
  });
  const otherPublicJwk = JSON.stringify({
    kty: "OKP",
    crv: "Ed25519",
    x: Buffer.alloc(32, 19).toString("base64url"),
  });
  const externalKey = await pool.query<{ id: string }>(
    `INSERT INTO public.agent_keys (
      agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status
    ) VALUES ($1, $2, 'external-revoked', $3::jsonb, $4, 'external', 'revoked')
    RETURNING id`,
    [agentId, organizationId, publicJwk, `thumbprint-${crypto.randomUUID()}`],
  );
  const otherExternalKey = await pool.query<{ id: string }>(
    `INSERT INTO public.agent_keys (
      agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status
    ) VALUES ($1, $2, 'external-active', $3::jsonb, $4, 'external', 'active')
    RETURNING id`,
    [otherAgentId, otherOrganizationId, otherPublicJwk, `thumbprint-${crypto.randomUUID()}`],
  );
  const legacyKey = await pool.query<{ id: string }>(
    `INSERT INTO public.agent_keys (
      agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status,
      ciphertext, iv, wrapped_dek, kek_version, encryption_algorithm
    ) VALUES (
      $1, $2, 'legacy-encrypted', $3::jsonb, $4, 'legacy_encrypted', 'revoked',
      '\\x01', '\\x02', '\\x03', 'v1', 'A256GCM+A256KW'
    ) RETURNING id`,
    [agentId, organizationId, publicJwk, `legacy-thumbprint-${crypto.randomUUID()}`],
  );

  return {
    organizationId,
    ownerId,
    agentId,
    agentDid,
    externalKeyId: externalKey.rows[0]!.id,
    legacyKeyId: legacyKey.rows[0]!.id,
    otherOrganizationId,
    otherAgentId,
    otherAgentDid,
    otherExternalKeyId: otherExternalKey.rows[0]!.id,
  };
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

dbTest("PostgreSQL gateway signature-authenticated boundary", () => {
  let pool: Pool;
  let fixtures: Fixtures;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 3 });
    await resetAndMigrate(pool);
    fixtures = await seed(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("keeps both functions SECURITY DEFINER, pinned, and executable only by the runtime role", async () => {
    const functions = await pool.query<{
      name: string;
      security_definer: boolean;
      configuration: string[];
      acl: string;
    }>(
      `SELECT proname AS name, prosecdef AS security_definer,
        COALESCE(proconfig, ARRAY[]::text[]) AS configuration,
        COALESCE(proacl::text, '') AS acl
       FROM pg_proc
       WHERE oid IN (
         'public.hermes_gateway_auth_context(text,uuid)'::regprocedure,
         'public.hermes_lock_gateway_signature_agent(uuid,uuid,uuid)'::regprocedure,
         'public.hermes_set_signature_authenticated_agent_claim(uuid,uuid,uuid)'::regprocedure
       ) ORDER BY proname`,
    );

    expect(functions.rows).toHaveLength(3);
    for (const routine of functions.rows) {
      expect(routine.security_definer).toBe(true);
      expect(routine.configuration).toContain("search_path=pg_catalog, public, pg_temp");
      expect(routine.acl).toContain("hermes_app=X/");
      expect(routine.acl).not.toMatch(/(^|,)=[^,]*X/);
    }
  });

  it("returns only an exact external historical key context and fails closed on mismatches", async () => {
    await appTransaction(pool, async (client) => {
      const direct = await client.query("SELECT id FROM public.agent_keys");
      expect(direct.rows).toEqual([]);

      const safe = await client.query("SELECT * FROM public.hermes_gateway_auth_context($1, $2)", [
        fixtures.agentDid,
        fixtures.externalKeyId,
      ]);
      expect(safe.rows).toHaveLength(1);
      expect(Object.keys(safe.rows[0]!).sort()).toEqual(
        [
          "agent_id",
          "agent_status",
          "key_id",
          "key_status",
          "organization_id",
          "passport_expires_at",
          "public_jwk",
          "risk",
          "scopes",
          "spend_cap_cents",
          "thumbprint",
        ].sort(),
      );
      expect(safe.rows[0]).toMatchObject({
        agent_id: fixtures.agentId,
        organization_id: fixtures.organizationId,
        key_id: fixtures.externalKeyId,
        agent_status: "revoked",
        key_status: "revoked",
      });
      expect(JSON.stringify(safe.rows[0])).not.toMatch(/ciphertext|wrapped_dek|private_jwk/i);

      const crossTenant = await client.query(
        "SELECT * FROM public.hermes_gateway_auth_context($1, $2)",
        [fixtures.agentDid, fixtures.otherExternalKeyId],
      );
      const legacy = await client.query(
        "SELECT * FROM public.hermes_gateway_auth_context($1, $2)",
        [fixtures.agentDid, fixtures.legacyKeyId],
      );
      const unknown = await client.query(
        "SELECT * FROM public.hermes_gateway_auth_context($1, $2)",
        ["did:web:gateway.test:agents:unknown", fixtures.externalKeyId],
      );
      expect(crossTenant.rows).toEqual([]);
      expect(legacy.rows).toEqual([]);
      expect(unknown.rows).toEqual([]);
    });
  });

  it("lets a verified historical signature claim write one audited lifecycle denial", async () => {
    const requestId = await appTransaction(pool, async (client) => {
      await client.query(
        "SELECT public.hermes_set_signature_authenticated_agent_claim($1, $2, $3)",
        [fixtures.agentId, fixtures.organizationId, fixtures.externalKeyId],
      );
      const claim = await client.query(
        `SELECT public.hermes_current_agent_id() AS agent_id,
          public.hermes_current_agent_organization_id() AS organization_id,
          public.hermes_current_agent_key_id() AS key_id`,
      );
      expect(claim.rows[0]).toEqual({
        agent_id: fixtures.agentId,
        organization_id: fixtures.organizationId,
        key_id: fixtures.externalKeyId,
      });
      await client.query("SELECT public.hermes_lock_gateway_decision($1)", [fixtures.agentId]);
      const request = await client.query<{ id: string }>(
        `INSERT INTO public.gateway_requests (
          organization_id, agent_id, key_id, nonce, request_digest, payload_digest,
          signature_digest, action_version, tool, summary, justification,
          amount_cents, currency, merchant_category_code, signed_at, received_at,
          decision, current_decision, reason_code, reason, policy_version,
          decided_at, current_result_updated_at, authorized_at, authorization_expires_at
        ) VALUES (
          $1, $2, $3, $4, decode(repeat('11', 32), 'hex'),
          decode(repeat('22', 32), 'hex'), decode(repeat('33', 32), 'hex'),
          '1', 'vendor.contract', 'Signed lifecycle denial', NULL,
          10000, 'HKD', '7399', now(), now(), 'deny', 'deny',
          'PASSPORT_INACTIVE', 'The agent passport is inactive.', NULL,
          now(), now(), NULL, NULL
        ) RETURNING id`,
        [fixtures.organizationId, fixtures.agentId, fixtures.externalKeyId, crypto.randomUUID()],
      );
      await client.query(
        `INSERT INTO public.agent_audit_logs (
          organization_id, agent_id, actor_type, actor_id, action, summary,
          decision, tool, amount_cents, payload, occurred_at, hash
        ) VALUES (
          $1::uuid, $2::uuid, 'agent', $2::uuid::text, 'gateway.decision',
          'Gateway decision: PASSPORT_INACTIVE', 'deny', 'vendor.contract', 10000,
          jsonb_build_object('requestId', $3::text, 'reasonCode', 'PASSPORT_INACTIVE'),
          now(), decode(repeat('00', 32), 'hex')
        )`,
        [fixtures.organizationId, fixtures.agentId, request.rows[0]!.id],
      );
      return request.rows[0]!.id;
    });

    const stored = await pool.query(
      `SELECT request.current_decision, request.reason_code, audit.action,
        audit.actor_type, octet_length(audit.hash) AS hash_bytes, audit.payload
       FROM public.gateway_requests request
       JOIN public.agent_audit_logs audit
         ON audit.organization_id = request.organization_id
        AND audit.agent_id = request.agent_id
       WHERE request.id = $1`,
      [requestId],
    );
    expect(stored.rows).toEqual([
      expect.objectContaining({
        current_decision: "deny",
        reason_code: "PASSPORT_INACTIVE",
        action: "gateway.decision",
        actor_type: "agent",
        hash_bytes: 32,
      }),
    ]);
    expect(JSON.stringify(stored.rows[0]!.payload)).not.toMatch(
      /justification|private|parameters/i,
    );

    const verification = await appTransaction(pool, async (client) => {
      await client.query("SELECT set_config('hermes.user_id', $1, true)", [fixtures.ownerId]);
      return client.query<{ valid: boolean; checked: string; first_invalid: string | null }>(
        "SELECT * FROM public.hermes_verify_audit_chain($1)",
        [fixtures.organizationId],
      );
    });
    expect(verification.rows).toEqual([{ valid: true, checked: "1", first_invalid: null }]);
  });

  it("keeps lookup non-locking and serializes lifecycle mutation behind the locked claim", async () => {
    const lookup = await pool.connect();
    const writer = await pool.connect();
    let update: Promise<unknown> | undefined;

    try {
      await lookup.query("SET ROLE hermes_app");
      await lookup.query("BEGIN");
      await lookup.query("SELECT * FROM public.hermes_gateway_auth_context($1, $2)", [
        fixtures.otherAgentDid,
        fixtures.otherExternalKeyId,
      ]);

      await writer.query("BEGIN");
      await writer.query(
        `UPDATE public.agent_keys SET status = 'revoked', revoked_at = clock_timestamp()
         WHERE id = $1`,
        [fixtures.otherExternalKeyId],
      );
      await writer.query("ROLLBACK");

      await lookup.query("SELECT public.hermes_lock_gateway_signature_agent($1, $2, $3)", [
        fixtures.otherAgentId,
        fixtures.otherOrganizationId,
        fixtures.otherExternalKeyId,
      ]);
      await lookup.query(
        "SELECT public.hermes_set_signature_authenticated_agent_claim($1, $2, $3)",
        [fixtures.otherAgentId, fixtures.otherOrganizationId, fixtures.otherExternalKeyId],
      );

      await writer.query("BEGIN");
      const pid = await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      update = writer.query(
        `/* task4_lifecycle_lock */
         UPDATE public.agent_keys SET status = 'revoked', revoked_at = clock_timestamp()
         WHERE id = $1`,
        [fixtures.otherExternalKeyId],
      );

      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const activity = await pool.query<{ waiting: boolean }>(
          `SELECT wait_event_type = 'Lock'
             AND position('task4_lifecycle_lock' in query) > 0 AS waiting
           FROM pg_stat_activity WHERE pid = $1`,
          [pid.rows[0]!.pid],
        );
        if (activity.rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await pool.query("SELECT pg_sleep(0.01)");
      }
      expect(waiting).toBe(true);

      await lookup.query("COMMIT");
      await update;
      await writer.query("ROLLBACK");
    } finally {
      await lookup.query("ROLLBACK").catch(() => undefined);
      await lookup.query("RESET ROLE").catch(() => undefined);
      await update?.catch(() => undefined);
      await writer.query("ROLLBACK").catch(() => undefined);
      lookup.release();
      writer.release();
    }
  });

  it("keeps the historical claim transaction-local and rejects legacy or mismatched tuples", async () => {
    const client = await pool.connect();
    try {
      await client.query("SET ROLE hermes_app");
      await client.query("BEGIN");
      await client.query(
        "SELECT public.hermes_set_signature_authenticated_agent_claim($1, $2, $3)",
        [fixtures.agentId, fixtures.organizationId, fixtures.externalKeyId],
      );
      await client.query("COMMIT");
      await client.query("BEGIN");
      const cleared = await client.query("SELECT public.hermes_current_agent_id() AS agent_id");
      expect(cleared.rows).toEqual([{ agent_id: null }]);
      await client.query("ROLLBACK");

      for (const tuple of [
        [fixtures.agentId, fixtures.organizationId, fixtures.legacyKeyId],
        [fixtures.agentId, fixtures.otherOrganizationId, fixtures.externalKeyId],
        [fixtures.otherAgentId, fixtures.organizationId, fixtures.externalKeyId],
      ]) {
        await client.query("BEGIN");
        await expect(
          client.query(
            "SELECT public.hermes_set_signature_authenticated_agent_claim($1, $2, $3)",
            tuple,
          ),
        ).rejects.toMatchObject({ code: "P0002" });
        await client.query("ROLLBACK");
      }

      await client.query("BEGIN");
      await expect(
        client.query("SELECT public.hermes_set_verified_agent_claim($1, $2, $3)", [
          fixtures.agentId,
          fixtures.organizationId,
          fixtures.externalKeyId,
        ]),
      ).rejects.toMatchObject({ code: "P0002" });
      await client.query("ROLLBACK");
    } finally {
      await client.query("RESET ROLE").catch(() => undefined);
      client.release();
    }
  });
});
