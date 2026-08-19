import { sql } from "drizzle-orm";

import { withPublicDatabase, type Transaction } from "@/lib/db";
import type { PaymentProviderEvent } from "@/lib/payments/payment-events";

export type PaymentEventTransactionRunner = <T>(
  callback: (transaction: Transaction) => Promise<T>,
) => Promise<T>;

export interface PaymentEventStore {
  record(event: PaymentProviderEvent): Promise<boolean>;
}

async function setWorkerClaim(transaction: Transaction): Promise<void> {
  await transaction.execute(sql`select public.hermes_set_payment_worker_claim()`);
}

const runPublicTransaction: PaymentEventTransactionRunner = (callback) =>
  withPublicDatabase((database) => database.transaction(callback));

export function createPostgresPaymentEventStore(
  runTransaction: PaymentEventTransactionRunner = runPublicTransaction,
): PaymentEventStore {
  return {
    record: (event) =>
      runTransaction(async (transaction) => {
        await setWorkerClaim(transaction);
        const result = await transaction.execute(sql`
          select public.hermes_apply_payment_provider_event(${JSON.stringify({
            ...event,
            occurredAt: event.occurredAt.toISOString(),
          })}::jsonb) as applied
        `);
        return Boolean((result.rows[0] as { applied?: boolean } | undefined)?.applied);
      }),
  };
}
