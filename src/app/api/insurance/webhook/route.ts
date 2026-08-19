import { errorResponse, jsonError, ok } from "@/lib/http";
import {
  applyInsuranceWebhookEvent,
  MAX_INSURANCE_WEBHOOK_BYTES,
  parseInsuranceWebhookBody,
  verifyInsuranceWebhookSecret,
  insuranceWebhookSecretForRequest,
} from "@/lib/insurance/events";

export const dynamic = "force-dynamic";

async function readBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_INSURANCE_WEBHOOK_BYTES) {
    throw new Error("INSURANCE_WEBHOOK_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_INSURANCE_WEBHOOK_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("INSURANCE_WEBHOOK_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (
      !verifyInsuranceWebhookSecret(
        request.headers.get("x-insurance-webhook-secret"),
        insuranceWebhookSecretForRequest(),
      )
    ) {
      return jsonError(
        request,
        "INSURANCE_WEBHOOK_UNAUTHORIZED",
        "Insurance webhook authentication failed.",
        401,
      );
    }
    const event = parseInsuranceWebhookBody(await readBody(request));
    return ok({ applied: await applyInsuranceWebhookEvent(event) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "INSURANCE_WEBHOOK_TOO_LARGE") {
      return jsonError(
        request,
        "REQUEST_TOO_LARGE",
        "Insurance webhook bodies cannot exceed 16 KiB.",
        413,
      );
    }
    if (code === "INSURANCE_WEBHOOK_INVALID") {
      return jsonError(request, "WEBHOOK_INVALID", "The insurance webhook is invalid.", 400);
    }
    if (code === "INSURANCE_WEBHOOK_UNAUTHORIZED") {
      return jsonError(request, code, "Insurance webhook authentication failed.", 401);
    }
    return errorResponse(request, error);
  }
}
