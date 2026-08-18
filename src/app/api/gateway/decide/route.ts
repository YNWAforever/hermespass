import { decideGatewayRequest } from "@/lib/gateway/service";
import { errorResponse, jsonError, ok } from "@/lib/http";
import { gatewayRequestSchema } from "@/lib/policy/action";

export const dynamic = "force-dynamic";

export const MAX_GATEWAY_BODY_BYTES = 16 * 1_024;

class GatewayRequestTooLargeError extends Error {
  constructor() {
    super("REQUEST_TOO_LARGE");
    this.name = "GatewayRequestTooLargeError";
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_GATEWAY_BODY_BYTES
  ) {
    throw new GatewayRequestTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_GATEWAY_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new GatewayRequestTooLargeError();
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

export async function POST(request: Request): Promise<Response> {
  try {
    const signedRequest = gatewayRequestSchema.parse(await readJsonBody(request));
    return ok(await decideGatewayRequest(signedRequest));
  } catch (error) {
    if (error instanceof GatewayRequestTooLargeError) {
      return jsonError(
        request,
        "REQUEST_TOO_LARGE",
        "Gateway request bodies cannot exceed 16 KiB.",
        413,
      );
    }
    return errorResponse(request, error);
  }
}
