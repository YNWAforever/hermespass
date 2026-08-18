import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const migrationUrl = join(process.cwd(), "drizzle", "0004_approval_operations.sql");
const journalUrl = join(process.cwd(), "drizzle", "meta", "_journal.json");

describe("Task 5 approval operations migration", () => {
  it("registers the additive approval operations migration", async () => {
    const journal = JSON.parse(await readFile(journalUrl, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(journal.entries.at(-1)).toMatchObject({
      idx: 4,
      tag: "0004_approval_operations",
    });
  });

  it("keeps approval resolution atomic and appends a safe hash-chain audit row", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.hermes_resolve_approval\(/);
    expect(sql).toContain("UPDATE public.pending_approvals");
    expect(sql).toContain("UPDATE public.gateway_requests");
    expect(sql).toContain("INSERT INTO public.agent_audit_logs");
    expect(sql).toContain("approval.expired");
    expect(sql).toContain("approval.resolved");
    expect(sql).not.toContain("'resolutionReason'");
  });

  it("defines private immutable reviewer identity and durable delivery claims", async () => {
    const sql = await readFile(migrationUrl, "utf8");

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
    const sql = await readFile(migrationUrl, "utf8");

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
