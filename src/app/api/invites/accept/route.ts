import { z } from "zod";

import { AuthRequiredError } from "@/lib/auth/errors";
import { getSessionUser } from "@/lib/auth/server";
import { acceptInvite } from "@/lib/invites/service";
import { errorResponse, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const acceptInput = z.object({ token: z.string() });

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) throw new AuthRequiredError();
    const { token } = acceptInput.parse(await request.json());
    return ok({ invite: await acceptInvite({ userId: user.id, email: user.email }, token) });
  } catch (error) {
    return errorResponse(request, error);
  }
}
