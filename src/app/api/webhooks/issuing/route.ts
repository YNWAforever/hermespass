import { activePaymentRail } from "@/lib/payments/rails";
import { createPostgresAuthorizationStore } from "@/lib/payments/authorization-store";
import { authorizePayment } from "@/lib/payments/authorization-service";
import { errorResponse, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 16 * 1_024;

async function readRawBody(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_WEBHOOK_BYTES) {
    throw new Error("PAYMENT_WEBHOOK_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("PAYMENT_WEBHOOK_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("PAYMENT_WEBHOOK_INVALID");
  }
}

function webhookError(request: Request, error: unknown): Response {
  const code = error instanceof Error ? error.message : "";
  if (code === "PAYMENT_WEBHOOK_TOO_LARGE") {
    return jsonError(request, code, "Issuing webhook bodies cannot exceed 16 KiB.", 413);
  }
  if (
    code === "PAYMENT_WEBHOOK_SIGNATURE_REQUIRED" ||
    code === "PAYMENT_WEBHOOK_SIGNATURE_INVALID" ||
    code === "PAYMENT_WEBHOOK_INVALID"
  ) {
    return jsonError(
      request,
      "WEBHOOK_SIGNATURE_INVALID",
      "The webhook signature is invalid.",
      400,
    );
  }
  if (code === "PAYMENT_EVENT_CONFLICT") {
    return jsonError(request, code, "The payment event is bound to different bytes.", 409);
  }
  if (code === "PAYMENT_INPUT_INVALID") {
    return jsonError(request, code, "The payment authorization fields are invalid.", 400);
  }
  if (code === "DATABASE_UNAVAILABLE" || code === "PAYMENT_UNAVAILABLE") {
    return jsonError(request, "DATABASE_UNAVAILABLE", "Payment authorization is unavailable.", 503);
  }
  return errorResponse(request, error);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readRawBody(request);
    const rail = activePaymentRail();
    const parsed = rail.verifyAuthorizationWebhook(body, request.headers.get("stripe-signature"));
    if (!parsed) return Response.json({ received: true }, { status: 200 });
    const decision = await authorizePayment(
      { ...parsed, rail: rail.name },
      createPostgresAuthorizationStore(),
    );
    const response = Response.json(rail.directDecisionBody(decision), { status: 200 });
    if (rail.name === "stripe") response.headers.set("Stripe-Version", "2026-03-25.dahlia");
    return response;
  } catch (error) {
    return webhookError(request, error);
  }
}
