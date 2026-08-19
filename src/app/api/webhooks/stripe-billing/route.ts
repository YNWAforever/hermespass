import { handleBillingEvent } from "@/lib/billing/service";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    const result = await handleBillingEvent(rawBody, request.headers.get("stripe-signature"));
    return ok(result);
  } catch (error) {
    return errorResponse(request, error);
  }
}
