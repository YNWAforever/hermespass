import { z } from "zod";

import { createAgentKeyEnrollment } from "@/lib/agents/enrollment";
import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return ok(await createAgentKeyEnrollment(actor, z.string().uuid().parse(id)), {
      status: 201,
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}
