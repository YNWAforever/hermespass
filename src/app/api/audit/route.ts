import { requireActor } from "@/lib/auth/authorization";
import { listAudit } from "@/lib/audit/service";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return ok({ entries: await listAudit(actor) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
