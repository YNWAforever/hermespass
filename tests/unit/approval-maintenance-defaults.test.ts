import { describe, expect, it, vi } from "vitest";

const approvalId = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  botToken: vi.fn(),
}));

vi.mock("@/lib/approvals/maintenance-store", () => ({
  createPostgresApprovalMaintenanceStore: () => ({ claim: mocks.claim }),
}));
vi.mock("@/lib/approvals/postgres-store", () => ({
  createPostgresApprovalStore: () => ({
    transaction: async (
      actorUserId: string | null,
      callback: (transaction: {
        resolve: (input: {
          approvalId: string;
          decision: "allow" | "deny";
          source: "web" | "telegram" | "expiry" | "owner_override";
          reason: string;
        }) => Promise<{
          approvalId: string;
          gatewayRequestId: string;
          status: "expired";
          decision: "deny";
        }>;
      }) => Promise<unknown>,
    ) =>
      callback({
        resolve: async (input) => {
          expect(actorUserId).toBeNull();
          return {
            approvalId: input.approvalId,
            gatewayRequestId: "22222222-2222-4222-8222-222222222222",
            status: "expired",
            decision: "deny",
          };
        },
      }),
  }),
}));
vi.mock("@/lib/telegram/delivery-store", () => ({
  createPostgresTelegramDeliveryStore: () => ({
    getDeliveryTarget: vi.fn(),
    recordDelivery: vi.fn(),
  }),
}));
vi.mock("@/lib/telegram/config", () => ({
  telegramBotToken: mocks.botToken,
}));

describe("approval maintenance without optional Telegram configuration", () => {
  it("still expires holds when there are no claimed Telegram deliveries", async () => {
    mocks.claim.mockResolvedValue({
      acquired: true,
      expiredApprovalIds: [approvalId],
      deliveryTargets: [],
    });
    mocks.botToken.mockImplementation(() => {
      throw new Error("TELEGRAM_BOT_TOKEN is required for Telegram operations");
    });
    const { runApprovalMaintenance } = await import("@/lib/approvals/maintenance");

    await expect(runApprovalMaintenance()).resolves.toMatchObject({
      acquired: true,
      expired: 1,
      delivered: 0,
    });
    expect(mocks.botToken).not.toHaveBeenCalled();
  });
});
