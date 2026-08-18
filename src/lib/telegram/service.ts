import { createHash, randomBytes } from "node:crypto";

import type { Actor } from "@/lib/auth/authorization";
import { PermissionDeniedError } from "@/lib/auth/errors";
import { createPostgresTelegramStore } from "@/lib/telegram/postgres-store";
import { telegramBotUsername } from "@/lib/telegram/config";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type TelegramLinkDto = {
  organizationId: string;
  userId: string;
  linkId: string;
};

export interface TelegramLinkStore {
  createLinkToken(input: {
    actorUserId: string;
    organizationId: string;
    targetUserId: string;
    tokenHash: Buffer;
  }): Promise<{ expiresAt: Date }>;
  consumeLinkToken(input: {
    tokenHash: Buffer;
    telegramUserId: number;
    telegramChatId: number;
  }): Promise<TelegramLinkDto>;
}

export class TelegramServiceError extends Error {
  constructor(
    readonly code:
      | "TELEGRAM_LINK_INVALID"
      | "TELEGRAM_LINK_UNAVAILABLE"
      | "TELEGRAM_IDENTITY_UNLINKED"
      | "TELEGRAM_UPDATE_INVALID",
    readonly status: 400 | 403 | 503,
  ) {
    super(code);
    this.name = "TelegramServiceError";
  }
}

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export async function createTelegramLinkToken(
  actor: Actor,
  targetUserId: string,
  store: TelegramLinkStore = createPostgresTelegramStore(),
  botUsername: string = telegramBotUsername(),
): Promise<{ deepLinkUrl: string; expiresAt: string }> {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new PermissionDeniedError();
  }
  if (!targetUserId.trim() || !/^[A-Za-z][A-Za-z0-9_]{3,30}[Bb][Oo][Tt]$/.test(botUsername)) {
    throw new TelegramServiceError("TELEGRAM_LINK_INVALID", 400);
  }
  const token = randomBytes(32).toString("base64url");
  const created = await store.createLinkToken({
    actorUserId: actor.userId,
    organizationId: actor.organizationId,
    targetUserId,
    tokenHash: tokenHash(token),
  });
  return {
    deepLinkUrl: `https://t.me/${botUsername}?start=${token}`,
    expiresAt: created.expiresAt.toISOString(),
  };
}

export async function consumeTelegramLinkToken(
  input: { token: string; telegramUserId: number; telegramChatId: number },
  store: TelegramLinkStore = createPostgresTelegramStore(),
): Promise<TelegramLinkDto> {
  if (
    !TOKEN_PATTERN.test(input.token) ||
    !Number.isSafeInteger(input.telegramUserId) ||
    input.telegramUserId <= 0 ||
    !Number.isSafeInteger(input.telegramChatId) ||
    input.telegramChatId !== input.telegramUserId
  ) {
    throw new TelegramServiceError("TELEGRAM_LINK_INVALID", 400);
  }
  try {
    return await store.consumeLinkToken({
      tokenHash: tokenHash(input.token),
      telegramUserId: input.telegramUserId,
      telegramChatId: input.telegramChatId,
    });
  } catch (error) {
    if (error instanceof TelegramServiceError) throw error;
    throw new TelegramServiceError("TELEGRAM_LINK_INVALID", 400);
  }
}
