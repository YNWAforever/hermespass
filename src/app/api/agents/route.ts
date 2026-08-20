import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { issueAgent, listAgents } from "@/lib/agents/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return ok({ agents: await listAgents(actor) });
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    return ok({ agent: await issueAgent(actor, await request.json()) }, { status: 201 });
  } catch (error) {
    return errorResponse(request, error);
  }
}
