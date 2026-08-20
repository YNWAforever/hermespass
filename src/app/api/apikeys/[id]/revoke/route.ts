import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { revokeApiKey } from "@/lib/productization/api-keys";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return ok({ apiKey: await revokeApiKey(actor, idSchema.parse(id)) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
