import { z } from "zod";

import { assertCanMutate, requireActor } from "@/lib/auth/authorization";
import { errorResponse, jsonError, ok } from "@/lib/http";
import { revokeMandate } from "@/lib/payments/mandate-service";

export const dynamic = "force-dynamic";

function revokeErrorResponse(request: Request, error: unknown): Response {
  if (error instanceof Error && error.message === "MANDATE_NOT_FOUND") {
    return jsonError(request, "MANDATE_NOT_FOUND", "Mandate not found.", 404);
  }
  return errorResponse(request, error);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    assertCanMutate(actor);
    const id = z
      .string()
      .uuid()
      .parse((await context.params).id);
    return ok({ mandate: await revokeMandate(actor, id) });
  } catch (error) {
    return revokeErrorResponse(request, error);
  }
}
