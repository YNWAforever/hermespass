import { getPublicAgent } from "@/lib/agents/service";
import { issuerOrigin } from "@/lib/env";
import { agentDidDocument } from "@/lib/identity/did";
import { errorResponse, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const agent = await getPublicAgent(slug);
    if (!agent || !agent.public_jwk)
      return jsonError(request, "AGENT_NOT_FOUND", "Agent not found.", 404);
    return Response.json(
      agentDidDocument(
        issuerOrigin(),
        slug,
        agent.public_jwk as never,
        "agent-1",
        agent.status === "active",
      ),
      { headers: { "cache-control": "public, max-age=300" } },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
