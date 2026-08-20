import { requireActor } from "@/lib/auth/authorization";
import { buildAuditCsv, e2eAuditFixture, listAudit } from "@/lib/audit/service";
import { isE2eUser } from "@/lib/auth/e2e-adapter";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const entries = isE2eUser(actor.userId) ? e2eAuditFixture() : await listAudit(actor);
    const csv = buildAuditCsv(entries);
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
