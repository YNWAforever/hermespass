import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const approvalOperationsMigrationUrl = join(
  process.cwd(),
  "drizzle",
  "0004_approval_operations.sql",
);
const migrationUrl = join(process.cwd(), "drizzle", "0005_approval_revalidation.sql");
const journalUrl = join(process.cwd(), "drizzle", "meta", "_journal.json");
const priorSnapshotUrl = join(process.cwd(), "drizzle", "meta", "0004_snapshot.json");
const snapshotUrl = join(process.cwd(), "drizzle", "meta", "0005_snapshot.json");

describe("approval operations migrations", () => {
  it("appends approval revalidation after approval operations", async () => {
    const journal = JSON.parse(await readFile(journalUrl, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const priorSnapshot = JSON.parse(await readFile(priorSnapshotUrl, "utf8")) as {
      id: string;
    };
    const snapshot = JSON.parse(await readFile(snapshotUrl, "utf8")) as {
      id: string;
      prevId: string;
    };

    expect(journal.entries.slice(-7)).toEqual([
      expect.objectContaining({ idx: 4, tag: "0004_approval_operations" }),
      expect.objectContaining({ idx: 5, tag: "0005_approval_revalidation" }),
      expect.objectContaining({ idx: 6, tag: "0006_scoped_payments" }),
      expect.objectContaining({ idx: 7, tag: "0007_payment_authorization_hardening" }),
      expect.objectContaining({ idx: 8, tag: "0008_mandate_verified_agent_boundary" }),
      expect.objectContaining({ idx: 9, tag: "0009_card_provisioning_transition" }),
      expect.objectContaining({ idx: 10, tag: "0010_wallet_card_provisioning_attempt" }),
    ]);
    expect(snapshot.id).not.toBe(priorSnapshot.id);
    expect(snapshot.prevId).toBe(priorSnapshot.id);
  });

  it("keeps approval resolution atomic and appends a safe hash-chain audit row", async () => {
    const sql = await readFile(approvalOperationsMigrationUrl, "utf8");

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.hermes_resolve_approval\(/);
    expect(sql).toContain("UPDATE public.pending_approvals");
    expect(sql).toContain("UPDATE public.gateway_requests");
    expect(sql).toContain("INSERT INTO public.agent_audit_logs");
    expect(sql).toContain("approval.expired");
    expect(sql).toContain("approval.resolved");
    expect(sql).not.toContain("'resolutionReason'");
  });

  it("revalidates lifecycle, custody, and authorized HKD spend under the agent lock", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain("'hermes.agent:' || approval_agent_id::text");
    expect(sql).toContain("FROM public.agents agent");
    expect(sql).toContain("FROM public.agent_keys key");
    expect(sql).toContain("key.id = approval_record.key_id");
    expect(sql).toContain("key_record.custody <> 'external'");
    expect(sql).toContain("FROM public.agent_policies policy");
    expect(sql).toContain("policy.is_active");
    expect(sql).toContain("request.authorized_at >= month_start");
    expect(sql).toContain("DAILY_LIMIT_EXCEEDED");
    expect(sql).toContain("MONTHLY_LIMIT_EXCEEDED");
    expect(sql).toContain("final_resolution");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.hermes_resolve_approval\(uuid, public\.gateway_decision, public\.approval_resolution_source, text, bigint, bigint\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.hermes_resolve_approval\(uuid, public\.gateway_decision, public\.approval_resolution_source, text, bigint, bigint\) TO hermes_app/,
    );
  });

  it("defines private immutable reviewer identity and durable delivery claims", async () => {
    const sql = await readFile(approvalOperationsMigrationUrl, "utf8");

    expect(sql).toContain("hermes_telegram_reviewer_identity");
    expect(sql).toContain("link.telegram_user_id = p_telegram_user_id");
    expect(sql).toContain("link.telegram_chat_id = p_telegram_chat_id");
    expect(sql).toContain("approval.assigned_reviewer_user_id = link.user_id");
    expect(sql).toContain("hermes_approval_delivery_target");
    expect(sql).toContain("hermes_claim_approval_delivery_targets");
    expect(sql).toContain("approval.telegram_delivery_state IN ('failed', 'pending')");
    expect(sql).toContain("telegram_last_attempt_at < maintenance_time - interval '10 minutes'");

    const immediateTarget = sql.slice(
      sql.indexOf("CREATE FUNCTION public.hermes_approval_delivery_target"),
      sql.indexOf("CREATE FUNCTION public.hermes_try_lock_approval_maintenance"),
    );
    expect(immediateTarget).toContain("JOIN public.org_members member");
    expect(immediateTarget).toContain("member.role IN ('owner', 'admin')");
    expect(immediateTarget).toContain("link.telegram_user_id > 0");
    expect(immediateTarget).toContain("link.telegram_chat_id = link.telegram_user_id");
  });

  it("uses a non-blocking transaction advisory lock and exposes only executable routines", async () => {
    const sql = await readFile(approvalOperationsMigrationUrl, "utf8");

    expect(sql).toContain("pg_try_advisory_xact_lock");
    expect(sql).toContain("hermes_expired_approval_ids");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.hermes_try_lock_approval_maintenance\(\) FROM PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.hermes_try_lock_approval_maintenance\(\) TO hermes_app/,
    );
  });
});
