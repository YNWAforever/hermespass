import { z } from "zod";

import { resolveWebApproval } from "@/lib/approvals/service";
import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const resolutionInput = z
  .object({
    decision: z.enum(["allow", "deny"]),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const input = resolutionInput.parse(await request.json());
    return ok({
      approval: await resolveWebApproval(actor, {
        approvalId: z.string().uuid().parse(id),
        ...input,
      }),
    });
  } catch (error) {
    return errorResponse(request, error);
  }
}
