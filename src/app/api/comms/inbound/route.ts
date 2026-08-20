import { timingSafeEqual } from "node:crypto";

import { receiveInboundMessage, validateInboundMessage, MAX_BODY_BYTES } from "@/lib/comms/service";
import { commsInboundSecret } from "@/lib/env";
import { errorResponse, jsonError, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

function exactSecret(candidate: string | null, expected: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(candidate, "utf8");
  const target = Buffer.from(expected, "utf8");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

async function readRawBody(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_BODY_BYTES) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("COMMS_INBOUND_INVALID");
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const suppliedSecret =
      request.headers.get("x-comms-secret") ??
      request.headers.get("x-comms-inbound-secret") ??
      request.headers.get("x-hermespass-comms-secret");
    if (!exactSecret(suppliedSecret, commsInboundSecret())) {
      return jsonError(
        request,
        "COMMS_INBOUND_SECRET_INVALID",
        "Inbound authentication failed.",
        401,
      );
    }
    const rawBody = await readRawBody(request);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error("COMMS_INBOUND_INVALID");
    }
    return ok(await receiveInboundMessage(validateInboundMessage(parsed)));
  } catch (error) {
    return errorResponse(request, error);
  }
}
