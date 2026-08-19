import { errorResponse, jsonError } from "@/lib/http";

const MAX_WALLET_BODY_BYTES = 16 * 1_024;

export class WalletRequestTooLargeError extends Error {
  constructor() {
    super("REQUEST_TOO_LARGE");
    this.name = "WalletRequestTooLargeError";
  }
}

export async function readWalletJsonBody(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_WALLET_BODY_BYTES
  ) {
    throw new WalletRequestTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("INVALID_JSON");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WALLET_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new WalletRequestTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new SyntaxError("INVALID_JSON");
  }
}

export function walletErrorResponse(request: Request, error: unknown): Response {
  if (error instanceof WalletRequestTooLargeError) {
    return jsonError(request, "REQUEST_TOO_LARGE", "Wallet requests cannot exceed 16 KiB.", 413);
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "POLICY_REQUIRED") {
    return jsonError(
      request,
      code,
      "An active agent policy is required before provisioning a card.",
      409,
    );
  }
  if (code === "CARD_NOT_FOUND") {
    return jsonError(request, code, "Wallet card not found.", 404);
  }
  if (code === "RAIL_PROVISION_FAILED") {
    return jsonError(request, code, "The card could not be provisioned safely.", 503);
  }
  if (code === "RAIL_STATUS_FAILED") {
    return jsonError(request, code, "The card status could not be changed safely.", 503);
  }
  return errorResponse(request, error);
}
