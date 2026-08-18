import { describe, expect, it } from "vitest";

import type {
  ApprovalResolutionStore,
  ApprovalResolutionTransaction,
} from "@/lib/approvals/service";
import { handleTelegramUpdate, type TelegramReviewStore } from "@/lib/telegram/update";

const approvalId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";

class FakeReviewStore implements TelegramReviewStore {
  consumed: Array<Record<string, unknown>> = [];
  identities: Array<Record<string, unknown>> = [];

  async createLinkToken() {
    return { expiresAt: new Date("2026-08-18T05:10:00.000Z") };
  }

  async consumeLinkToken(input: {
    tokenHash: Buffer;
    telegramUserId: number;
    telegramChatId: number;
  }) {
    this.consumed.push(input);
    return {
      organizationId: "33333333-3333-4333-8333-333333333333",
      userId: "reviewer-1",
      linkId: "44444444-4444-4444-8444-444444444444",
    };
  }

  async findReviewerIdentity(input: {
    approvalId: string;
    telegramUserId: number;
    telegramChatId: number;
  }) {
    this.identities.push(input);
    return input.telegramUserId === 7_001_234_567 ? { userId: "reviewer-1" } : null;
  }
}

class FakeResolutionTransaction implements ApprovalResolutionTransaction {
  calls: Array<Record<string, unknown>> = [];

  async resolve(input: Parameters<ApprovalResolutionTransaction["resolve"]>[0]) {
    this.calls.push(input);
    return {
      approvalId,
      gatewayRequestId: requestId,
      status: input.decision === "allow" ? ("approved" as const) : ("denied" as const),
      decision: input.decision,
    };
  }
}

function resolutionStore(transaction: FakeResolutionTransaction) {
  const actors: Array<string | null> = [];
  const store: ApprovalResolutionStore = {
    transaction: async (actorUserId, callback) => {
      actors.push(actorUserId);
      return callback(transaction);
    },
  };
  return { store, actors };
}

describe("Telegram webhook update handling", () => {
  it("binds a start token only from the sender's private immutable numeric chat", async () => {
    const telegramStore = new FakeReviewStore();
    const transaction = new FakeResolutionTransaction();
    const { store } = resolutionStore(transaction);
    const token = Buffer.alloc(32, 27).toString("base64url");

    await expect(
      handleTelegramUpdate(
        {
          update_id: 1,
          message: {
            from: { id: 7_001_234_567 },
            chat: { id: 7_001_234_567, type: "private" },
            text: `/start ${token}`,
          },
        },
        { telegramStore, approvalStore: store },
      ),
    ).resolves.toMatchObject({ kind: "linked", userId: "reviewer-1" });
    expect(telegramStore.consumed).toHaveLength(1);
    expect(telegramStore.consumed[0]).toMatchObject({
      telegramUserId: 7_001_234_567,
      telegramChatId: 7_001_234_567,
    });
  });

  it("rejects linking from groups or a chat that differs from the sender", async () => {
    const telegramStore = new FakeReviewStore();
    const { store } = resolutionStore(new FakeResolutionTransaction());
    const token = Buffer.alloc(32, 28).toString("base64url");

    await expect(
      handleTelegramUpdate(
        {
          message: {
            from: { id: 42 },
            chat: { id: -42, type: "group" },
            text: `/start ${token}`,
          },
        },
        { telegramStore, approvalStore: store },
      ),
    ).rejects.toMatchObject({ code: "TELEGRAM_UPDATE_INVALID" });
    expect(telegramStore.consumed).toEqual([]);
  });

  it("resolves through the linked assigned reviewer and the shared atomic service", async () => {
    const telegramStore = new FakeReviewStore();
    const transaction = new FakeResolutionTransaction();
    const { store, actors } = resolutionStore(transaction);

    await expect(
      handleTelegramUpdate(
        {
          callback_query: {
            id: "callback-1",
            from: { id: 7_001_234_567 },
            message: { chat: { id: 7_001_234_567, type: "private" } },
            data: `approval:${approvalId}:deny`,
          },
        },
        { telegramStore, approvalStore: store },
      ),
    ).resolves.toMatchObject({
      kind: "resolved",
      approval: { approvalId, decision: "deny", source: "telegram" },
    });
    expect(telegramStore.identities).toEqual([
      { approvalId, telegramUserId: 7_001_234_567, telegramChatId: 7_001_234_567 },
    ]);
    expect(actors).toEqual(["reviewer-1"]);
    expect(transaction.calls).toEqual([
      {
        approvalId,
        decision: "deny",
        source: "telegram",
        reason: "Denied via private Telegram review.",
        telegramIdentity: {
          telegramUserId: 7_001_234_567,
          telegramChatId: 7_001_234_567,
        },
      },
    ]);
  });

  it("does not resolve for an unlinked numeric identity", async () => {
    const telegramStore = new FakeReviewStore();
    const transaction = new FakeResolutionTransaction();
    const { store } = resolutionStore(transaction);

    await expect(
      handleTelegramUpdate(
        {
          callback_query: {
            from: { id: 99 },
            message: { chat: { id: 99, type: "private" } },
            data: `approval:${approvalId}:allow`,
          },
        },
        { telegramStore, approvalStore: store },
      ),
    ).rejects.toMatchObject({ code: "TELEGRAM_IDENTITY_UNLINKED" });
    expect(transaction.calls).toEqual([]);
  });
});
