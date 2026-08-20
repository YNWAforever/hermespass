import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { ok } from "@/lib/http";
import { listWalletCards, provisionCard } from "@/lib/payments/card-service";
import { readWalletJsonBody, walletErrorResponse } from "@/lib/payments/wallet-route";

export const dynamic = "force-dynamic";

const provisionInput = z.object({ agentId: z.string().uuid() }).strict();

export async function GET(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    return ok({ cards: await listWalletCards(actor) });
  } catch (error) {
    return walletErrorResponse(request, error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireActor();
    const input = provisionInput.parse(await readWalletJsonBody(request));
    const result = await provisionCard(actor, input.agentId);
    return ok({ card: result.card }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return walletErrorResponse(request, error);
  }
}
