import { sql } from "drizzle-orm";

import { withPublicDatabase, type Transaction } from "@/lib/db";

export type PaymentAuthorizationInput = {
  organizationId: string;
  agentId: string;
  walletCardId: string;
  rail: string;
  eventId: string;
  railAuthorizationId: string;
  amountCents: number;
  currency: string;
  merchantCategoryCode?: string | null;
  merchantName?: string | null;
  mandateId?: string | null;
  decision: "allow" | "deny";
  status: "pending" | "approved" | "declined" | "reversed";
  reasonCode: string;
  reason: string;
  policyVersion?: number | null;
  latencyMs: number;
  receivedAt: Date;
  decidedAt: Date;
  reversedAt?: Date | null;
};

export type PaymentAuthorizationRow = {
  id: string;
  organizationId: string;
  agentId: string;
  walletCardId: string;
  rail: string;
  eventId: string;
  railAuthorizationId: string;
  amountCents: number;
  currency: string;
  merchantCategoryCode: string | null;
  merchantName: string | null;
  mandateId: string | null;
  decision: "allow" | "deny";
  status: "pending" | "approved" | "declined" | "reversed";
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
  latencyMs: number;
  receivedAt: Date;
  decidedAt: Date;
  reversedAt: Date | null;
};

export type PaymentSpendTotals = {
  spentTodayCents: number;
  spentMonthCents: number;
};

export type PaymentActor =
  | { kind: "user"; userId: string }
  | { kind: "agent"; agentId: string; organizationId: string; keyId: string };

type PaymentTransactionCallback<T> = (transaction: Transaction) => Promise<T>;
export type PaymentTransactionRunner = <T>(callback: PaymentTransactionCallback<T>) => Promise<T>;

async function setPaymentActor(transaction: Transaction, actor: PaymentActor): Promise<void> {
  if (actor.kind === "user") {
    await transaction.execute(sql`select set_config('hermes.user_id', ${actor.userId}, true)`);
    await transaction.execute(sql`select set_config('hermes.agent_verified', '0', true)`);
    return;
  }

  await transaction.execute(sql`select set_config('hermes.user_id', '', true)`);
  await transaction.execute(sql`
    select public.hermes_set_verified_agent_claim(
      ${actor.agentId}::uuid,
      ${actor.organizationId}::uuid,
      ${actor.keyId}::uuid
    )
  `);
}

export function createPaymentTransactionRunner(actor?: PaymentActor): PaymentTransactionRunner {
  return (callback) =>
    withPublicDatabase((database) =>
      database.transaction(async (transaction) => {
        if (actor) await setPaymentActor(transaction, actor);
        return callback(transaction);
      }),
    );
}

const defaultRunner = createPaymentTransactionRunner();

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function asPaymentRow(row: Record<string, unknown>): PaymentAuthorizationRow {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    agentId: String(row["agent_id"]),
    walletCardId: String(row["wallet_card_id"]),
    rail: String(row["rail"]),
    eventId: String(row["event_id"]),
    railAuthorizationId: String(row["rail_authorization_id"]),
    amountCents: Number(row["amount_cents"]),
    currency: String(row["currency"]),
    merchantCategoryCode:
      row["merchant_category_code"] == null ? null : String(row["merchant_category_code"]),
    merchantName: row["merchant_name"] == null ? null : String(row["merchant_name"]),
    mandateId: row["mandate_id"] == null ? null : String(row["mandate_id"]),
    decision: row["decision"] as PaymentAuthorizationRow["decision"],
    status: row["status"] as PaymentAuthorizationRow["status"],
    reasonCode: String(row["reason_code"]),
    reason: String(row["reason"]),
    policyVersion: row["policy_version"] == null ? null : Number(row["policy_version"]),
    latencyMs: Number(row["latency_ms"]),
    receivedAt: asDate(row["received_at"] as Date | string),
    decidedAt: asDate(row["decided_at"] as Date | string),
    reversedAt: row["reversed_at"] == null ? null : asDate(row["reversed_at"] as Date | string),
  };
}

function dateEqual(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function paymentRowsEqual(
  stored: PaymentAuthorizationRow,
  input: PaymentAuthorizationInput,
): boolean {
  return (
    stored.organizationId === input.organizationId &&
    stored.agentId === input.agentId &&
    stored.walletCardId === input.walletCardId &&
    stored.rail === input.rail &&
    stored.eventId === input.eventId &&
    stored.railAuthorizationId === input.railAuthorizationId &&
    stored.amountCents === input.amountCents &&
    stored.currency === input.currency &&
    stored.merchantCategoryCode === (input.merchantCategoryCode ?? null) &&
    stored.merchantName === (input.merchantName ?? null) &&
    stored.mandateId === (input.mandateId ?? null) &&
    stored.decision === input.decision &&
    stored.status === input.status &&
    stored.reasonCode === input.reasonCode &&
    stored.reason === input.reason &&
    stored.policyVersion === (input.policyVersion ?? null) &&
    stored.latencyMs === input.latencyMs &&
    dateEqual(stored.receivedAt, input.receivedAt) &&
    dateEqual(stored.decidedAt, input.decidedAt) &&
    dateEqual(stored.reversedAt, input.reversedAt ?? null)
  );
}

async function assertPaymentActorContext(transaction: Transaction): Promise<void> {
  const result = await transaction.execute(sql`
    select
      public.hermes_current_user_id() as user_id,
      pg_catalog.current_setting('hermes.agent_verified', true) as agent_verified,
      pg_catalog.current_setting('hermes.agent_id', true) as agent_id,
      pg_catalog.current_setting('hermes.agent_organization_id', true) as agent_organization_id
  `);
  const row = result.rows[0] as
    | {
        user_id: string | null;
        agent_verified: string | null;
        agent_id: string | null;
        agent_organization_id: string | null;
      }
    | undefined;
  const hasUser = Boolean(row?.user_id);
  const hasAgent =
    row?.agent_verified === "1" && Boolean(row.agent_id) && Boolean(row.agent_organization_id);
  if (!hasUser && !hasAgent) throw new Error("PAYMENT_ACTOR_CONTEXT_REQUIRED");
}

export async function lockPaymentAgent(transaction: Transaction, agentId: string): Promise<void> {
  const lockKey = "hermes.agent:" + agentId;
  await transaction.execute(sql`
    select pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(${lockKey}, 0)
    )
  `);
}

function isPaymentActor(value: PaymentActor | PaymentTransactionRunner): value is PaymentActor {
  return typeof value === "object" && value !== null && "kind" in value;
}

export function withPaymentTransaction<T>(
  callback: PaymentTransactionCallback<T>,
  runnerOrActor: PaymentTransactionRunner | PaymentActor = defaultRunner,
  explicitRunner?: PaymentTransactionRunner,
): Promise<T> {
  const actor = isPaymentActor(runnerOrActor) ? runnerOrActor : undefined;
  const runner: PaymentTransactionRunner = actor
    ? (explicitRunner ?? createPaymentTransactionRunner(actor))
    : (runnerOrActor as PaymentTransactionRunner);
  return runner(async (transaction) => {
    if (actor && explicitRunner) await setPaymentActor(transaction, actor);
    await assertPaymentActorContext(transaction);
    return callback(transaction);
  });
}

async function recordPaymentAuthorizationInTransaction(
  transaction: Transaction,
  input: PaymentAuthorizationInput,
): Promise<PaymentAuthorizationRow> {
  await lockPaymentAgent(transaction, input.agentId);
  const payload = {
    ...input,
    receivedAt: input.receivedAt.toISOString(),
    decidedAt: input.decidedAt.toISOString(),
    reversedAt: input.reversedAt?.toISOString() ?? null,
  };
  const result = await transaction.execute(sql`
    select * from public.hermes_record_payment_authorization(
      ${JSON.stringify(payload)}::jsonb
    )
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("PAYMENT_AUTHORIZATION_INSERT_FAILED");
  const stored = asPaymentRow(row);
  if (!paymentRowsEqual(stored, input)) {
    const error = new Error("PAYMENT_EVENT_CONFLICT") as Error & { code?: string };
    error.code = "23505";
    throw error;
  }
  return stored;
}

export async function recordPaymentAuthorization(
  input: PaymentAuthorizationInput,
  runner?: PaymentTransactionRunner,
): Promise<PaymentAuthorizationRow>;
export async function recordPaymentAuthorization(
  input: PaymentAuthorizationInput,
  actor: PaymentActor,
  runner?: PaymentTransactionRunner,
): Promise<PaymentAuthorizationRow>;
export async function recordPaymentAuthorization(
  input: PaymentAuthorizationInput,
  runnerOrActor: PaymentTransactionRunner | PaymentActor = defaultRunner,
  explicitRunner?: PaymentTransactionRunner,
): Promise<PaymentAuthorizationRow> {
  return withPaymentTransaction(
    (transaction) => recordPaymentAuthorizationInTransaction(transaction, input),
    runnerOrActor,
    explicitRunner,
  );
}

async function readPaymentSpendTotalsInTransaction(
  transaction: Transaction,
  agentId: string,
  organizationId: string,
  dayStart: Date,
  monthStart: Date,
): Promise<PaymentSpendTotals> {
  const result = await transaction.execute(sql`
    select spent_today_cents, spent_month_cents
    from public.hermes_payment_spend_totals(
      ${agentId}::uuid,
      ${organizationId}::uuid,
      ${dayStart}::timestamptz,
      ${monthStart}::timestamptz
    )
  `);
  const row = result.rows[0] as
    { spent_today_cents: number | string; spent_month_cents: number | string } | undefined;
  return {
    spentTodayCents: Number(row?.spent_today_cents ?? 0),
    spentMonthCents: Number(row?.spent_month_cents ?? 0),
  };
}

export async function readPaymentSpendTotals(
  agentId: string,
  organizationId: string,
  dayStart: Date,
  monthStart: Date,
  runner?: PaymentTransactionRunner,
): Promise<PaymentSpendTotals>;
export async function readPaymentSpendTotals(
  agentId: string,
  organizationId: string,
  dayStart: Date,
  monthStart: Date,
  actor: PaymentActor,
  runner?: PaymentTransactionRunner,
): Promise<PaymentSpendTotals>;
export async function readPaymentSpendTotals(
  agentId: string,
  organizationId: string,
  dayStart: Date,
  monthStart: Date,
  runnerOrActor: PaymentTransactionRunner | PaymentActor = defaultRunner,
  explicitRunner?: PaymentTransactionRunner,
): Promise<PaymentSpendTotals> {
  return withPaymentTransaction(
    (transaction) =>
      readPaymentSpendTotalsInTransaction(
        transaction,
        agentId,
        organizationId,
        dayStart,
        monthStart,
      ),
    runnerOrActor,
    explicitRunner,
  );
}
