import { requireActor } from "@/lib/auth/authorization";
import { listGatewayActivity } from "@/lib/gateway/activity-service";
import { errorResponse, ok } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return ok(await listGatewayActivity(actor));
  } catch (error) {
    return errorResponse(request, error);
  }
}
