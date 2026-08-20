export const ASIA_HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";
export const MAX_ACTION_AGE_MS = 5 * 60 * 1_000;
export const ALLOW_AUTHORIZATION_MS = 5 * 60 * 1_000;
export const HOLD_EXPIRY_MS = 4 * 60 * 60 * 1_000;

export type GatewayTimeState = {
  fresh: boolean;
  authorizationExpiresAt: Date;
  holdExpiresAt: Date;
};

export function gatewayTimeState(timestamp: string, now: Date): GatewayTimeState {
  const signedAt = new Date(timestamp);
  const delta = now.getTime() - signedAt.getTime();
  return {
    fresh: Number.isFinite(signedAt.getTime()) && delta >= 0 && delta <= MAX_ACTION_AGE_MS,
    authorizationExpiresAt: new Date(now.getTime() + ALLOW_AUTHORIZATION_MS),
    holdExpiresAt: new Date(now.getTime() + HOLD_EXPIRY_MS),
  };
}

export function hongKongWindowStarts(now: Date): { dayStart: Date; monthStart: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ASIA_HONG_KONG_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values["year"]);
  const month = Number(values["month"]);
  const day = Number(values["day"]);
  const hongKongOffsetMs = 8 * 60 * 60 * 1_000;

  return {
    dayStart: new Date(Date.UTC(year, month - 1, day) - hongKongOffsetMs),
    monthStart: new Date(Date.UTC(year, month - 1, 1) - hongKongOffsetMs),
  };
}
