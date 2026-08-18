import type { GatewayDecisionDto } from "@/lib/gateway/service";
import { attemptTelegramDelivery } from "@/lib/telegram/delivery";

export async function deliverCommittedApproval(
  decide: () => Promise<GatewayDecisionDto>,
  deliver: (approvalId: string) => Promise<unknown> = attemptTelegramDelivery,
): Promise<GatewayDecisionDto> {
  const decision = await decide();
  if (decision.decision === "hold" && decision.approvalId) {
    try {
      await deliver(decision.approvalId);
    } catch {
      // The committed web approval remains authoritative and retryable.
    }
  }
  return decision;
}
