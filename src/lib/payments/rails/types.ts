export type PaymentAuthorizationInput = {
  eventId: string;
  railAuthorizationId: string;
  railCardId: string;
  amountCents: number;
  currency: string;
  merchantCategoryCode: string | null;
  merchantName: string | null;
  receivedAt: Date;
};

export type PaymentDecision = {
  authorizationId: string;
  approved: boolean;
  reasonCode: string;
  reason: string;
  mandateId: string | null;
  policyVersion: number | null;
  decidedAt: string;
  latencyMs: number;
};

export type RailCard = {
  railCardId: string;
  cardholderId: string;
  last4: string;
  brand: string;
  currency: string;
  status: "active" | "inactive";
};

export interface PaymentRail {
  readonly name: "mock" | "stripe" | "airwallex" | "nium";
  ensureCardholder(input: {
    organizationId: string;
    organizationName: string;
    idempotencyKey: string;
  }): Promise<string>;
  createVirtualCard(input: {
    cardholderId: string;
    agentSlug: string;
    policyVersion: number;
    currency: "HKD" | "USD";
    idempotencyKey: string;
  }): Promise<RailCard>;
  updateCardControls(input: { railCardId: string; policyVersion: number }): Promise<void>;
  setCardStatus(input: { railCardId: string; status: "active" | "inactive" }): Promise<void>;
  verifyAuthorizationWebhook(
    payload: string,
    signature: string | null,
  ): PaymentAuthorizationInput | null;
  parseAuthorizationRequest(event: unknown): PaymentAuthorizationInput | null;
  directDecisionBody(decision: PaymentDecision): { approved: boolean };
}
