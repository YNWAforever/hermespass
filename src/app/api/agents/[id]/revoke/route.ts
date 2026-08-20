import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { revokeAgent } from "@/lib/agents/service";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return ok({ agent: await revokeAgent(actor, z.string().uuid().parse(id)) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
