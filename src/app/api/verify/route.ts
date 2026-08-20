import { errorResponse, jsonError, ok } from "@/lib/http";
import { verifyWithApiKey } from "@/lib/productization/verification";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const did = new URL(request.url).searchParams.get("did");
    if (!did) return jsonError(request, "DID_REQUIRED", "A did query parameter is required.", 400);
    if (!did.startsWith("did:web:"))
      return jsonError(request, "DID_INVALID", "Only did:web identifiers are supported.", 400);
    const result = await verifyWithApiKey(request, did);
    return ok(result.body);
  } catch (error) {
    return errorResponse(request, error);
  }
}
