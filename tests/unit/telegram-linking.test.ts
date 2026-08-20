import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  consumeTelegramLinkToken,
  createTelegramLinkToken,
  type TelegramLinkStore,
} from "@/lib/telegram/service";

const actor = {
  userId: "owner-1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  organizationName: "Test org",
  organizationSlug: "test-org",
  email: "owner@example.com",
  name: "Owner",
  role: "owner" as const,
};

class FakeTelegramLinkStore implements TelegramLinkStore {
  created: Array<{
    actorUserId: string;
    organizationId: string;
    targetUserId: string;
    tokenHash: Buffer;
  }> = [];
  consumed: Array<{ tokenHash: Buffer; telegramUserId: number; telegramChatId: number }> = [];

  async createLinkToken(input: (typeof this.created)[number]) {
    this.created.push(input);
    return { expiresAt: new Date("2026-08-18T05:10:00.000Z") };
  }

  async consumeLinkToken(input: (typeof this.consumed)[number]) {
    this.consumed.push(input);
    return {
      organizationId: actor.organizationId,
      userId: "reviewer-1",
      linkId: "22222222-2222-4222-8222-222222222222",
    };
  }
}

describe("Telegram reviewer linking", () => {
  it("returns a ten-minute deep link while persisting only the token hash", async () => {
    const store = new FakeTelegramLinkStore();

    const result = await createTelegramLinkToken(actor, "reviewer-1", store, "HermesPassTestBot");

    expect(result.expiresAt).toBe("2026-08-18T05:10:00.000Z");
    expect(result.deepLinkUrl).toMatch(
      /^https:\/\/t\.me\/HermesPassTestBot\?start=[A-Za-z0-9_-]{43}$/,
    );
    const token = new URL(result.deepLinkUrl).searchParams.get("start")!;
    expect(store.created).toEqual([
      {
        actorUserId: actor.userId,
        organizationId: actor.organizationId,
        targetUserId: "reviewer-1",
        tokenHash: createHash("sha256").update(token).digest(),
      },
    ]);
    expect(JSON.stringify(store.created)).not.toContain(token);
    expect(result).not.toHaveProperty("tokenHash");
  });

  it("consumes the exact private numeric identity without persisting plaintext", async () => {
    const store = new FakeTelegramLinkStore();
    const token = Buffer.alloc(32, 17).toString("base64url");

    await expect(
      consumeTelegramLinkToken(
        { token, telegramUserId: 7_001_234_567, telegramChatId: 7_001_234_567 },
        store,
      ),
    ).resolves.toEqual({
      organizationId: actor.organizationId,
      userId: "reviewer-1",
      linkId: "22222222-2222-4222-8222-222222222222",
    });
    expect(store.consumed).toEqual([
      {
        tokenHash: createHash("sha256").update(token).digest(),
        telegramUserId: 7_001_234_567,
        telegramChatId: 7_001_234_567,
      },
    ]);
    expect(JSON.stringify(store.consumed)).not.toContain(token);
  });

  it("rejects non-private, unsafe, or noncanonical linking identity inputs", async () => {
    const store = new FakeTelegramLinkStore();
    const token = Buffer.alloc(32, 18).toString("base64url");

    await expect(
      consumeTelegramLinkToken({ token, telegramUserId: 42, telegramChatId: -42 }, store),
    ).rejects.toMatchObject({ code: "TELEGRAM_LINK_INVALID" });
    await expect(
      consumeTelegramLinkToken(
        { token, telegramUserId: Number.MAX_SAFE_INTEGER + 1, telegramChatId: 42 },
        store,
      ),
    ).rejects.toMatchObject({ code: "TELEGRAM_LINK_INVALID" });
    await expect(
      consumeTelegramLinkToken(
        { token: `${token}=`, telegramUserId: 42, telegramChatId: 42 },
        store,
      ),
    ).rejects.toMatchObject({ code: "TELEGRAM_LINK_INVALID" });
    expect(store.consumed).toEqual([]);
  });
});
