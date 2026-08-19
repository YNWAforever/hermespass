import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { createApiKey, listApiKeys } from "@/lib/productization/api-keys";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const createInput = z.object({ name: z.string() });

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    return ok({ apiKeys: await listApiKeys(actor) });
  } catch (error) {
    return errorResponse(request, error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = createInput.parse(await request.json());
    return ok({ apiKey: await createApiKey(actor, input.name) }, { status: 201 });
  } catch (error) {
    return errorResponse(request, error);
  }
}
