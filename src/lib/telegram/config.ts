function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Telegram operations`);
  return value;
}

export function telegramBotToken(): string {
  return required("TELEGRAM_BOT_TOKEN");
}

export function telegramBotUsername(): string {
  const value = required("TELEGRAM_BOT_USERNAME");
  if (!/^[A-Za-z][A-Za-z0-9_]{3,30}[Bb][Oo][Tt]$/.test(value)) {
    throw new Error("TELEGRAM_BOT_USERNAME is invalid");
  }
  return value;
}

export function telegramWebhookSecret(): string {
  return required("TELEGRAM_WEBHOOK_SECRET");
}

export function approvalCronSecret(): string {
  return required("CRON_SECRET");
}
