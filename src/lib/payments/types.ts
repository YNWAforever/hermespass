export type MandateKind = "intent" | "cart";

export type MandateStatus = "active" | "consumed" | "revoked" | "expired";

export type MandateConstraints = {
  currency: "HKD";
  maxAmountCents: number;
  merchant: string | null;
  mccAllowlist: string[];
  expiresAt: string;
  oneTime: boolean;
};

export type MandateBodyV1 = {
  version: "1";
  mandateId: string;
  agentDid: string;
  keyId: string;
  kind: MandateKind;
  nonce: string;
  issuedAt: string;
  parentMandateId: string | null;
  constraints: MandateConstraints;
};

export type SignedMandateV1 = {
  body: MandateBodyV1;
  signature: string;
};

export type MandateVerificationKey = {
  id: string;
  agentId: string;
  agentDid: string;
  publicJwk: JsonWebKey;
  status: "active" | "revoked";
  custody: "external" | "legacy_encrypted";
};

export type PaymentCharge = {
  amountCents: number;
  currency: string;
  merchantName?: string | null;
  merchantCategoryCode?: string | null;
  at?: Date;
  receivedAt?: Date;
  /** Set by the caller after locking the mandate row for one-time mandates. */
  alreadyConsumed?: boolean;
  /** Alias for callers that pass the persisted mandate status directly. */
  consumed?: boolean;
};

export type MandateMatchResult =
  { matches: true } | { matches: false; reasonCode: string; reason?: string };

export type PaymentPolicyActionInput = {
  agentDid: string;
  keyId: string;
  amountCents: number;
  currency: "HKD";
  merchantCategoryCode?: string | null;
  merchantName?: string | null;
  nonce: string;
  timestamp: string | Date;
  payloadDigest?: string;
  summary?: string;
  justification?: string | null;
};

export type PaymentPolicyResult = {
  decision: "allow" | "deny" | "hold";
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
};

export type PaymentDecisionFromPolicy = {
  approved: boolean;
  reasonCode: string;
  reason: string;
  policyVersion: number | null;
};
