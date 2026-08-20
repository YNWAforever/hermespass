import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { getAgentPolicy, putAgentPolicy } from "@/lib/policies/service";

export const dynamic = "force-dynamic";

type PolicyRouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: PolicyRouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return ok({
      policy: await getAgentPolicy(actor, z.string().uuid().parse(id)),
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function PUT(request: Request, context: PolicyRouteContext) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return ok(
      {
        policy: await putAgentPolicy(actor, z.string().uuid().parse(id), await request.json()),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(request, error);
  }
}
