import { describe, expect, it } from "vitest";

import {
  resolveApproval,
  type ApprovalResolutionStore,
  type ApprovalResolutionTransaction,
} from "@/lib/approvals/service";

const approvalId = "11111111-1111-4111-8111-111111111111";
const gatewayRequestId = "22222222-2222-4222-8222-222222222222";

class FakeResolutionTransaction implements ApprovalResolutionTransaction {
  calls: Array<Record<string, unknown>> = [];

  async resolve(input: {
    approvalId: string;
    decision: "allow" | "deny";
    source: "web" | "telegram" | "expiry" | "owner_override";
    reason: string;
  }) {
    this.calls.push(input);
    return {
      approvalId,
      gatewayRequestId,
      status: input.decision === "allow" ? ("approved" as const) : ("denied" as const),
      decision: input.decision,
    };
  }
}

function storeFor(transaction: FakeResolutionTransaction) {
  const transactionActors: Array<string | null> = [];
  const store: ApprovalResolutionStore = {
    transaction: async (actorUserId, callback) => {
      transactionActors.push(actorUserId);
      return callback(transaction);
    },
  };
  return { store, transactionActors };
}

describe("shared approval resolution service", () => {
  it("runs a web decision once inside the authenticated actor transaction", async () => {
    const transaction = new FakeResolutionTransaction();
    const { store, transactionActors } = storeFor(transaction);

    await expect(
      resolveApproval(
        {
          approvalId,
          decision: "allow",
          source: "web",
          reason: "Reviewed against the signed request digest.",
          actorUserId: "reviewer-1",
        },
        store,
      ),
    ).resolves.toEqual({
      approvalId,
      gatewayRequestId,
      status: "approved",
      decision: "allow",
      source: "web",
    });
    expect(transactionActors).toEqual(["reviewer-1"]);
    expect(transaction.calls).toEqual([
      {
        approvalId,
        decision: "allow",
        source: "web",
        reason: "Reviewed against the signed request digest.",
      },
    ]);
  });

  it("requires the exact private numeric identity for Telegram resolutions", async () => {
    const transaction = new FakeResolutionTransaction();
    const { store, transactionActors } = storeFor(transaction);

    await expect(
      resolveApproval(
        {
          approvalId,
          decision: "deny",
          source: "telegram",
          reason: "Reviewed in Telegram.",
          actorUserId: "reviewer-1",
        },
        store,
      ),
    ).rejects.toMatchObject({
      code: "APPROVAL_RESOLUTION_INVALID",
      status: 400,
    });
    expect(transactionActors).toEqual([]);
    expect(transaction.calls).toEqual([]);
  });
});
