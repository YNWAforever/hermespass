import { createPostgresApprovalStore } from "@/lib/approvals/postgres-store";
import { resolveApproval, type ApprovalResolutionStore } from "@/lib/approvals/service";
import { createPostgresTelegramStore } from "@/lib/telegram/postgres-store";
import {
  consumeTelegramLinkToken,
  TelegramServiceError,
  type TelegramLinkStore,
} from "@/lib/telegram/service";

const CALLBACK_PATTERN =
  /^approval:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(allow|deny)$/i;
const START_PATTERN = /^\/start(?:@[A-Za-z0-9_]+)? ([A-Za-z0-9_-]{43})$/;

export interface TelegramReviewStore extends TelegramLinkStore {
  findReviewerIdentity(input: {
    approvalId: string;
    telegramUserId: number;
    telegramChatId: number;
  }): Promise<{ userId: string } | null>;
}

type Dependencies = {
  telegramStore: TelegramReviewStore;
  approvalStore: ApprovalResolutionStore;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function privateIdentity(value: unknown): { telegramUserId: number; telegramChatId: number } {
  const message = record(value);
  const from = record(message?.["from"]);
  const chat = record(message?.["chat"]);
  const telegramUserId = from?.["id"];
  const telegramChatId = chat?.["id"];
  if (
    chat?.["type"] !== "private" ||
    typeof telegramUserId !== "number" ||
    typeof telegramChatId !== "number" ||
    !Number.isSafeInteger(telegramUserId) ||
    !Number.isSafeInteger(telegramChatId) ||
    telegramUserId <= 0 ||
    telegramChatId !== telegramUserId
  ) {
    throw new TelegramServiceError("TELEGRAM_UPDATE_INVALID", 400);
  }
  return { telegramUserId, telegramChatId };
}

export async function handleTelegramUpdate(
  update: unknown,
  dependencies: Dependencies = {
    telegramStore: createPostgresTelegramStore(),
    approvalStore: createPostgresApprovalStore(),
  },
) {
  const root = record(update);
  if (!root) throw new TelegramServiceError("TELEGRAM_UPDATE_INVALID", 400);

  const message = record(root["message"]);
  if (message && typeof message["text"] === "string") {
    const start = START_PATTERN.exec(message["text"]);
    if (!start) return { kind: "ignored" as const };
    const identity = privateIdentity(message);
    const linked = await consumeTelegramLinkToken(
      { token: start[1]!, ...identity },
      dependencies.telegramStore,
    );
    return { kind: "linked" as const, userId: linked.userId };
  }

  const callback = record(root["callback_query"]);
  if (!callback) return { kind: "ignored" as const };
  const data = callback["data"];
  const match = typeof data === "string" ? CALLBACK_PATTERN.exec(data) : null;
  if (!match) throw new TelegramServiceError("TELEGRAM_UPDATE_INVALID", 400);
  const callbackMessage = record(callback["message"]);
  const identity = privateIdentity({
    from: callback["from"],
    chat: callbackMessage?.["chat"],
  });
  const approvalId = match[1]!;
  const decision = match[2]!.toLowerCase() as "allow" | "deny";
  const reviewer = await dependencies.telegramStore.findReviewerIdentity({
    approvalId,
    ...identity,
  });
  if (!reviewer) throw new TelegramServiceError("TELEGRAM_IDENTITY_UNLINKED", 403);

  const approval = await resolveApproval(
    {
      approvalId,
      decision,
      source: "telegram",
      actorUserId: reviewer.userId,
      telegramIdentity: {
        telegramUserId: identity.telegramUserId,
        telegramChatId: identity.telegramChatId,
      },
      reason:
        decision === "allow"
          ? "Approved via private Telegram review."
          : "Denied via private Telegram review.",
    },
    dependencies.approvalStore,
  );
  return { kind: "resolved" as const, approval };
}
