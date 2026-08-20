import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { listPolicies } from "@/lib/insurance/service";

const querySchema = z.object({
  cursor: z.string().datetime({ offset: true }).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const url = new URL(request.url);
    const query = querySchema.parse({
      cursor: url.searchParams.get("cursor"),
      limit: url.searchParams.get("limit") ?? undefined,
    });
    return ok({ policies: await listPolicies(actor, query.cursor ?? null, query.limit) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
