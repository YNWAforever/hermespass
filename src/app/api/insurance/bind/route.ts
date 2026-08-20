import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, jsonError, ok } from "@/lib/http";
import { bind } from "@/lib/insurance/service";

const schema = z.object({ policyId: z.string().uuid() });
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_BODY_BYTES)
      return jsonError(request, "BODY_TOO_LARGE", "Request body exceeds 16 KiB.", 413);
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES)
      return jsonError(request, "BODY_TOO_LARGE", "Request body exceeds 16 KiB.", 413);
    const actor = await requireActor();
    const input = schema.parse(JSON.parse(body));
    return ok({ policy: await bind(actor, input.policyId) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
