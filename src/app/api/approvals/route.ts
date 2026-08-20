import { listApprovals } from "@/lib/approvals/service";
import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return ok({ approvals: await listApprovals(actor) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
