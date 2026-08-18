import { describe, expect, it } from "vitest";

import { paymentDecisionFromPolicy, toPaymentPolicyAction } from "@/lib/payments/policy-adapter";

describe("payment policy adapter", () => {
  it("maps payment spend to checkout.external", () => {
    expect(
      toPaymentPolicyAction({
        agentDid: "did:web:hermespass.asia:agent:demo-agent",
        amountCents: 1200,
        currency: "HKD",
        merchantCategoryCode: "5734",
        merchantName: "AWS",
        nonce: "payment-1",
        timestamp: "2026-08-18T01:00:00.000Z",
      }),
    ).toMatchObject({
      tool: "checkout.external",
      amountCents: 1200,
      currency: "HKD",
      merchantCategoryCode: "5734",
    });
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
