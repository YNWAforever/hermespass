import { consumeAgentKeyEnrollment } from "@/lib/agents/enrollment";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const result = await consumeAgentKeyEnrollment(await request.json());
    return ok(result);
  } catch (error) {
    return errorResponse(request, error);
  }
}
