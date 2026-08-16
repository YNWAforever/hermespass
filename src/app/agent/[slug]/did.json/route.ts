import { getPublicAgent } from "@/lib/agents/service";
import { issuerOrigin } from "@/lib/env";
import { agentDidDocument } from "@/lib/identity/did";
import { errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const agent = await getPublicAgent(slug);
    if (!agent || !agent.public_jwk)
      return Response.json({ error: "agent_not_found" }, { status: 404 });
    return Response.json(agentDidDocument(issuerOrigin(), slug, agent.public_jwk as never), {
      headers: { "cache-control": "public, max-age=300" },
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}
