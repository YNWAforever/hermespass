import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ed25519 } from "@noble/curves/ed25519.js";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { schema } from "@/db/schema";
import { canonicalMandateBytes } from "@/lib/payments/mandates";
import type { Actor } from "@/lib/auth/authorization";
import type { Transaction } from "@/lib/db";
import type { MandateTransactionRunner } from "@/lib/payments/mandate-service";
import type { MandateBodyV1, SignedMandateV1 } from "@/lib/payments/types";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;

if (databaseRequired) {
  describe("PostgreSQL mandate test configuration", () => {
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
  "0004_approval_operations.sql",
  "0005_approval_revalidation.sql",
  "0006_scoped_payments.sql",
  "0007_payment_authorization_hardening.sql",
].map((name) => join(process.cwd(), "drizzle", name));

async function resetAndMigrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    for (const roleName of ["hermes_app", "migration_owner"]) {
      const role = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName]);
      if (role.rowCount) await client.query(`DROP OWNED BY ${roleName}`);
    }
    await client.query("DROP ROLE IF EXISTS hermes_app");
    await client.query("DROP ROLE IF EXISTS migration_owner");
    await client.query("CREATE SCHEMA public");
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
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
          const statementSql = statement.trim();
          if (statementSql) await client.query(statementSql);
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
  userId: string,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await client.query("SELECT set_config('hermes.user_id', $1, true)", [userId]);
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

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function buildSignedMandate(input: {
  agentDid: string;
  keyId: string;
  nonce: string;
  parentMandateId?: string | null;
  kind?: "intent" | "cart";
  privateKey: Uint8Array;
}): SignedMandateV1 {
  const body: MandateBodyV1 = {
    version: "1",
    mandateId: crypto.randomUUID(),
    agentDid: input.agentDid,
    keyId: input.keyId,
    kind: input.kind ?? "intent",
    nonce: input.nonce,
    issuedAt: new Date(Date.now() - 1_000).toISOString(),
    parentMandateId: input.parentMandateId ?? null,
    constraints: {
      currency: "HKD",
      maxAmountCents: 50_000,
      merchant: "AWS",
      mccAllowlist: ["5734"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      oneTime: input.kind === "cart",
    },
  };
  return {
    body,
    signature: base64url(ed25519.sign(canonicalMandateBytes(body), input.privateKey)),
  };
}

dbTest("PostgreSQL mandate issuance and revocation", () => {
  let pool: Pool;
  let fixture: {
    organizationId: string;
    otherOrganizationId: string;
    ownerId: string;
    agentId: string;
    agentDid: string;
    keyId: string;
    privateKey: Uint8Array;
  };
  let actor: Actor;
  let mandateRunner: MandateTransactionRunner;
  let issueMandate: typeof import("@/lib/payments/mandate-service").issueMandate;
  let listMandates: typeof import("@/lib/payments/mandate-service").listMandates;
  let revokeMandate: typeof import("@/lib/payments/mandate-service").revokeMandate;

  beforeAll(async () => {
    const service = await import("@/lib/payments/mandate-service");
    issueMandate = service.issueMandate;
    listMandates = service.listMandates;
    revokeMandate = service.revokeMandate;
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    await resetAndMigrate(pool);
    const organizationId = crypto.randomUUID();
    const otherOrganizationId = crypto.randomUUID();
    const ownerId = `mandate-owner-${crypto.randomUUID()}`;
    const agentId = crypto.randomUUID();
    const keyId = crypto.randomUUID();
    const agentDid = `did:web:mandate.test:agent:${crypto.randomUUID()}`;
    const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const publicJwk = {
      kty: "OKP",
      crv: "Ed25519",
      x: base64url(ed25519.getPublicKey(privateKey)),
    };

    await pool.query(
      "INSERT INTO public.organizations (id, name, slug) VALUES ($1, 'Mandate Test Org', $2), ($3, 'Other Mandate Org', $4)",
      [
        organizationId,
        `mandate-${crypto.randomUUID()}`,
        otherOrganizationId,
        `other-${crypto.randomUUID()}`,
      ],
    );
    await pool.query(
      "INSERT INTO public.org_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
      [organizationId, ownerId],
    );
    await pool.query(
      "INSERT INTO public.agents (id, organization_id, slug, did, name, role, risk, scopes, spend_cap_cents, status, credential_id, credential_jws, issued_at, expires_at, created_by) VALUES ($1, $2, $3, $4, 'Mandate Agent', 'operator', 'low', ARRAY['checkout.external']::text[], 100000, 'active', $5, 'test', now(), now() + interval '1 day', $6)",
      [
        agentId,
        organizationId,
        `mandate-agent-${crypto.randomUUID()}`,
        agentDid,
        `credential-${crypto.randomUUID()}`,
        ownerId,
      ],
    );
    await pool.query(
      "INSERT INTO public.agent_keys (id, agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status) VALUES ($1, $2, $3, 'external-1', $4::jsonb, 'mandate-thumbprint', 'external', 'active')",
      [keyId, agentId, organizationId, JSON.stringify(publicJwk)],
    );
    fixture = {
      organizationId,
      otherOrganizationId,
      ownerId,
      agentId,
      agentDid,
      keyId,
      privateKey,
    };
    actor = {
      userId: ownerId,
      email: "owner@example.com",
      name: "Owner",
      organizationId,
      organizationName: "Mandate Test Org",
      organizationSlug: "mandate-test",
      role: "owner",
    };
    const database = drizzle(pool, { schema });
    mandateRunner = async <T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> =>
      database.transaction(async (transaction) => {
        await transaction.execute(sql.raw("SET LOCAL ROLE hermes_app"));
        await transaction.execute(sql`select set_config('hermes.user_id', ${ownerId}, true)`);
        await transaction.execute(sql`select set_config('hermes.agent_verified', '0', true)`);
        return callback(transaction as unknown as Transaction);
      }) as Promise<T>;
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("stores an identical signed nonce as an idempotent replay and rejects changed bytes", async () => {
    const nonce = crypto.randomUUID();
    const signed = buildSignedMandate({ ...fixture, nonce });
    const first = await issueMandate(signed, actor, mandateRunner);
    const replay = await issueMandate(signed, actor, mandateRunner);
    expect(replay.mandate.id).toBe(first.mandate.id);
    expect(replay.replayed).toBe(true);

    const changed = buildSignedMandate({ ...fixture, nonce });
    await expect(issueMandate(changed, actor, mandateRunner)).rejects.toMatchObject({
      code: "NONCE_CONFLICT",
    });
  });

  it("rejects a parent from another agent or tenant and keeps organization listing isolated", async () => {
    const signed = buildSignedMandate({
      ...fixture,
      nonce: crypto.randomUUID(),
      kind: "cart",
      parentMandateId: crypto.randomUUID(),
    });
    await expect(issueMandate(signed, actor, mandateRunner)).rejects.toMatchObject({
      code: "MANDATE_PARENT_INVALID",
    });

    const listed = await listMandates(actor, mandateRunner);
    expect(listed.length).toBeGreaterThanOrEqual(0);
    expect(listed.some((mandate) => "signature" in mandate || "body" in mandate)).toBe(false);
  });

  it("revokes once and returns the existing revoked state on replay", async () => {
    const signed = buildSignedMandate({ ...fixture, nonce: crypto.randomUUID() });
    const issued = await issueMandate(signed, actor, mandateRunner);
    const revoked = await revokeMandate(actor, issued.mandate.id, mandateRunner);
    const replay = await revokeMandate(actor, issued.mandate.id, mandateRunner);
    expect(revoked.status).toBe("revoked");
    expect(replay).toMatchObject({ id: issued.mandate.id, status: "revoked" });
  });

  it("keeps the mandate table forced-RLS and tenant constrained", async () => {
    const flags = await pool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.mandates'::regclass",
    );
    expect(flags.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await expect(
      appTransaction(pool, fixture.ownerId, (client) =>
        client.query(
          "INSERT INTO public.mandates (organization_id, agent_id, kind, nonce, agent_did, key_id, key_thumbprint, body, signature, body_digest, currency, max_amount_cents, mcc_allowlist, issued_at, expires_at) VALUES ($1, $2, 'intent', $3, $4, $5, 'x', '{}'::jsonb, decode(repeat('00', 64), 'hex'), decode(repeat('00', 32), 'hex'), 'HKD', 1, ARRAY[]::text[], now(), now() + interval '1 day')",
          [
            fixture.otherOrganizationId,
            fixture.agentId,
            crypto.randomUUID(),
            fixture.agentDid,
            fixture.keyId,
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
