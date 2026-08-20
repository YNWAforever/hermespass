import { createHash, randomUUID } from "node:crypto";

import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { agentAuditLogs, agentPolicies, agents, walletCards } from "@/db/schema";
import type { Actor } from "@/lib/auth/authorization";
import { PermissionDeniedError } from "@/lib/auth/errors";
import { withUserTransaction, type Transaction } from "@/lib/db";
import { activePaymentRail, type PaymentRail } from "@/lib/payments/rails";

const uuid = z.string().uuid();
const mutableStatuses = ["active", "frozen"] as const;
const PROVISIONING_STALE_AFTER_MS = 5 * 60 * 1_000;

export type WalletCardDto = {
  id: string;
  agentId: string;
  agentSlug: string;
  agentDid: string;
  rail: "mock" | "stripe" | "airwallex" | "nium";
  last4: string | null;
  brand: string | null;
  currency: string;
  status: "provisioning" | "active" | "frozen" | "canceled";
  policyVersion: number;
  createdAt: string;
  updatedAt: string;
  frozenAt: string | null;
};

export type CardTransactionRunner = <T>(callback: (tx: Transaction) => Promise<T>) => Promise<T>;

export type CardServiceOptions = {
  rail?: PaymentRail;
  runTransaction?: CardTransactionRunner;
};

export class CardServiceError extends Error {
  constructor(
    readonly code:
      | "AGENT_NOT_FOUND"
      | "POLICY_REQUIRED"
      | "CARD_NOT_FOUND"
      | "RAIL_PROVISION_FAILED"
      | "RAIL_STATUS_FAILED",
  ) {
    super(code);
    this.name = "CardServiceError";
  }
}

type CardSelection = {
  card: typeof walletCards.$inferSelect;
  agentSlug: string;
  agentDid: string;
};

function cardDto(value: CardSelection): WalletCardDto {
  const pending = value.card.status === "provisioning" || value.card.status === "canceled";
  return {
    id: value.card.id,
    agentId: value.card.agentId,
    agentSlug: value.agentSlug,
    agentDid: value.agentDid,
    rail: value.card.rail as WalletCardDto["rail"],
    last4: pending ? null : value.card.last4,
    brand: pending ? null : value.card.brand,
    currency: value.card.currency,
    status: value.card.status,
    policyVersion: value.card.policyVersion,
    createdAt: value.card.createdAt.toISOString(),
    updatedAt: value.card.updatedAt.toISOString(),
    frozenAt: value.card.frozenAt?.toISOString() ?? null,
  };
}

function assertCanMutate(actor: Actor): void {
  if (actor.role !== "owner" && actor.role !== "admin") throw new PermissionDeniedError();
}

function runner(actor: Actor, options: CardServiceOptions): CardTransactionRunner {
  return options.runTransaction ?? ((callback) => withUserTransaction(actor.userId, callback));
}

async function lockAgent(tx: Transaction, agentId: string): Promise<void> {
  await tx.execute(sql`select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hermes.agent:' || ${agentId}::text, 0)
  )`);
}

function cardIdempotencyKey(organizationId: string, agentId: string): string {
  return `hermes-card-${createHash("sha256").update(`${organizationId}:${agentId}`).digest("hex")}`;
}

function normalizeCardholderName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function cardholderIdempotencyKey(organizationId: string, cardholderName: string): string {
  return `hermes-cardholder-${createHash("sha256")
    .update(`${organizationId}:${cardholderName}`)
    .digest("hex")}`;
}

function pendingProviderId(key: string): string {
  return `pending_${key}`;
}

async function selectCard(
  tx: Transaction,
  organizationId: string,
  cardId: string,
): Promise<CardSelection | null> {
  const rows = await tx
    .select({ card: walletCards, agentSlug: agents.slug, agentDid: agents.did })
    .from(walletCards)
    .innerJoin(
      agents,
      and(
        eq(agents.id, walletCards.agentId),
        eq(agents.organizationId, walletCards.organizationId),
      ),
    )
    .where(and(eq(walletCards.id, cardId), eq(walletCards.organizationId, organizationId)))
    .limit(1);
  return rows[0] ?? null;
}

async function cancelReservation(
  runTransaction: CardTransactionRunner,
  organizationId: string,
  agentId: string,
  cardId: string,
  attemptToken: string,
): Promise<void> {
  await runTransaction(async (tx) => {
    await lockAgent(tx, agentId);
    await tx
      .update(walletCards)
      .set({ status: "canceled", provisioningToken: null, frozenAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(walletCards.id, cardId),
          eq(walletCards.organizationId, organizationId),
          eq(walletCards.agentId, agentId),
          eq(walletCards.status, "provisioning"),
          eq(walletCards.provisioningToken, attemptToken),
        ),
      );
  });
}

export async function listWalletCards(actor: Actor): Promise<WalletCardDto[]> {
  return withUserTransaction(actor.userId, async (tx) => {
    const rows = await tx
      .select({ card: walletCards, agentSlug: agents.slug, agentDid: agents.did })
      .from(walletCards)
      .innerJoin(
        agents,
        and(
          eq(agents.id, walletCards.agentId),
          eq(agents.organizationId, walletCards.organizationId),
        ),
      )
      .where(eq(walletCards.organizationId, actor.organizationId))
      .orderBy(desc(walletCards.createdAt));
    return rows.map(cardDto);
  });
}

export async function provisionCard(
  actor: Actor,
  agentIdInput: string,
  options: CardServiceOptions = {},
): Promise<{ card: WalletCardDto; replayed: boolean }> {
  assertCanMutate(actor);
  const agentId = uuid.parse(agentIdInput);
  const paymentRail = options.rail ?? activePaymentRail();
  const runTransaction = runner(actor, options);
  const key = cardIdempotencyKey(actor.organizationId, agentId);
  const cardholderName = normalizeCardholderName(actor.organizationName);
  const cardholderKey = cardholderIdempotencyKey(actor.organizationId, cardholderName);
  const attemptToken = randomUUID();
  const pendingId = pendingProviderId(key);
  const reservationId = randomUUID();

  const reservation = await runTransaction(async (tx) => {
    await lockAgent(tx, agentId);
    const agentRows = await tx
      .select({
        id: agents.id,
        slug: agents.slug,
        did: agents.did,
        status: agents.status,
        expiresAt: agents.expiresAt,
      })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.organizationId, actor.organizationId)))
      .limit(1);
    const agent = agentRows[0];
    if (!agent || agent.status !== "active" || agent.expiresAt.getTime() <= Date.now()) {
      throw new CardServiceError("AGENT_NOT_FOUND");
    }

    const policyRows = await tx
      .select({ version: agentPolicies.version, currency: agentPolicies.currency })
      .from(agentPolicies)
      .where(
        and(
          eq(agentPolicies.agentId, agentId),
          eq(agentPolicies.organizationId, actor.organizationId),
          eq(agentPolicies.isActive, true),
        ),
      )
      .orderBy(desc(agentPolicies.version))
      .limit(1);
    const policy = policyRows[0];
    if (!policy) throw new CardServiceError("POLICY_REQUIRED");

    const currentRows = await tx
      .select()
      .from(walletCards)
      .where(
        and(eq(walletCards.organizationId, actor.organizationId), eq(walletCards.agentId, agentId)),
      )
      .limit(1);
    const current = currentRows[0];
    const now = new Date();
    const staleBefore = new Date(now.getTime() - PROVISIONING_STALE_AFTER_MS);
    const staleProvisioning =
      current?.status === "provisioning" && current.updatedAt.getTime() <= staleBefore.getTime();
    if (current && current.status !== "canceled" && !staleProvisioning) {
      return {
        card: cardDto({ card: current, agentSlug: agent.slug, agentDid: agent.did }),
        shouldProvision: false,
      };
    }
    const values = {
      rail: paymentRail.name,
      railCardholderId: pendingId,
      railCardId: pendingId,
      last4: "0000",
      brand: "Pending",
      currency: policy.currency,
      status: "provisioning" as const,
      policyVersion: policy.version,
      provisioningToken: attemptToken,
      frozenAt: null,
      updatedAt: now,
    };
    const rows = current
      ? await tx
          .update(walletCards)
          .set(values)
          .where(
            and(
              eq(walletCards.id, current.id),
              eq(walletCards.organizationId, actor.organizationId),
              staleProvisioning
                ? and(
                    eq(walletCards.status, "provisioning"),
                    lte(walletCards.updatedAt, staleBefore),
                  )
                : eq(walletCards.status, "canceled"),
            ),
          )
          .returning()
      : await tx
          .insert(walletCards)
          .values({
            id: reservationId,
            organizationId: actor.organizationId,
            agentId,
            ...values,
            createdAt: now,
          })
          .returning();
    const card = rows[0];
    if (!card) throw new CardServiceError("RAIL_PROVISION_FAILED");
    return {
      card: cardDto({ card, agentSlug: agent.slug, agentDid: agent.did }),
      shouldProvision: true,
    };
  });

  if (!reservation.shouldProvision) return { card: reservation.card, replayed: true };

  try {
    const cardholderId = await paymentRail.ensureCardholder({
      organizationId: actor.organizationId,
      organizationName: cardholderName,
      idempotencyKey: cardholderKey,
    });
    const railCard = await paymentRail.createVirtualCard({
      cardholderId,
      agentSlug: reservation.card.agentSlug,
      policyVersion: reservation.card.policyVersion,
      currency: "HKD",
      idempotencyKey: key,
    });
    if (railCard.currency !== "HKD" || railCard.status !== "active") {
      throw new CardServiceError("RAIL_PROVISION_FAILED");
    }

    const finalized = await runTransaction(async (tx) => {
      await lockAgent(tx, agentId);
      const current = await selectCard(tx, actor.organizationId, reservation.card.id);
      if (!current) throw new CardServiceError("CARD_NOT_FOUND");
      if (current.card.status !== "provisioning") return cardDto(current);

      const updated = await tx
        .update(walletCards)
        .set({
          railCardholderId: railCard.cardholderId,
          railCardId: railCard.railCardId,
          last4: railCard.last4,
          brand: railCard.brand,
          currency: railCard.currency,
          status: "active",
          provisioningToken: null,
          frozenAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(walletCards.id, reservation.card.id),
            eq(walletCards.organizationId, actor.organizationId),
            eq(walletCards.status, "provisioning"),
            eq(walletCards.provisioningToken, attemptToken),
          ),
        )
        .returning();
      const card = updated[0];
      if (!card) throw new CardServiceError("RAIL_PROVISION_FAILED");
      await tx.insert(agentAuditLogs).values({
        organizationId: actor.organizationId,
        agentId,
        actorType: "user",
        actorId: actor.userId,
        action: "wallet.card_provisioned",
        summary: `Scoped ${paymentRail.name} card provisioned for ${reservation.card.agentSlug}`,
        decision: "allow",
        tool: "wallet.provision",
        payload: {
          cardId: card.id,
          rail: paymentRail.name,
          last4: card.last4,
          brand: card.brand,
          currency: card.currency,
          policyVersion: card.policyVersion,
        },
        hash: Buffer.alloc(32),
      });
      return cardDto({
        card,
        agentSlug: reservation.card.agentSlug,
        agentDid: reservation.card.agentDid,
      });
    });
    return { card: finalized, replayed: false };
  } catch (error) {
    await cancelReservation(
      runTransaction,
      actor.organizationId,
      agentId,
      reservation.card.id,
      attemptToken,
    ).catch(() => undefined);
    if (error instanceof CardServiceError && error.code === "CARD_NOT_FOUND") throw error;
    throw new CardServiceError("RAIL_PROVISION_FAILED");
  }
}

export async function setWalletCardStatus(
  actor: Actor,
  cardIdInput: string,
  statusInput: "active" | "frozen",
  options: CardServiceOptions = {},
): Promise<WalletCardDto> {
  assertCanMutate(actor);
  const cardId = uuid.parse(cardIdInput);
  const status = z.enum(mutableStatuses).parse(statusInput);
  const paymentRail = options.rail ?? activePaymentRail();
  const runTransaction = runner(actor, options);

  const authorized = await runTransaction(async (tx) => {
    const current = await selectCard(tx, actor.organizationId, cardId);
    if (
      !current ||
      !mutableStatuses.includes(current.card.status as (typeof mutableStatuses)[number])
    ) {
      throw new CardServiceError("CARD_NOT_FOUND");
    }
    await lockAgent(tx, current.card.agentId);
    return current;
  });
  if (authorized.card.status === status) return cardDto(authorized);

  try {
    await paymentRail.setCardStatus({
      railCardId: authorized.card.railCardId,
      status: status === "active" ? "active" : "inactive",
    });
  } catch {
    throw new CardServiceError("RAIL_STATUS_FAILED");
  }

  return runTransaction(async (tx) => {
    await lockAgent(tx, authorized.card.agentId);
    const current = await selectCard(tx, actor.organizationId, cardId);
    if (
      !current ||
      !mutableStatuses.includes(current.card.status as (typeof mutableStatuses)[number])
    ) {
      throw new CardServiceError("CARD_NOT_FOUND");
    }
    if (current.card.status === status) return cardDto(current);
    const now = new Date();
    const updated = await tx
      .update(walletCards)
      .set({ status, frozenAt: status === "frozen" ? now : null, updatedAt: now })
      .where(
        and(
          eq(walletCards.id, cardId),
          eq(walletCards.organizationId, actor.organizationId),
          inArray(walletCards.status, mutableStatuses),
        ),
      )
      .returning();
    const card = updated[0];
    if (!card) throw new CardServiceError("CARD_NOT_FOUND");
    const action = status === "frozen" ? "wallet.card_frozen" : "wallet.card_unfrozen";
    await tx.insert(agentAuditLogs).values({
      organizationId: actor.organizationId,
      agentId: card.agentId,
      actorType: "user",
      actorId: actor.userId,
      action,
      summary: `Scoped card ${status === "frozen" ? "frozen" : "unfrozen"}`,
      decision: "allow",
      tool: "wallet.status",
      payload: { cardId: card.id, status, rail: card.rail, policyVersion: card.policyVersion },
      hash: Buffer.alloc(32),
    });
    return cardDto({ card, agentSlug: current.agentSlug, agentDid: current.agentDid });
  });
}
