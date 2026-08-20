import { activePaymentRail } from "@/lib/payments/rails";
import { parsePaymentProviderEvent } from "@/lib/payments/payment-events";
import { createPostgresPaymentEventStore } from "@/lib/payments/payment-events-store";
import { errorResponse, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

const MAX_EVENT_BYTES = 16 * 1_024;

async function readRawBody(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_EVENT_BYTES) {
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
    if (total > MAX_EVENT_BYTES) {
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

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await readRawBody(request);
    const rail = activePaymentRail();
    const signature = request.headers.get("stripe-signature");
    // Signature verification is intentionally performed before parsing. The
    // adapter returns only safe event metadata; raw merchant/card fields are
    // never persisted by this route.
    const authorization = rail.verifyAuthorizationWebhook(raw, signature);
    if (!authorization) {
      const event = parsePaymentProviderEvent(raw, rail.name);
      if (event) await createPostgresPaymentEventStore().record(event);
    }
    const response = Response.json({ received: true }, { status: 200 });
    if (rail.name === "stripe") response.headers.set("Stripe-Version", "2026-03-25.dahlia");
    return response;
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "PAYMENT_WEBHOOK_TOO_LARGE") {
      return jsonError(request, "REQUEST_TOO_LARGE", "Webhook body exceeds 16 KiB.", 413);
    }
    if (
      code === "PAYMENT_WEBHOOK_INVALID" ||
      code === "PAYMENT_WEBHOOK_SIGNATURE_REQUIRED" ||
      code === "PAYMENT_WEBHOOK_SIGNATURE_INVALID"
    ) {
      return jsonError(
        request,
        "WEBHOOK_SIGNATURE_INVALID",
        "The webhook signature is invalid.",
        400,
      );
    }
    return errorResponse(request, error);
  }
}
