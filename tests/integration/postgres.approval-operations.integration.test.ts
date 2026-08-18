import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { schema } from "@/db/schema";
import { createPostgresApprovalMaintenanceStore } from "@/lib/approvals/maintenance-store";
import { createPostgresApprovalStore } from "@/lib/approvals/postgres-store";
import {
  runApprovalMaintenance,
  type ApprovalMaintenanceResult,
} from "@/lib/approvals/maintenance";
import { ApprovalServiceError, resolveApproval } from "@/lib/approvals/service";
import type { Transaction } from "@/lib/db";
import { createPostgresGatewayActivityStore } from "@/lib/gateway/activity-postgres-store";
import { generateEd25519KeyPair } from "@/lib/identity/keys";
import { createPostgresTelegramDeliveryStore } from "@/lib/telegram/delivery-store";

const databaseUrl = process.env["DATABASE_URL_TEST"];
const databaseRequired = process.env["DB_INTEGRATION_REQUIRED"] === "1";
const dbTest = databaseUrl ? describe.sequential : describe.skip;

if (databaseRequired) {
  describe("PostgreSQL approval operations test configuration", () => {
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
].map((name) => join(process.cwd(), "drizzle", name));

type Fixture = {
  organizationId: string;
  reviewerId: string;
  agentId: string;
  keyId: string;
  telegramId: number;
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
    for (const path of migrations) {
      const migration = await readFile(path, "utf8");
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
  userId: string | null,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE hermes_app");
    await client.query("BEGIN");
    await client.query("SELECT set_config('hermes.user_id', $1, true)", [userId ?? ""]);
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

function transactionRunner(pool: Pool, applicationName?: string) {
  const database = drizzle(pool, { schema });
  return async <T>(callback: (transaction: Transaction) => Promise<T>): Promise<T> =>
    database.transaction(async (transaction) => {
      await transaction.execute(sql.raw("SET LOCAL ROLE hermes_app"));
      if (applicationName) {
        await transaction.execute(
          sql`select set_config('application_name', ${applicationName}, true)`,
        );
      }
      return callback(transaction as unknown as Transaction);
    });
}

async function waitForApplicationLock(pool: Pool, applicationName: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const activity = await pool.query(
      `SELECT 1
       FROM pg_catalog.pg_stat_activity
       WHERE application_name = $1
         AND wait_event_type = 'Lock'`,
      [applicationName],
    );
    if (activity.rowCount) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Telegram resolution did not reach the identity-lock barrier");
}

async function seedFixture(pool: Pool, telegramId = 7_001_234_567): Promise<Fixture> {
  const pair = await generateEd25519KeyPair();
  const organizationId = crypto.randomUUID();
  const reviewerId = `approval-reviewer-${crypto.randomUUID()}`;

  await pool.query(
    "INSERT INTO public.organizations (id, name, slug) VALUES ($1, 'Approval org', $2)",
    [organizationId, `approval-org-${crypto.randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO public.org_members (
      organization_id, user_id, role, email_snapshot, name_snapshot
    ) VALUES ($1, $2, 'owner', 'reviewer@example.test', 'Approval reviewer')`,
    [organizationId, reviewerId],
  );
  const agent = await pool.query<{ id: string }>(
    `INSERT INTO public.agents (
      organization_id, slug, did, name, role, risk, scopes, spend_cap_cents,
      credential_id, credential_jws, issued_at, expires_at, status, created_by
    ) VALUES (
      $1, $2, $3, 'Approval integration agent', 'operator', 'low',
      ARRAY['vendor.contract']::text[], 100000, $4, 'signed-credential',
      now(), now() + interval '1 day', 'active', 'integration-test'
    ) RETURNING id`,
    [
      organizationId,
      `approval-agent-${crypto.randomUUID()}`,
      `did:web:approval.test:${crypto.randomUUID()}`,
      `credential-${crypto.randomUUID()}`,
    ],
  );
  const agentId = agent.rows[0]!.id;
  const key = await pool.query<{ id: string }>(
    `INSERT INTO public.agent_keys (
      agent_id, organization_id, key_fragment, public_jwk, thumbprint, custody, status
    ) VALUES ($1, $2, $3, $4::jsonb, $5, 'external', 'active') RETURNING id`,
    [
      agentId,
      organizationId,
      `key-${pair.thumbprint}`,
      JSON.stringify(pair.publicJwk),
      pair.thumbprint,
    ],
  );
  await pool.query(
    `INSERT INTO public.agent_policies (
      organization_id, agent_id, version, currency,
      per_transaction_limit_cents, daily_limit_cents, monthly_limit_cents,
      approval_threshold_cents, mcc_allowlist, mcc_required,
      assigned_reviewer_user_id, created_by_user_id
    ) VALUES (
      $1, $2, 1, 'HKD', 100000, 100000, 100000, 1000,
      ARRAY['7399']::text[], true, $3, $3
    )`,
    [organizationId, agentId, reviewerId],
  );
  await pool.query(
    `INSERT INTO public.telegram_links (
      organization_id, user_id, telegram_user_id, telegram_chat_id, is_active
    ) VALUES ($1, $2, $3, $3, true)`,
    [organizationId, reviewerId, telegramId],
  );
  return {
    organizationId,
    reviewerId,
    agentId,
    keyId: key.rows[0]!.id,
    telegramId,
  };
}

async function insertApproval(pool: Pool, fixture: Fixture, expired = false): Promise<string> {
  const request = await pool.query<{ id: string }>(
    `INSERT INTO public.gateway_requests (
      organization_id, agent_id, key_id, nonce, request_digest,
      payload_digest, signature_digest, action_version, tool, summary,
      amount_cents, currency, merchant_category_code, signed_at, received_at,
      decision, current_decision, reason_code, reason, policy_version,
      decided_at, current_result_updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, '1', 'vendor.contract',
      'Approval integration request', 25000, 'HKD', '7399', now(), now(),
      'hold', 'hold', 'APPROVAL_REQUIRED', 'Human approval is required.', 1,
      now(), now()
    ) RETURNING id`,
    [
      fixture.organizationId,
      fixture.agentId,
      fixture.keyId,
      crypto.randomUUID(),
      Buffer.alloc(32, 11),
      Buffer.alloc(32, 12),
      Buffer.alloc(32, 13),
    ],
  );
  const approval = await pool.query<{ id: string }>(
    `INSERT INTO public.pending_approvals (
      organization_id, agent_id, gateway_request_id, assigned_reviewer_user_id,
      status, expires_at, created_at
    ) VALUES (
      $1, $2, $3, $4, 'pending',
      CASE WHEN $5 THEN clock_timestamp() - interval '1 second'
           ELSE clock_timestamp() + interval '4 hours' END,
      CASE WHEN $5 THEN clock_timestamp() - interval '4 hours'
           ELSE clock_timestamp() END
    ) RETURNING id`,
    [fixture.organizationId, fixture.agentId, request.rows[0]!.id, fixture.reviewerId, expired],
  );
  return approval.rows[0]!.id;
}

async function verifyChain(pool: Pool, fixture: Fixture): Promise<void> {
  const verified = await appTransaction(pool, fixture.reviewerId, (client) =>
    client.query<{ valid: boolean }>("SELECT valid FROM public.hermes_verify_audit_chain($1)", [
      fixture.organizationId,
    ]),
  );
  expect(verified.rows).toEqual([{ valid: true }]);
}

dbTest("PostgreSQL Task 5 approval operations", () => {
  let pool: Pool;
  let fixture: Fixture;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 6 });
    await resetAndMigrate(pool);
    fixture = await seedFixture(pool);
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
  });

  it("reads tenant-scoped safe activity metadata and gateway aggregates", async () => {
    const activityFixture = await seedFixture(pool, 7_001_234_568);
    const approvalId = await insertApproval(pool, activityFixture);
    const store = createPostgresGatewayActivityStore(transactionRunner(pool));

    const result = await store.list(activityFixture.reviewerId, activityFixture.organizationId);
    const item = result.activity.find((entry) => entry.approvalId === approvalId);
    await resolveApproval(
      {
        approvalId,
        decision: "deny",
        source: "web",
        reason: "Task 6 integration fixture cleanup.",
        actorUserId: activityFixture.reviewerId,
      },
      createPostgresApprovalStore(transactionRunner(pool)),
    );

    expect(item).toMatchObject({
      agentId: activityFixture.agentId,
      approvalStatus: "pending",
      assignedReviewerUserId: activityFixture.reviewerId,
      assignedReviewerName: "Approval reviewer",
      assignedReviewerEmail: "reviewer@example.test",
      decision: "hold",
      requestDigest: expect.any(String),
      keyThumbprint: expect.any(String),
      policyVersion: 1,
      authorizationExpiresAt: null,
      telegramDeliveryState: "not_requested",
    });
    expect(item).not.toHaveProperty("payloadDigest");
    expect(item).not.toHaveProperty("signatureDigest");
    expect(result.aggregates).toMatchObject({
      actionsToday: 1,
      pendingHolds: 1,
      blockedSpendCents: 0,
      deniedCount: 0,
      decisionCounts: { allow: 0, hold: 1, deny: 0 },
    });
    expect(result.aggregates.trend).toHaveLength(18);

    const otherTenant = await seedFixture(pool, 7_001_234_569);
    const otherApprovalId = await insertApproval(pool, otherTenant);
    const otherVisible = await store.list(otherTenant.reviewerId, otherTenant.organizationId);
    expect(otherVisible.activity.some((entry) => entry.approvalId === otherApprovalId)).toBe(true);
    const isolated = await store.list(activityFixture.reviewerId, otherTenant.organizationId);
    await resolveApproval(
      {
        approvalId: otherApprovalId,
        decision: "deny",
        source: "web",
        reason: "Task 6 foreign-tenant fixture cleanup.",
        actorUserId: otherTenant.reviewerId,
      },
      createPostgresApprovalStore(transactionRunner(pool)),
    );
    expect(isolated.activity).toEqual([]);
    expect(isolated.aggregates).toMatchObject({
      actionsToday: 0,
      pendingHolds: 0,
      blockedSpendCents: 0,
      deniedCount: 0,
      decisionCounts: { allow: 0, hold: 0, deny: 0 },
    });
  });

  it("rechecks authorized HKD spend when sequentially allowing pre-existing holds", async () => {
    const spendFixture = await seedFixture(pool, 7_001_234_570);
    const approvalIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      approvalIds.push(await insertApproval(pool, spendFixture));
    }

    const store = createPostgresApprovalStore(transactionRunner(pool));
    const resolutions = [];
    for (const approvalId of approvalIds) {
      resolutions.push(
        await resolveApproval(
          {
            approvalId,
            decision: "allow",
            source: "web",
            reason: "Approved after human review.",
            actorUserId: spendFixture.reviewerId,
          },
          store,
        ),
      );
    }

    expect(resolutions.map(({ status, decision }) => ({ status, decision }))).toEqual([
      { status: "approved", decision: "allow" },
      { status: "approved", decision: "allow" },
      { status: "approved", decision: "allow" },
      { status: "approved", decision: "allow" },
      { status: "denied", decision: "deny" },
    ]);

    const stored = await pool.query<{
      approved_count: string;
      denied_count: string;
      authorized_spend_cents: string;
      final_reason_code: string;
      final_authorized_at: Date | null;
      final_authorization_expires_at: Date | null;
      final_audit_reason_code: string | null;
    }>(
      `SELECT
        count(*) FILTER (WHERE approval.status = 'approved')::text AS approved_count,
        count(*) FILTER (WHERE approval.status = 'denied')::text AS denied_count,
        coalesce(sum(request.amount_cents) FILTER (
          WHERE request.current_decision = 'allow'
        ), 0)::text AS authorized_spend_cents,
        max(request.reason_code) FILTER (WHERE approval.id = $2)::text AS final_reason_code,
        max(request.authorized_at) FILTER (WHERE approval.id = $2) AS final_authorized_at,
        max(request.authorization_expires_at) FILTER (
          WHERE approval.id = $2
        ) AS final_authorization_expires_at,
        max(audit.payload ->> 'reasonCode') FILTER (
          WHERE approval.id = $2 AND audit.action = 'approval.resolved'
        ) AS final_audit_reason_code
       FROM public.pending_approvals approval
       JOIN public.gateway_requests request ON request.id = approval.gateway_request_id
       LEFT JOIN public.agent_audit_logs audit
         ON audit.agent_id = approval.agent_id
        AND audit.payload ->> 'approvalId' = approval.id::text
       WHERE approval.id = ANY($1::uuid[])`,
      [approvalIds, approvalIds[4]],
    );
    expect(stored.rows).toEqual([
      {
        approved_count: "4",
        denied_count: "1",
        authorized_spend_cents: "100000",
        final_reason_code: "DAILY_LIMIT_EXCEEDED",
        final_authorized_at: null,
        final_authorization_expires_at: null,
        final_audit_reason_code: "DAILY_LIMIT_EXCEEDED",
      },
    ]);
    await verifyChain(pool, spendFixture);
  });

  it.each([
    {
      invalidation: "revoked passport",
      telegramId: 7_001_234_571,
      expectedReasonCode: "PASSPORT_INACTIVE",
      invalidate: (target: Fixture) =>
        pool.query("UPDATE public.agents SET status = 'revoked' WHERE id = $1", [target.agentId]),
    },
    {
      invalidation: "expired passport",
      telegramId: 7_001_234_572,
      expectedReasonCode: "PASSPORT_EXPIRED",
      invalidate: (target: Fixture) =>
        pool.query(
          "UPDATE public.agents SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
          [target.agentId],
        ),
    },
    {
      invalidation: "revoked signing key",
      telegramId: 7_001_234_573,
      expectedReasonCode: "AGENT_KEY_INACTIVE",
      invalidate: (target: Fixture) =>
        pool.query("UPDATE public.agent_keys SET status = 'revoked' WHERE id = $1", [target.keyId]),
    },
    {
      invalidation: "non-external signing key custody",
      telegramId: 7_001_234_574,
      expectedReasonCode: "AGENT_KEY_INACTIVE",
      invalidate: (target: Fixture) =>
        pool.query(
          `UPDATE public.agent_keys
           SET custody = 'legacy_encrypted', ciphertext = '\\x01', iv = '\\x02',
             wrapped_dek = '\\x03', kek_version = 'v1',
             encryption_algorithm = 'A256GCM+A256KW'
           WHERE id = $1`,
          [target.keyId],
        ),
    },
  ])(
    "audits a denied hold instead of authorizing after $invalidation",
    async ({ telegramId, expectedReasonCode, invalidate }) => {
      const target = await seedFixture(pool, telegramId);
      const approvalId = await insertApproval(pool, target);
      await invalidate(target);

      const resolution = await resolveApproval(
        {
          approvalId,
          decision: "allow",
          source: "web",
          reason: "The stale hold looked safe to approve.",
          actorUserId: target.reviewerId,
        },
        createPostgresApprovalStore(transactionRunner(pool)),
      );
      expect(resolution).toMatchObject({ status: "denied", decision: "deny" });

      const stored = await pool.query<{
        status: string;
        resolution: string;
        current_decision: string;
        reason_code: string;
        authorized_at: Date | null;
        authorization_expires_at: Date | null;
        audit_reason_code: string | null;
      }>(
        `SELECT approval.status::text, approval.resolution::text,
          request.current_decision::text, request.reason_code,
          request.authorized_at, request.authorization_expires_at,
          audit.payload ->> 'reasonCode' AS audit_reason_code
         FROM public.pending_approvals approval
         JOIN public.gateway_requests request ON request.id = approval.gateway_request_id
         LEFT JOIN public.agent_audit_logs audit
           ON audit.agent_id = approval.agent_id
          AND audit.action = 'approval.resolved'
          AND audit.payload ->> 'approvalId' = approval.id::text
         WHERE approval.id = $1`,
        [approvalId],
      );
      expect(stored.rows).toEqual([
        {
          status: "denied",
          resolution: "deny",
          current_decision: "deny",
          reason_code: expectedReasonCode,
          authorized_at: null,
          authorization_expires_at: null,
          audit_reason_code: expectedReasonCode,
        },
      ]);
      await verifyChain(pool, target);
    },
  );

  it("allows exactly one web/Telegram resolution winner with one safe audit event", async () => {
    const approvalId = await insertApproval(pool, fixture);
    const store = createPostgresApprovalStore(transactionRunner(pool));
    const attempts = await Promise.allSettled([
      resolveApproval(
        {
          approvalId,
          decision: "allow",
          source: "web",
          reason: "Reviewed in the protected web surface.",
          actorUserId: fixture.reviewerId,
        },
        store,
      ),
      resolveApproval(
        {
          approvalId,
          decision: "deny",
          source: "telegram",
          reason: "Reviewed from the immutable private Telegram identity.",
          actorUserId: fixture.reviewerId,
          telegramIdentity: {
            telegramUserId: fixture.telegramId,
            telegramChatId: fixture.telegramId,
          },
        },
        store,
      ),
    ]);

    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        code: "APPROVAL_UNAVAILABLE",
        status: 409,
      }) as ApprovalServiceError,
    });
    const stored = await pool.query<{
      status: string;
      current_decision: string;
      audits: string;
      payloads: string[];
    }>(
      `SELECT approval.status::text, request.current_decision::text,
        count(audit.id)::text AS audits,
        coalesce(array_agg(audit.payload::text) FILTER (WHERE audit.id IS NOT NULL), '{}') AS payloads
       FROM public.pending_approvals approval
       JOIN public.gateway_requests request ON request.id = approval.gateway_request_id
       LEFT JOIN public.agent_audit_logs audit
         ON audit.agent_id = approval.agent_id
        AND audit.action = 'approval.resolved'
       WHERE approval.id = $1
       GROUP BY approval.status, request.current_decision`,
      [approvalId],
    );
    expect(stored.rows[0]?.status).toMatch(/approved|denied/);
    expect(stored.rows[0]?.audits).toBe("1");
    expect(stored.rows[0]?.payloads.join(" ")).not.toContain("protected web surface");
    expect(stored.rows[0]?.payloads.join(" ")).not.toContain("private Telegram identity");
    await verifyChain(pool, fixture);
  });

  it("binds callbacks to the assigned reviewer's immutable private numeric identity", async () => {
    const approvalId = await insertApproval(pool, fixture);
    const exact = await appTransaction(pool, null, (client) =>
      client.query<{ user_id: string }>(
        "SELECT user_id FROM public.hermes_telegram_reviewer_identity($1, $2, $2)",
        [approvalId, fixture.telegramId],
      ),
    );
    const wrongChat = await appTransaction(pool, null, (client) =>
      client.query<{ user_id: string }>(
        "SELECT user_id FROM public.hermes_telegram_reviewer_identity($1, $2, $3)",
        [approvalId, fixture.telegramId, fixture.telegramId + 1],
      ),
    );

    expect(exact.rows).toEqual([{ user_id: fixture.reviewerId }]);
    expect(wrongChat.rows).toEqual([]);
    await resolveApproval(
      {
        approvalId,
        decision: "deny",
        source: "web",
        reason: "Identity boundary verified by the integration test.",
        actorUserId: fixture.reviewerId,
      },
      createPostgresApprovalStore(transactionRunner(pool)),
    );
  });

  it("atomically rechecks Telegram identity and current delivery eligibility", async () => {
    const approvalId = await insertApproval(pool, fixture);
    const applicationName = `task5-telegram-race-${crypto.randomUUID()}`;
    const racePool = new Pool({
      connectionString: databaseUrl,
      max: 1,
      application_name: applicationName,
    });
    const revokeClient = await pool.connect();
    type RaceOutcome =
      { status: "fulfilled"; value: unknown } | { status: "rejected"; error: unknown };
    let revokeCommitted = false;
    let pendingOutcome: Promise<RaceOutcome> | undefined;
    let outcome: RaceOutcome | undefined;
    try {
      const preflight = await appTransaction(pool, null, (client) =>
        client.query<{ user_id: string }>(
          "SELECT user_id FROM public.hermes_telegram_reviewer_identity($1, $2, $2)",
          [approvalId, fixture.telegramId],
        ),
      );
      expect(preflight.rows).toEqual([{ user_id: fixture.reviewerId }]);

      await revokeClient.query("BEGIN");
      await revokeClient.query(
        `UPDATE public.telegram_links
         SET is_active = false, revoked_at = clock_timestamp()
         WHERE organization_id = $1
           AND user_id = $2
           AND is_active`,
        [fixture.organizationId, fixture.reviewerId],
      );

      pendingOutcome = resolveApproval(
        {
          approvalId,
          decision: "allow",
          source: "telegram",
          reason: "Stale Telegram callback must lose to link revocation.",
          actorUserId: fixture.reviewerId,
          telegramIdentity: {
            telegramUserId: fixture.telegramId,
            telegramChatId: fixture.telegramId,
          },
        },
        createPostgresApprovalStore(transactionRunner(racePool, applicationName)),
      ).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );

      await waitForApplicationLock(pool, applicationName);
      await revokeClient.query("COMMIT");
      revokeCommitted = true;
      outcome = await pendingOutcome;
    } finally {
      if (!revokeCommitted) await revokeClient.query("ROLLBACK").catch(() => undefined);
      if (pendingOutcome && !outcome) outcome = await pendingOutcome;
      revokeClient.release();
      await racePool.end();
    }

    await pool.query(
      `INSERT INTO public.telegram_links (
        organization_id, user_id, telegram_user_id, telegram_chat_id, is_active
      ) VALUES ($1, $2, $3, $3, true)`,
      [fixture.organizationId, fixture.reviewerId, fixture.telegramId],
    );
    const approvalStatus = await pool.query<{ status: string }>(
      "SELECT status::text FROM public.pending_approvals WHERE id = $1",
      [approvalId],
    );
    if (approvalStatus.rows[0]?.status === "pending") {
      await resolveApproval(
        {
          approvalId,
          decision: "deny",
          source: "web",
          reason: "Clean up the rejected stale Telegram callback fixture.",
          actorUserId: fixture.reviewerId,
        },
        createPostgresApprovalStore(transactionRunner(pool)),
      );
    }
    expect(outcome).toMatchObject({
      status: "rejected",
      error: expect.objectContaining({ code: "PERMISSION_DENIED" }) as unknown,
    });

    const deliveryApprovalId = await insertApproval(pool, fixture);
    await pool.query(
      "UPDATE public.org_members SET role = 'viewer' WHERE organization_id = $1 AND user_id = $2",
      [fixture.organizationId, fixture.reviewerId],
    );
    let deliveryTarget: unknown;
    try {
      deliveryTarget = await createPostgresTelegramDeliveryStore(
        transactionRunner(pool),
      ).getDeliveryTarget(deliveryApprovalId);
    } finally {
      await pool.query(
        "UPDATE public.org_members SET role = 'owner' WHERE organization_id = $1 AND user_id = $2",
        [fixture.organizationId, fixture.reviewerId],
      );
    }
    await resolveApproval(
      {
        approvalId: deliveryApprovalId,
        decision: "deny",
        source: "web",
        reason: "Clean up the demoted delivery fixture.",
        actorUserId: fixture.reviewerId,
      },
      createPostgresApprovalStore(transactionRunner(pool)),
    );
    expect(deliveryTarget).toBeNull();
  }, 20_000);

  it("non-blockingly locks cron, expires holds, and retries durable Telegram failures", async () => {
    const expiredApprovalId = await insertApproval(pool, fixture, true);
    const deliveryApprovalId = await insertApproval(pool, fixture);
    const runner = transactionRunner(pool);
    const maintenanceStore = createPostgresApprovalMaintenanceStore(runner);
    const approvalStore = createPostgresApprovalStore(runner);
    const deliveryStore = createPostgresTelegramDeliveryStore(runner);

    const lockClient = await pool.connect();
    try {
      await lockClient.query("SET ROLE hermes_app");
      await lockClient.query("BEGIN");
      const lock = await lockClient.query<{ acquired: boolean }>(
        "SELECT public.hermes_try_lock_approval_maintenance() AS acquired",
      );
      expect(lock.rows).toEqual([{ acquired: true }]);
      await expect(maintenanceStore.claim()).resolves.toEqual({
        acquired: false,
        expiredApprovalIds: [],
        deliveryTargets: [],
      });
    } finally {
      await lockClient.query("ROLLBACK").catch(() => undefined);
      await lockClient.query("RESET ROLE").catch(() => undefined);
      lockClient.release();
    }

    const failed = await runApprovalMaintenance({
      store: maintenanceStore,
      approvalStore,
      deliveryStore,
      sender: {
        sendApprovalMessage: vi.fn().mockRejectedValue(new Error("provider secret detail")),
      },
    });
    expect(failed).toEqual({
      acquired: true,
      expired: 1,
      expiryRaces: 0,
      delivered: 0,
      deliveryFailures: 1,
    } satisfies ApprovalMaintenanceResult);

    const retrySender = {
      sendApprovalMessage: vi.fn().mockResolvedValue(undefined),
    };
    const leased = await runApprovalMaintenance({
      store: maintenanceStore,
      approvalStore,
      deliveryStore,
      sender: retrySender,
    });
    expect(leased).toMatchObject({
      acquired: true,
      delivered: 0,
      deliveryFailures: 0,
    });
    expect(retrySender.sendApprovalMessage).not.toHaveBeenCalled();

    await pool.query(
      `UPDATE public.pending_approvals
       SET telegram_last_attempt_at = clock_timestamp() - interval '11 minutes'
       WHERE id = $1`,
      [deliveryApprovalId],
    );
    const retried = await runApprovalMaintenance({
      store: maintenanceStore,
      approvalStore,
      deliveryStore,
      sender: retrySender,
    });
    expect(retried).toMatchObject({
      acquired: true,
      expired: 0,
      delivered: 1,
      deliveryFailures: 0,
    });

    const states = await pool.query<{
      id: string;
      status: string;
      telegram_delivery_state: string;
      telegram_delivery_attempts: number;
      telegram_last_error_code: string | null;
    }>(
      `SELECT id, status::text, telegram_delivery_state::text,
        telegram_delivery_attempts, telegram_last_error_code
       FROM public.pending_approvals
       WHERE id = ANY($1::uuid[])
       ORDER BY id`,
      [[expiredApprovalId, deliveryApprovalId]],
    );
    expect(states.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expiredApprovalId, status: "expired" }),
        expect.objectContaining({
          id: deliveryApprovalId,
          status: "pending",
          telegram_delivery_state: "sent",
          telegram_delivery_attempts: 2,
          telegram_last_error_code: null,
        }),
      ]),
    );
    const audits = await pool.query<{ action: string; count: string }>(
      `SELECT action, count(*)::text AS count
       FROM public.agent_audit_logs
       WHERE agent_id = $1
         AND (action = 'approval.expired' OR action LIKE 'approval.delivery.%')
       GROUP BY action
       ORDER BY action`,
      [fixture.agentId],
    );
    expect(audits.rows).toEqual([
      { action: "approval.delivery.failed", count: "1" },
      { action: "approval.delivery.pending", count: "2" },
      { action: "approval.delivery.sent", count: "1" },
      { action: "approval.expired", count: "1" },
    ]);
    await verifyChain(pool, fixture);
  }, 20_000);
});
