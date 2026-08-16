import { and, asc, eq, sql } from "drizzle-orm";

import { agentAuditLogs, agents } from "@/db/schema";
import { withActorTransaction } from "@/lib/auth/authorization";
import type { Actor } from "@/lib/auth/authorization";
import { verifyAuditChain, type AuditChainEntry } from "@/lib/audit/hash";

export type AuditDto = {
  id: number;
  timestamp: string;
  agentDid: string | null;
  agentSlug: string | null;
  action: string;
  summary: string;
  payloadHash: string;
  previousHash: string;
  signatureValid: boolean;
  decision: string | null;
  tool: string | null;
};

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
      signatureValid: true,
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
      { valid: boolean; checked: number; first_invalid: number | null } | undefined;
    if (databaseVerification) {
      return {
        valid: databaseVerification.valid,
        checked: Number(databaseVerification.checked),
        firstInvalid: databaseVerification.first_invalid,
      };
    }

    const rows = await tx
      .select()
      .from(agentAuditLogs)
      .where(eq(agentAuditLogs.organizationId, actor.organizationId))
      .orderBy(asc(agentAuditLogs.chainPosition));
    const entries: AuditChainEntry[] = rows.map((row) => ({
      chainPosition: row.chainPosition,
      organizationId: row.organizationId,
      agentId: row.agentId,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      summary: row.summary,
      decision: row.decision,
      tool: row.tool,
      amountCents: row.amountCents,
      payload: row.payload,
      occurredAt: row.occurredAt.toISOString(),
      prevHash: hex(row.prevHash) || null,
      hash: hex(row.hash),
    }));
    return verifyAuditChain(entries);
  });
}

export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
