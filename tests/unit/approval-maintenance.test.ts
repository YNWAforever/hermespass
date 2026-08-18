import { describe, expect, it, vi } from "vitest";

import {
  ApprovalServiceError,
  type ApprovalResolutionRequest,
  type ApprovalResolutionStore,
} from "@/lib/approvals/service";
import { runApprovalMaintenance, type ApprovalMaintenanceStore } from "@/lib/approvals/maintenance";
import type {
  TelegramDeliveryStore,
  TelegramDeliveryTarget,
  TelegramSender,
} from "@/lib/telegram/delivery";

const expiredApprovalId = "11111111-1111-4111-8111-111111111111";
const deliveryApprovalId = "22222222-2222-4222-8222-222222222222";
const deliveryTarget: TelegramDeliveryTarget = {
  approvalId: deliveryApprovalId,
  telegramChatId: 7_001_234_567,
  agentName: "Procurement agent",
  tool: "vendor.contract",
  summary: "Approve signed digest",
  amountCents: 25_000,
  currency: "HKD",
  requestDigest: "safe-digest",
  expiresAt: "2026-08-18T08:00:00.000Z",
};

function approvalStore(
  capture: ApprovalResolutionRequest[],
  result: "resolved" | "raced" = "resolved",
): ApprovalResolutionStore {
  return {
    transaction: async (actorUserId, callback) =>
      callback({
        resolve: async (input) => {
          capture.push({ ...input, actorUserId });
          if (result === "raced") {
            throw new ApprovalServiceError("APPROVAL_UNAVAILABLE", 409);
          }
          return {
            approvalId: input.approvalId,
            gatewayRequestId: "33333333-3333-4333-8333-333333333333",
            status: "expired",
            decision: "deny",
          };
        },
      }),
  };
}

function deliveryStore(
  states: Array<{ state: string; errorCode: string | null }>,
): TelegramDeliveryStore {
  return {
    getDeliveryTarget: vi.fn(),
    recordDelivery: async (_approvalId, state, errorCode) => {
      states.push({ state, errorCode });
      return { state, attempts: 2 };
    },
  };
}

describe("hourly approval maintenance", () => {
  it("uses the shared resolver for expiry and finishes a preclaimed delivery", async () => {
    const resolutions: ApprovalResolutionRequest[] = [];
    const states: Array<{ state: string; errorCode: string | null }> = [];
    const store: ApprovalMaintenanceStore = {
      claim: vi.fn().mockResolvedValue({
        acquired: true,
        expiredApprovalIds: [expiredApprovalId],
        deliveryTargets: [deliveryTarget],
      }),
    };
    const sender: TelegramSender = {
      sendApprovalMessage: vi.fn().mockRejectedValue(new Error("secret network detail")),
    };

    await expect(
      runApprovalMaintenance({
        store,
        approvalStore: approvalStore(resolutions),
        deliveryStore: deliveryStore(states),
        sender,
      }),
    ).resolves.toEqual({
      acquired: true,
      expired: 1,
      expiryRaces: 0,
      delivered: 0,
      deliveryFailures: 1,
    });
    expect(resolutions).toEqual([
      {
        approvalId: expiredApprovalId,
        actorUserId: null,
        decision: "deny",
        source: "expiry",
        reason: "Approval hold expired after four hours.",
      },
    ]);
    expect(states).toEqual([{ state: "failed", errorCode: "TELEGRAM_DELIVERY_FAILED" }]);
    expect(JSON.stringify(states)).not.toContain("secret network detail");
  });

  it("is a no-op when another cron transaction owns the advisory lock", async () => {
    const sender: TelegramSender = { sendApprovalMessage: vi.fn() };
    const store: ApprovalMaintenanceStore = {
      claim: vi.fn().mockResolvedValue({
        acquired: false,
        expiredApprovalIds: [],
        deliveryTargets: [],
      }),
    };

    await expect(
      runApprovalMaintenance({
        store,
        approvalStore: approvalStore([]),
        deliveryStore: deliveryStore([]),
        sender,
      }),
    ).resolves.toEqual({
      acquired: false,
      expired: 0,
      expiryRaces: 0,
      delivered: 0,
      deliveryFailures: 0,
    });
    expect(sender.sendApprovalMessage).not.toHaveBeenCalled();
  });

  it("treats a concurrent single-use resolution as an idempotent expiry race", async () => {
    await expect(
      runApprovalMaintenance({
        store: {
          claim: vi.fn().mockResolvedValue({
            acquired: true,
            expiredApprovalIds: [expiredApprovalId],
            deliveryTargets: [],
          }),
        },
        approvalStore: approvalStore([], "raced"),
        deliveryStore: deliveryStore([]),
        sender: { sendApprovalMessage: vi.fn() },
      }),
    ).resolves.toMatchObject({ expired: 0, expiryRaces: 1 });
  });
});
