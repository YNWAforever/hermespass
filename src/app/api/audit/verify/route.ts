import { requireActor } from "@/lib/auth/authorization";
import { verifyAudit } from "@/lib/audit/service";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return ok(await verifyAudit(actor));
  } catch (error) {
    return errorResponse(request, error);
  }
}
