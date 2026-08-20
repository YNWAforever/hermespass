import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  withPublicDatabase: (
    callback: (database: { transaction: typeof mocks.transaction }) => unknown,
  ) => callback({ transaction: mocks.transaction }),
}));

beforeEach(() => {
  mocks.transaction.mockReset();
});

describe("PostgreSQL Telegram store error normalization", () => {
  it("maps a nested single-use token SQLSTATE to the stable invalid-link error", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce({ cause: { cause: { code: "P0002" } } });
    mocks.transaction.mockImplementation((callback) => callback({ execute }));
    const { createPostgresTelegramStore } = await import("@/lib/telegram/postgres-store");
    const store = createPostgresTelegramStore();

    await expect(
      store.consumeLinkToken({
        tokenHash: Buffer.alloc(32, 7),
        telegramUserId: 7_001_234_567,
        telegramChatId: 7_001_234_567,
      }),
    ).rejects.toMatchObject({ code: "TELEGRAM_LINK_INVALID", status: 400 });
  });
});
