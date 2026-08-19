import { errorResponse, ok } from "@/lib/http";
import { verifyWithApiKey } from "@/lib/productization/verification";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ did: string }> }) {
  try {
    const { did } = await context.params;
    const result = await verifyWithApiKey(request, did);
    return ok(result.body);
  } catch (error) {
    return errorResponse(request, error);
  }
}
