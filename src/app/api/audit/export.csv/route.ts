import { requireActor } from "@/lib/auth/authorization";
import { csvCell, listAudit } from "@/lib/audit/service";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const entries = await listAudit(actor);
    const headers = [
      "id",
      "timestamp",
      "agent_did",
      "action",
      "summary",
      "payload_hash",
      "previous_hash",
      "signature_valid",
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
      entry.signatureValid,
      entry.decision,
      entry.tool,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="hermespass-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}
