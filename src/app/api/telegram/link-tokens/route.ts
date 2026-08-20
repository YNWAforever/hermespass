import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { createTelegramLinkToken } from "@/lib/telegram/service";

export const dynamic = "force-dynamic";

const linkInput = z.object({ userId: z.string().trim().min(1).max(255) }).strict();

export async function POST(request: Request) {
  try {
    const actor = await requireActor();
    const input = linkInput.parse(await request.json());
    return ok({ link: await createTelegramLinkToken(actor, input.userId) }, { status: 201 });
  } catch (error) {
    return errorResponse(request, error);
  }
}
