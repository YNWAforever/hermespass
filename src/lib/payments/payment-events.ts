import { z } from "zod";

export type PaymentProviderEvent = {
  rail: string;
  eventId: string;
  type:
    | "issuing_authorization.created"
    | "issuing_authorization.updated"
    | "issuing_transaction.created";
  railAuthorizationId: string;
  status: "approved" | "declined" | "reversed" | null;
  amountCents: number | null;
  currency: string | null;
  occurredAt: Date;
};

const eventSchema = z
  .object({
    id: z.string().trim().min(1).max(255),
    type: z.enum([
      "issuing_authorization.created",
      "issuing_authorization.updated",
      "issuing_transaction.created",
      "mock.issuing_authorization.updated",
      "mock.issuing_authorization.created",
      "mock.issuing_transaction.created",
    ]),
    data: z
      .object({ object: z.record(z.string(), z.unknown()) })
      .passthrough()
      .optional(),
    authorization: z.record(z.string(), z.unknown()).optional(),
    object: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function stringField(value: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

function amountField(value: Record<string, unknown>): number | null {
  for (const key of ["amountCents", "amount"]) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return null;
}

function statusField(value: Record<string, unknown>): PaymentProviderEvent["status"] {
  const status = stringField(value, "status")?.toLowerCase();
  if (status === "approved" || status === "authorized" || status === "active") return "approved";
  if (status === "declined" || status === "denied" || status === "failed") return "declined";
  if (status === "reversed" || status === "refund" || status === "refunded") return "reversed";
  return null;
}

function occurredAtField(value: Record<string, unknown>): Date {
  const candidate = value["created"] ?? value["created_at"] ?? value["occurredAt"];
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    const milliseconds = candidate < 10_000_000_000 ? candidate * 1000 : candidate;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof candidate === "string") {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

export function parsePaymentProviderEvent(raw: string, rail: string): PaymentProviderEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  const parsed = eventSchema.safeParse(value);
  if (!parsed.success) return null;
  const object = parsed.data.data?.object ?? parsed.data.authorization ?? parsed.data.object;
  if (!object) return null;
  const authorizationId = stringField(object, "id", "authorizationId");
  if (!authorizationId) return null;
  const currency = stringField(object, "currency")?.toUpperCase() ?? null;
  return {
    rail,
    eventId: parsed.data.id,
    type: parsed.data.type.replace(/^mock\./, "") as PaymentProviderEvent["type"],
    railAuthorizationId: authorizationId,
    status: statusField(object),
    amountCents: amountField(object),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    occurredAt: occurredAtField(object),
  };
}
