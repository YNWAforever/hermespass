import { and, asc, eq, sql } from "drizzle-orm";

import { agentAuditLogs, agents } from "@/db/schema";
import { withActorTransaction } from "@/lib/auth/authorization";
import type { Actor } from "@/lib/auth/authorization";

export type AuditDto = {
  id: number;
  timestamp: string;
  agentDid: string | null;
  agentSlug: string | null;
  action: string;
  summary: string;
  payloadHash: string;
  previousHash: string;
  decision: string | null;
  tool: string | null;
};

export function e2eAuditFixture(): AuditDto[] {
  return [];
}

function hex(value: Buffer | Uint8Array | null): string {
  return value ? Buffer.from(value).toString("hex") : "";
}

export async function listAudit(actor: Actor): Promise<AuditDto[]> {
  return withActorTransaction(actor, async (tx) => {
    const rows = await tx
      .select({ audit: agentAuditLogs, agentDid: agents.did, agentSlug: agents.slug })
      .from(agentAuditLogs)
      .leftJoin(agents, eq(agentAuditLogs.agentId, agents.id))
      .where(and(eq(agentAuditLogs.organizationId, actor.organizationId)))
      .orderBy(asc(agentAuditLogs.chainPosition));
    return rows.map(({ audit, agentDid, agentSlug }) => ({
      id: audit.id,
      timestamp: audit.occurredAt.toISOString(),
      agentDid,
      agentSlug,
      action: audit.action,
      summary: audit.summary,
      payloadHash: hex(audit.hash),
      previousHash: hex(audit.prevHash),
      decision: audit.decision,
      tool: audit.tool,
    }));
  });
}

export async function verifyAudit(actor: Actor) {
  return withActorTransaction(actor, async (tx) => {
    const databaseResult = await tx.execute(
      sql`select valid, checked, first_invalid from hermes_verify_audit_chain(${actor.organizationId})`,
    );
    const databaseVerification = databaseResult.rows[0] as
      | {
          valid: boolean;
          checked: number | string;
          first_invalid: number | string | null;
        }
      | undefined;
    if (databaseVerification) {
      return {
        valid: databaseVerification.valid,
        checked: Number(databaseVerification.checked),
        firstInvalid:
          databaseVerification.first_invalid === null
            ? null
            : Number(databaseVerification.first_invalid),
      };
    }

    throw new Error("AUDIT_VERIFICATION_RESULT_MISSING");
  });
}

export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildAuditCsv(entries: AuditDto[]): string {
  const headers = [
    "id",
    "timestamp",
    "agent_did",
    "action",
    "summary",
    "payload_hash",
    "previous_hash",
    "decision",
    "tool",
  ];
  const rows = entries.map((entry) => [
    entry.id,
    entry.timestamp,
    entry.agentDid,
    entry.action,
    entry.summary,
    entry.payloadHash,
    entry.previousHash,
    entry.decision,
    entry.tool,
  ]);
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
