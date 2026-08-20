import { z } from "zod";

import { requireActor } from "@/lib/auth/authorization";
import { errorResponse, ok } from "@/lib/http";
import { createBillingCheckout } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ tier: z.enum(["starter", "growth", "scale"]) });

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const actor = await requireActor();
    const checkout = await createBillingCheckout(actor, body.tier);
    return ok(checkout);
  } catch (error) {
    return errorResponse(request, error);
  }
}
