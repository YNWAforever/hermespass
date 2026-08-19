import { createHash, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { withPublicDatabase, type Transaction } from "@/lib/db";
import { insuranceWebhookSecret } from "@/lib/env";

export const MAX_INSURANCE_WEBHOOK_BYTES = 16 * 1024;

const eventSchema = z.object({
  eventId: z.string().trim().min(1).max(255),
  insurer: z.enum(["mock", "aia", "zurich"]),
  insurerPolicyId: z.string().trim().min(1).max(255),
  event: z.enum(["lapsed", "canceled", "renewed"]),
  effectiveAt: z.string().datetime({ offset: true }),
});

export type InsuranceWebhookEvent = z.infer<typeof eventSchema>;

export function verifyInsuranceWebhookSecret(candidate: string | null, expected: string): boolean {
  if (!candidate || !expected) return false;
  const actualBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function parseInsuranceWebhookBody(body: Uint8Array): InsuranceWebhookEvent {
  if (body.byteLength > MAX_INSURANCE_WEBHOOK_BYTES) throw new Error("INSURANCE_WEBHOOK_TOO_LARGE");
  let raw: string;
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new Error("INSURANCE_WEBHOOK_INVALID");
  }
  try {
    const parsed = eventSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error("INSURANCE_WEBHOOK_INVALID");
    return parsed.data;
  } catch (error) {
    if (error instanceof Error && error.message === "INSURANCE_WEBHOOK_INVALID") throw error;
    throw new Error("INSURANCE_WEBHOOK_INVALID");
  }
}

export function canonicalInsuranceWebhookEvent(event: InsuranceWebhookEvent): {
  payload: InsuranceWebhookEvent;
  digest: string;
} {
  const serialized = canonicalize(event);
  if (!serialized) throw new Error("INSURANCE_WEBHOOK_INVALID");
  return {
    payload: event,
    digest: createHash("sha256").update(serialized, "utf8").digest("hex"),
  };
}

export type InsuranceEventStore = {
  apply(event: InsuranceWebhookEvent): Promise<boolean>;
};

type TransactionRunner = <T>(callback: (transaction: Transaction) => Promise<T>) => Promise<T>;

const runPublicTransaction: TransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

export function createPostgresInsuranceEventStore(
  runTransaction: TransactionRunner = runPublicTransaction,
): InsuranceEventStore {
  return {
    apply: (event) =>
      runTransaction(async (transaction) => {
        const canonical = canonicalInsuranceWebhookEvent(event);
        await transaction.execute(sql`select public.hermes_set_insurance_worker_claim()`);
        const result = await transaction.execute(sql`
          select public.hermes_insurance_provider_event(${JSON.stringify({
            insurer: canonical.payload.insurer,
            insurerPolicyId: canonical.payload.insurerPolicyId,
            providerEventId: canonical.payload.eventId,
            eventKind: canonical.payload.event,
            effectiveAt: canonical.payload.effectiveAt,
            payloadDigest: canonical.digest,
          })}::jsonb) as applied
        `);
        return Boolean((result.rows[0] as { applied?: boolean } | undefined)?.applied);
      }),
  };
}

export async function applyInsuranceWebhookEvent(event: InsuranceWebhookEvent): Promise<boolean> {
  return createPostgresInsuranceEventStore().apply(event);
}

export function insuranceWebhookSecretForRequest(): string {
  return insuranceWebhookSecret();
}
