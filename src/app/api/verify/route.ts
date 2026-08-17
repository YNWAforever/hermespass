import { getPublicAgentByDid, verifyPublicAgentByDid } from "@/lib/agents/service";
import { errorResponse, jsonError, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const did = new URL(request.url).searchParams.get("did");
    if (!did) return jsonError(request, "DID_REQUIRED", "A did query parameter is required.", 400);
    if (!did.startsWith("did:web:"))
      return jsonError(request, "DID_INVALID", "Only did:web identifiers are supported.", 400);
    if (!(await getPublicAgentByDid(did)))
      return jsonError(request, "AGENT_NOT_FOUND", "Agent not found.", 404);
    return ok(await verifyPublicAgentByDid(did));
  } catch (error) {
    return errorResponse(request, error);
  }
}
