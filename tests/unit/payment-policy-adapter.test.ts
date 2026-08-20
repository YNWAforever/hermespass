import { describe, expect, it } from "vitest";

import { paymentDecisionFromPolicy, toPaymentPolicyAction } from "@/lib/payments/policy-adapter";

describe("payment policy adapter", () => {
  it("maps payment spend to checkout.external", () => {
    expect(
      toPaymentPolicyAction({
        agentDid: "did:web:hermespass.asia:agent:demo-agent",
        keyId: "fbb9a6a1-2d6b-4f4c-8c29-6c7c4f0a54dd",
        amountCents: 1200,
        currency: "HKD",
        merchantCategoryCode: "5734",
        merchantName: "AWS",
        nonce: "7d5b9d85-f7c8-4b94-9610-1a5c4e6a8d60",
        timestamp: "2026-08-18T01:00:00.000Z",
      }),
    ).toMatchObject({
      tool: "checkout.external",
      amountCents: 1200,
      currency: "HKD",
      merchantCategoryCode: "5734",
    });
  });

  it.each([
    ["missing key id", { keyId: undefined }, "PAYMENT_KEY_ID_REQUIRED"],
    ["invalid key id", { keyId: "not-a-uuid" }, "PAYMENT_KEY_ID_INVALID"],
    ["invalid nonce", { nonce: "payment-1" }, "PAYMENT_ACTION_INVALID"],
    ["invalid agent DID", { agentDid: "agent-1" }, "PAYMENT_ACTION_INVALID"],
    ["oversized justification", { justification: "x".repeat(1001) }, "PAYMENT_ACTION_INVALID"],
  ])("rejects %s before emitting an invalid action", (_label, override, code) => {
    expect(() =>
      toPaymentPolicyAction({
        agentDid: "did:web:hermespass.asia:agent:demo-agent",
        keyId: "fbb9a6a1-2d6b-4f4c-8c29-6c7c4f0a54dd",
        amountCents: 1200,
        currency: "HKD",
        merchantCategoryCode: "5734",
        merchantName: "AWS",
        nonce: "7d5b9d85-f7c8-4b94-9610-1a5c4e6a8d60",
        timestamp: "2026-08-18T01:00:00.000Z",
        ...override,
      } as import("@/lib/payments/types").PaymentPolicyActionInput),
    ).toThrowError(expect.objectContaining({ code }));
  });
  it("turns policy hold into synchronous preauthorization denial", () => {
    expect(
      paymentDecisionFromPolicy({
        decision: "hold",
        reasonCode: "APPROVAL_REQUIRED",
        reason: "review",
        policyVersion: 3,
      }),
    ).toMatchObject({
      approved: false,
      reasonCode: "PAYMENT_REQUIRES_PREAUTHORIZATION",
      policyVersion: 3,
    });
  });

  it("preserves allow and deny reasons", () => {
    expect(
      paymentDecisionFromPolicy({
        decision: "allow",
        reasonCode: "POLICY_ALLOWED",
        reason: "authorized",
        policyVersion: 4,
      }),
    ).toEqual({
      approved: true,
      reasonCode: "POLICY_ALLOWED",
      reason: "authorized",
      policyVersion: 4,
    });
    expect(
      paymentDecisionFromPolicy({
        decision: "deny",
        reasonCode: "MCC_NOT_ALLOWED",
        reason: "blocked",
        policyVersion: 4,
      }),
    ).toEqual({
      approved: false,
      reasonCode: "MCC_NOT_ALLOWED",
      reason: "blocked",
      policyVersion: 4,
    });
  });
});
