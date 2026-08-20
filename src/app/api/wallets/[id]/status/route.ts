import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { ok } from "@/lib/http";
import { setWalletCardStatus } from "@/lib/payments/card-service";
import { readWalletJsonBody, walletErrorResponse } from "@/lib/payments/wallet-route";

export const dynamic = "force-dynamic";

const statusInput = z.object({ status: z.enum(["active", "frozen"]) }).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const cardId = z
      .string()
      .uuid()
      .parse((await context.params).id);
    const input = statusInput.parse(await readWalletJsonBody(request));
    return ok({ card: await setWalletCardStatus(actor, cardId, input.status) });
  } catch (error) {
    return walletErrorResponse(request, error);
  }
}
