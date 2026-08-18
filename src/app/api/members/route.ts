import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { listMembers } from "@/lib/policies/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return ok({ members: await listMembers(actor) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
