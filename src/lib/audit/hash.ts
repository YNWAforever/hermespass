import { webcrypto } from "node:crypto";

const cryptoApi = globalThis.crypto ?? webcrypto;

export type AuditEntryForHash = {
  organizationId: string;
  agentId: string | null;
  actorType: string;
  actorId: string;
  action: string;
  summary: string;
  decision: string | null;
  tool: string | null;
  amountCents: number | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  prevHash: string | null;
};

export function canonicalAuditInput(entry: AuditEntryForHash): string {
  return JSON.stringify([
    1,
    entry.organizationId,
    entry.agentId ?? "",
    entry.actorType,
    entry.actorId,
    entry.action,
    entry.summary,
    entry.decision ?? "",
    entry.tool ?? "",
    entry.amountCents === null ? "" : String(entry.amountCents),
    entry.payload,
    entry.occurredAt,
    entry.prevHash ?? "",
  ]);
}

export async function hashAuditEntry(entry: AuditEntryForHash): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalAuditInput(entry));
  const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

export type AuditChainEntry = AuditEntryForHash & { hash: string };

export async function verifyAuditChain(entries: AuditChainEntry[]) {
  let previous: string | null = null;
  for (const [index, entry] of entries.entries()) {
    if (entry.prevHash !== previous) return { valid: false, checked: index, brokenId: entry.hash };
    const expected = await hashAuditEntry(entry);
    if (expected !== entry.hash) return { valid: false, checked: index, brokenId: entry.hash };
    previous = entry.hash;
  }
  return { valid: true, checked: entries.length, brokenId: null };
}
