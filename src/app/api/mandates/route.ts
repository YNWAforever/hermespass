import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, jsonError, ok } from "@/lib/http";
import { issueMandate, listMandates } from "@/lib/payments/mandate-service";

export const dynamic = "force-dynamic";

const MAX_MANDATE_BODY_BYTES = 16 * 1_024;

const mandateBodySchema = z
  .object({
    version: z.literal("1"),
    mandateId: z.string().uuid(),
    agentDid: z.string().regex(/^did:web:[^\s]+$/),
    keyId: z.string().uuid(),
    kind: z.enum(["intent", "cart"]),
    nonce: z.string().uuid(),
    issuedAt: z.string().datetime({ offset: true }),
    parentMandateId: z.string().uuid().nullable(),
    constraints: z
      .object({
        currency: z.literal("HKD"),
        maxAmountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        merchant: z.string().trim().min(1).max(255).nullable(),
        mccAllowlist: z.array(z.string().regex(/^\d{4}$/)).max(100),
        expiresAt: z.string().datetime({ offset: true }),
        oneTime: z.boolean(),
      })
      .strict(),
  })
  .strict();

const signedMandateSchema = z
  .object({ body: mandateBodySchema, signature: z.string().min(1) })
  .strict();

class MandateRequestTooLargeError extends Error {
  constructor() {
    super("REQUEST_TOO_LARGE");
    this.name = "MandateRequestTooLargeError";
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_MANDATE_BODY_BYTES
  ) {
    throw new MandateRequestTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_MANDATE_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new MandateRequestTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw new SyntaxError("INVALID_JSON");
  }
}

function mandateErrorResponse(request: Request, error: unknown): Response {
  if (error instanceof MandateRequestTooLargeError) {
    return jsonError(
      request,
      "REQUEST_TOO_LARGE",
      "Mandate request bodies cannot exceed 16 KiB.",
      413,
    );
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "NONCE_CONFLICT") {
    return jsonError(request, code, "This nonce is bound to different signed bytes.", 409);
  }
  if (code === "MANDATE_PARENT_INVALID") {
    return jsonError(
      request,
      code,
      "The mandate parent is invalid or outside the agent tenant.",
      409,
    );
  }
  if (code === "MANDATE_NOT_FOUND") {
    return jsonError(request, code, "Mandate not found.", 404);
  }
  if (code === "MANDATE_UNAVAILABLE") {
    return jsonError(request, code, "The mandate service is temporarily unavailable.", 503);
  }
  return errorResponse(request, error);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    return ok({ mandates: await listMandates(actor) });
  } catch (error) {
    return mandateErrorResponse(request, error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const signed = signedMandateSchema.parse(await readJsonBody(request));
    const result = await issueMandate(signed);
    const envelope = result as { mandate?: unknown; replayed?: boolean };
    const mandate = envelope.mandate ?? result;
    return ok({ mandate }, { status: envelope.replayed ? 200 : 201 });
  } catch (error) {
    return mandateErrorResponse(request, error);
  }
}
