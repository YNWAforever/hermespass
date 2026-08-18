import { describe, expect, it, vi } from "vitest";

import { deliverCommittedApproval } from "@/lib/gateway/approval-delivery";
import type { GatewayDecisionDto } from "@/lib/gateway/service";

const hold: GatewayDecisionDto = {
  requestId: "11111111-1111-4111-8111-111111111111",
  decision: "hold",
  reasonCode: "APPROVAL_REQUIRED",
  reason: "Human approval is required.",
  policyVersion: 1,
  approvalId: "22222222-2222-4222-8222-222222222222",
  decidedAt: "2026-08-18T04:00:00.000Z",
  authorizationExpiresAt: null,
  retryAfterSeconds: 14_400,
};

describe("GatewayService post-commit approval delivery", () => {
  it("starts Telegram delivery only after the held decision transaction resolves", async () => {
    let committed = false;
    const decide = vi.fn(async () => {
      committed = true;
      return hold;
    });
    const deliver = vi.fn(async () => {
      expect(committed).toBe(true);
      return { state: "sent" as const, attempts: 1 };
    });

    await expect(deliverCommittedApproval(decide, deliver)).resolves.toEqual(hold);
    expect(deliver).toHaveBeenCalledWith(hold.approvalId);
  });

  it("returns the durable web hold when Telegram delivery fails", async () => {
    const deliver = vi.fn().mockRejectedValue(new Error("Telegram unavailable"));

    await expect(deliverCommittedApproval(async () => hold, deliver)).resolves.toEqual(hold);
  });

  it("does not invoke Telegram for a final gateway decision", async () => {
    const deliver = vi.fn();

    await deliverCommittedApproval(
      async () => ({ ...hold, decision: "deny", approvalId: null }),
      deliver,
    );

    expect(deliver).not.toHaveBeenCalled();
  });
});
