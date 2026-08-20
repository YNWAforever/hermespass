import { randomUUID } from "node:crypto";

import { assertCanMutate, type Actor, withActorTransaction } from "@/lib/auth/authorization";
import type { Transaction } from "@/lib/db";
import { MockInsurer } from "./mock-insurer";
import {
  finalizeInsuranceBind,
  getInsuranceAgentContext,
  insertInsuranceQuote,
  listInsurancePolicies as listStoredPolicies,
  reserveInsuranceBind,
  type InsuranceAgentContext,
  type InsurancePolicyDto,
} from "./store";
import type { InsurerAdapter } from "./types";

export type { InsurancePolicyDto } from "./store";

export type InsuranceService = {
  listPolicies(actor: Actor, cursor: string | null, limit: number): Promise<InsurancePolicyDto[]>;
  quote(actor: Actor, agentId: string): Promise<InsurancePolicyDto>;
  bind(actor: Actor, policyId: string): Promise<InsurancePolicyDto>;
};

export type InsuranceServicePorts = {
  withActorTransaction: (
    actor: Actor,
    callback: (tx: Transaction) => Promise<unknown>,
  ) => Promise<unknown>;
  getAgentContext: (tx: Transaction, agentId: string) => Promise<InsuranceAgentContext | null>;
  listPolicies: (
    tx: Transaction,
    organizationId: string,
    cursor: Date | null,
    limit: number,
  ) => Promise<InsurancePolicyDto[]>;
  insertQuote: (
    tx: Transaction,
    input: {
      organizationId: string;
      agentId: string;
      insurerQuoteId: string;
      coverageCents: number;
      premiumCents: number;
      quotedAt: string;
      expiresAt: string;
    },
  ) => Promise<InsurancePolicyDto>;
  reserveBind?: (
    tx: Transaction,
    policyId: string,
    attemptId: string,
    expiresAt: string,
  ) => Promise<InsurancePolicyDto>;
  finalizeBind?: (
    tx: Transaction,
    input: {
      policyId: string;
      attemptId: string;
      insurerPolicyId: string;
      boundAt: string;
      expiresAt: string;
    },
  ) => Promise<InsurancePolicyDto>;
  adapter: InsurerAdapter;
};

const defaultPorts: InsuranceServicePorts = {
  withActorTransaction,
  getAgentContext: getInsuranceAgentContext,
  listPolicies: listStoredPolicies,
  insertQuote: insertInsuranceQuote,
  reserveBind: reserveInsuranceBind,
  finalizeBind: finalizeInsuranceBind,
  adapter: new MockInsurer(),
};

function normalizeLimit(limit: number): number {
  return Math.min(Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 50, 1), 100);
}

export function createInsuranceService(
  ports: InsuranceServicePorts = defaultPorts,
): InsuranceService {
  return {
    async listPolicies(actor, cursor, limit) {
      const parsedCursor = cursor === null ? null : new Date(cursor);
      if (parsedCursor && Number.isNaN(parsedCursor.getTime()))
        throw new Error("INSURANCE_CURSOR_INVALID");
      return (await ports.withActorTransaction(actor, (tx) =>
        ports.listPolicies(tx, actor.organizationId, parsedCursor, normalizeLimit(limit)),
      )) as InsurancePolicyDto[];
    },

    async quote(actor, agentId) {
      assertCanMutate(actor);
      const context = (await ports.withActorTransaction(actor, (tx) =>
        ports.getAgentContext(tx, agentId),
      )) as InsuranceAgentContext | null;
      if (
        !context ||
        context.organizationId !== actor.organizationId ||
        context.status !== "active" ||
        new Date(context.expiresAt) <= new Date()
      )
        throw new Error("AGENT_NOT_FOUND");
      const quote = await ports.adapter.quote({
        agentDid: context.did,
        riskTier: context.riskTier,
        idempotencyKey: `insurance-quote:${context.agentId}`,
      });
      return (await ports.withActorTransaction(actor, (tx) =>
        ports.insertQuote(tx, {
          organizationId: actor.organizationId,
          agentId: context.agentId,
          insurerQuoteId: quote.insurerQuoteId,
          coverageCents: quote.coverageCents,
          premiumCents: quote.premiumCents,
          quotedAt: new Date().toISOString(),
          expiresAt: quote.expiresAt,
        }),
      )) as InsurancePolicyDto;
    },

    async bind(actor, policyId) {
      assertCanMutate(actor);
      const attemptId = randomUUID();
      const attemptExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const reserveBind = ports.reserveBind;
      const finalizeBind = ports.finalizeBind;
      if (!reserveBind || !finalizeBind) throw new Error("INSURANCE_BIND_UNAVAILABLE");
      const reserved = (await ports.withActorTransaction(actor, (tx) =>
        reserveBind(tx, policyId, attemptId, attemptExpiresAt),
      )) as InsurancePolicyDto;
      if (reserved.status === "active") return reserved;
      if (!reserved.insurerQuoteId) throw new Error("INSURANCE_POLICY_INVALID");
      const bound = await ports.adapter.bind({
        quoteId: reserved.insurerQuoteId,
        idempotencyKey: `insurance-bind:${policyId}`,
      });
      return (await ports.withActorTransaction(actor, (tx) =>
        finalizeBind!(tx, {
          policyId,
          attemptId,
          insurerPolicyId: bound.insurerPolicyId,
          boundAt: bound.boundAt,
          expiresAt: bound.expiresAt,
        }),
      )) as InsurancePolicyDto;
    },
  };
}

const service = createInsuranceService();
export const listPolicies = service.listPolicies;
export const quote = service.quote;
export const bind = service.bind;
