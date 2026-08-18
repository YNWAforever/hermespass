import { webcrypto } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { generateEd25519KeyPair } from "@/lib/identity/keys";
import {
  canonicalGatewayActionBytes,
  gatewayRequestDigests,
  type GatewayActionV1,
  type PublicEd25519Jwk,
  type SignedGatewayRequest,
} from "@/lib/policy/action";
import {
  decideGatewayRequestWithStore,
  GatewayServiceError,
  type GatewayAuditInput,
  type GatewayAuthContext,
  type GatewayInsertInput,
  type GatewayStore,
  type GatewayTransactionPort,
  type PendingApprovalInsertInput,
  type StoredGatewayDecision,
} from "@/lib/gateway/service";

const cryptoApi = globalThis.crypto ?? webcrypto;
const agentId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const keyId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const approvalId = "55555555-5555-4555-8555-555555555555";
const databaseNow = new Date("2026-08-18T03:02:00.000Z");

type SigningPair = Awaited<ReturnType<typeof generateEd25519KeyPair>>;

const baseAction: GatewayActionV1 = {
  version: "1",
  agentDid: "did:web:hermespass.test:agents:procurement-bot",
  keyId,
  tool: "vendor.contract",
  summary: "Approve the signed vendor contract digest",
  justification: "Quarterly supplier renewal",
  payloadDigest: Buffer.alloc(32, 19).toString("base64url"),
  amountCents: 10_000,
  currency: "HKD",
  merchantCategoryCode: "7399",
  nonce: "66666666-6666-4666-8666-666666666666",
  timestamp: "2026-08-18T03:00:00.000Z",
};

async function signAction(
  pair: SigningPair,
  overrides: Partial<GatewayActionV1> = {},
): Promise<SignedGatewayRequest> {
  const action = { ...baseAction, ...overrides };
  const key = await cryptoApi.subtle.importKey("jwk", pair.privateJwk, { name: "Ed25519" }, false, [
    "sign",
  ]);
  const signature = Buffer.from(
    await cryptoApi.subtle.sign({ name: "Ed25519" }, key, canonicalGatewayActionBytes(action)),
  ).toString("base64url");
  return { action, signature };
}

function authContext(publicJwk: PublicEd25519Jwk): GatewayAuthContext {
  return {
    agentId,
    organizationId,
    keyId,
    publicJwk,
    thumbprint: "gateway-thumbprint",
    agentStatus: "active",
    keyStatus: "active",
    passportExpiresAt: new Date("2027-08-18T03:00:00.000Z"),
    scopes: ["vendor.contract", "catalog.read"],
    spendCapCents: 100_000,
    risk: "low",
  };
}

function storedDecision(
  request: SignedGatewayRequest,
  overrides: Partial<StoredGatewayDecision> = {},
): StoredGatewayDecision {
  const digests = gatewayRequestDigests(request);
  return {
    requestId,
    requestDigest: digests.requestDigest,
    signatureDigest: digests.signatureDigest,
    currentDecision: "allow",
    reasonCode: "POLICY_ALLOWED",
    reason: "The action is authorized by the active policy.",
    policyVersion: 7,
    approvalId: null,
    decidedAt: databaseNow,
    currentResultUpdatedAt: databaseNow,
    authorizationExpiresAt: new Date(databaseNow.getTime() + 5 * 60_000),
    approvalExpiresAt: null,
    ...overrides,
  };
}

class FakeTransaction implements GatewayTransactionPort {
  calls: string[] = [];
  auth: GatewayAuthContext | null = null;
  existing: StoredGatewayDecision | null = null;
  inserted: GatewayInsertInput[] = [];
  approvals: PendingApprovalInsertInput[] = [];
  audits: GatewayAuditInput[] = [];
  times: Date[] = [];
  policy = {
    version: 7,
    currency: "HKD" as const,
    perTransactionLimitCents: 50_000,
    dailyLimitCents: 100_000,
    monthlyLimitCents: 500_000,
    approvalThresholdCents: 20_000,
    mccAllowlist: ["7399"],
    mccRequired: true,
    assignedReviewerUserId: "reviewer-1",
  };

  async lookupAuthContext(): Promise<GatewayAuthContext | null> {
    this.calls.push("lookup");
    return this.auth;
  }

  async setSignatureAuthenticatedClaim(): Promise<void> {
    this.calls.push("claim");
  }

  async databaseTime(): Promise<Date> {
    this.calls.push("time");
    return this.times.shift() ?? databaseNow;
  }

  async findByNonce(): Promise<StoredGatewayDecision | null> {
    this.calls.push("replay");
    return this.existing;
  }

  async lockGatewayDecision(): Promise<void> {
    this.calls.push("lock");
  }

  async getActivePolicy() {
    this.calls.push("policy");
    return this.policy;
  }

  async getSpendTotals(): Promise<{ dailySpendCents: number; monthlySpendCents: number }> {
    this.calls.push("spend");
    return { dailySpendCents: 5_000, monthlySpendCents: 25_000 };
  }

  async insertGatewayRequest(input: GatewayInsertInput): Promise<StoredGatewayDecision> {
    this.calls.push("insert-request");
    this.inserted.push(input);
    return {
      requestId,
      requestDigest: input.requestDigest,
      signatureDigest: input.signatureDigest,
      currentDecision: input.decision,
      reasonCode: input.reasonCode,
      reason: input.reason,
      policyVersion: input.policyVersion,
      approvalId: null,
      decidedAt: input.decidedAt,
      currentResultUpdatedAt: input.decidedAt,
      authorizationExpiresAt: input.authorizationExpiresAt,
      approvalExpiresAt: null,
    };
  }

  async insertPendingApproval(input: PendingApprovalInsertInput): Promise<string> {
    this.calls.push("insert-approval");
    this.approvals.push(input);
    return approvalId;
  }

  async appendAudit(input: GatewayAuditInput): Promise<void> {
    this.calls.push(`audit:${input.action}`);
    this.audits.push(input);
  }
}

function storeFor(transaction: FakeTransaction): GatewayStore {
  return {
    transaction: async (callback) => callback(transaction),
  };
}

describe("gateway transaction orchestration", () => {
  let pair: SigningPair;
  let transaction: FakeTransaction;

  beforeEach(async () => {
    pair = await generateEd25519KeyPair();
    transaction = new FakeTransaction();
    transaction.auth = authContext(pair.publicJwk as PublicEd25519Jwk);
  });

  it("normalizes unknown agents and bad signatures without a claim or audit", async () => {
    const request = await signAction(pair);
    transaction.auth = null;

    await expect(
      decideGatewayRequestWithStore(request, storeFor(transaction)),
    ).rejects.toMatchObject({ code: "AGENT_AUTH_FAILED", status: 401 });
    expect(transaction.calls).toEqual(["lookup"]);

    transaction = new FakeTransaction();
    transaction.auth = authContext(pair.publicJwk as PublicEd25519Jwk);
    const badSignature = `${request.signature.slice(0, -1)}${request.signature.endsWith("A") ? "B" : "A"}`;
    await expect(
      decideGatewayRequestWithStore({ ...request, signature: badSignature }, storeFor(transaction)),
    ).rejects.toEqual(expect.any(GatewayServiceError));
    expect(transaction.calls).toEqual(["lookup"]);
    expect(transaction.audits).toHaveLength(0);
  });

  it("returns an exact nonce replay before locking and rejects changed signed bytes", async () => {
    const request = await signAction(pair);
    transaction.existing = storedDecision(request);

    await expect(
      decideGatewayRequestWithStore(request, storeFor(transaction)),
    ).resolves.toMatchObject({
      requestId,
      decision: "allow",
      reasonCode: "POLICY_ALLOWED",
    });
    expect(transaction.calls).toEqual([
      "lookup",
      "time",
      "lock",
      "claim",
      "lookup",
      "time",
      "replay",
    ]);
    expect(transaction.inserted).toHaveLength(0);
    expect(transaction.audits).toHaveLength(0);

    const changed = await signAction(pair, { summary: "Changed signed summary" });
    await expect(
      decideGatewayRequestWithStore(changed, storeFor(transaction)),
    ).rejects.toMatchObject({ code: "NONCE_CONFLICT", status: 409 });
  });

  it("locks, evaluates, stores, and audits an allow with a five-minute authorization", async () => {
    const request = await signAction(pair);

    const result = await decideGatewayRequestWithStore(request, storeFor(transaction));

    expect(result).toEqual({
      requestId,
      decision: "allow",
      reasonCode: "POLICY_ALLOWED",
      reason: "The action is authorized by the active policy.",
      policyVersion: 7,
      approvalId: null,
      decidedAt: databaseNow.toISOString(),
      authorizationExpiresAt: "2026-08-18T03:07:00.000Z",
      retryAfterSeconds: null,
    });
    expect(transaction.calls).toEqual([
      "lookup",
      "time",
      "lock",
      "claim",
      "lookup",
      "time",
      "replay",
      "policy",
      "spend",
      "insert-request",
      "audit:gateway.decision",
    ]);
    expect(transaction.inserted[0]).not.toHaveProperty("rawParameters");
    expect(transaction.inserted[0]?.authorizationExpiresAt?.getTime()).toBe(
      databaseNow.getTime() + 5 * 60_000,
    );
    expect(JSON.stringify(transaction.audits)).not.toContain("privateJwk");
  });
  it("uses receipt time for freshness but starts authorization after the lock", async () => {
    const decisionNow = new Date("2026-08-18T03:10:00.000Z");
    transaction.times = [databaseNow, decisionNow];
    const request = await signAction(pair, {
      timestamp: "2026-08-18T03:01:59.000Z",
    });

    const result = await decideGatewayRequestWithStore(request, storeFor(transaction));

    expect(result).toMatchObject({
      decidedAt: decisionNow.toISOString(),
      authorizationExpiresAt: "2026-08-18T03:15:00.000Z",
    });
    expect(transaction.inserted[0]).toMatchObject({
      receivedAt: databaseNow,
      decidedAt: decisionNow,
    });
  });

  it("audits a valid revoked-key signature as an HTTP-200-compatible denial", async () => {
    const request = await signAction(pair);
    transaction.auth = { ...transaction.auth!, keyStatus: "revoked" };

    await expect(
      decideGatewayRequestWithStore(request, storeFor(transaction)),
    ).resolves.toMatchObject({
      decision: "deny",
      reasonCode: "AGENT_KEY_INACTIVE",
    });
    expect(transaction.inserted[0]).toMatchObject({
      decision: "deny",
      reasonCode: "AGENT_KEY_INACTIVE",
      authorizationExpiresAt: null,
    });
    expect(transaction.audits).toHaveLength(1);
  });
  it("stores an over-limit valid signature as one audited HTTP-200-compatible denial", async () => {
    const request = await signAction(pair);
    transaction.policy = { ...transaction.policy, perTransactionLimitCents: 5_000 };

    await expect(
      decideGatewayRequestWithStore(request, storeFor(transaction)),
    ).resolves.toMatchObject({
      decision: "deny",
      reasonCode: "PER_TRANSACTION_LIMIT_EXCEEDED",
    });
    expect(transaction.inserted[0]).toMatchObject({
      decision: "deny",
      reasonCode: "PER_TRANSACTION_LIMIT_EXCEEDED",
    });
    expect(transaction.audits).toHaveLength(1);
  });

  it("stores a stale signed request as one audited denial", async () => {
    const request = await signAction(pair, { timestamp: "2026-08-18T02:56:59.999Z" });

    await expect(
      decideGatewayRequestWithStore(request, storeFor(transaction)),
    ).resolves.toMatchObject({
      decision: "deny",
      reasonCode: "REQUEST_STALE",
    });
    expect(transaction.audits).toHaveLength(1);
  });

  it("creates one four-hour approval and two safe audit events for a hold", async () => {
    const request = await signAction(pair, { amountCents: 25_000 });

    await expect(
      decideGatewayRequestWithStore(request, storeFor(transaction)),
    ).resolves.toMatchObject({
      decision: "hold",
      reasonCode: "APPROVAL_REQUIRED",
      approvalId,
      retryAfterSeconds: 4 * 60 * 60,
    });
    expect(transaction.approvals).toEqual([
      expect.objectContaining({
        gatewayRequestId: requestId,
        assignedReviewerUserId: "reviewer-1",
        expiresAt: new Date(databaseNow.getTime() + 4 * 60 * 60_000),
      }),
    ]);
    expect(transaction.audits.map((entry) => entry.action)).toEqual([
      "gateway.decision",
      "approval.created",
    ]);
    expect(JSON.stringify(transaction.audits)).not.toContain(request.action.justification);
  });

  it("derives a denial when an exact stored allow authorization has expired", async () => {
    const request = await signAction(pair);
    const postLockNow = new Date(databaseNow.getTime() + 2 * 60_000);
    transaction.times = [databaseNow, postLockNow];
    transaction.existing = storedDecision(request, {
      authorizationExpiresAt: new Date(databaseNow.getTime() + 60_000),
    });

    await expect(
      decideGatewayRequestWithStore(request, storeFor(transaction)),
    ).resolves.toMatchObject({
      requestId,
      decision: "deny",
      reasonCode: "AUTHORIZATION_EXPIRED",
      authorizationExpiresAt: null,
    });
    expect(transaction.inserted).toHaveLength(0);
    expect(transaction.audits).toHaveLength(0);
  });
});
