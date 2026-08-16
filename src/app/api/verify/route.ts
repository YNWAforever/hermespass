import { getPublicAgentByDid, verifyPublicAgentByDid } from "@/lib/agents/service";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const did = new URL(request.url).searchParams.get("did");
    if (!did)
      return Response.json(
        { error: { code: "DID_REQUIRED", message: "A did query parameter is required." } },
        { status: 400 },
      );
    if (!did.startsWith("did:web:"))
      return Response.json(
        { error: { code: "DID_INVALID", message: "Only did:web identifiers are supported." } },
        { status: 400 },
      );
    if (!(await getPublicAgentByDid(did)))
      return Response.json(
        { error: { code: "AGENT_NOT_FOUND", message: "Agent not found." } },
        { status: 404 },
      );
    return ok(await verifyPublicAgentByDid(did));
  } catch (error) {
    return errorResponse(request, error);
  }
}
