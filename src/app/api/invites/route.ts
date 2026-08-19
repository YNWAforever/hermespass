import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { createInvite } from "@/lib/invites/service";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const inviteInput = z.object({
  email: z.string(),
  role: z.enum(["admin", "viewer"]),
});

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = inviteInput.parse(await request.json());
    return ok({ invite: await createInvite(actor, input) }, { status: 201 });
  } catch (error) {
    return errorResponse(request, error);
  }
}
