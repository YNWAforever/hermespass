import { describe, expect, it } from "vitest";

import type { GatewayActionV1 } from "@/lib/policy/action";
import { evaluateGatewayPolicy, type GatewayPolicyContext } from "@/lib/policy/engine";

const action: GatewayActionV1 = {
  version: "1",
  agentDid: "did:web:hermespass.test:agents:order-bot",
  keyId: "33333333-3333-4333-8333-333333333333",
  tool: "vendor.contract",
  summary: "Authorize a signed vendor contract digest",
  justification: null,
  payloadDigest: Buffer.alloc(32, 17).toString("base64url"),
  amountCents: 15_000,
  currency: "HKD",
  merchantCategoryCode: "7399",
  nonce: "66666666-6666-4666-8666-666666666666",
  timestamp: "2026-08-18T03:00:00.000Z",
};

const context: GatewayPolicyContext = {
  now: new Date("2026-08-18T03:00:30.000Z"),
  passport: {
    active: true,
    expiresAt: new Date("2027-08-18T03:00:00.000Z"),
    scopes: ["vendor.contract"],
    spendCapCents: 100_000,
    risk: "low",
  },
  keyActive: true,
  policy: {
    version: 7,
    currency: "HKD",
    perTransactionLimitCents: 50_000,
    dailyLimitCents: 100_000,
    monthlyLimitCents: 500_000,
    approvalThresholdCents: 20_000,
    mccAllowlist: ["7399"],
    mccRequired: true,
    assignedReviewerUserId: "reviewer-1",
  },
  dailySpendCents: 20_000,
  monthlySpendCents: 100_000,
};

function decide(
  actionOverrides: Record<string, unknown> = {},
  contextOverrides: Partial<GatewayPolicyContext> = {},
) {
  return evaluateGatewayPolicy({ ...action, ...actionOverrides } as GatewayActionV1, {
    ...context,
    ...contextOverrides,
  });
}

describe("gateway policy exact first-match order", () => {
  it("orders passport lifecycle, key lifecycle, and scope before all later rules", () => {
    expect(
      decide(
        {},
        {
          passport: { ...context.passport, active: false, expiresAt: new Date(0), scopes: [] },
          keyActive: false,
          policy: null,
        },
      ).reasonCode,
    ).toBe("PASSPORT_INACTIVE");
    expect(
      decide(
        {},
        {
          passport: { ...context.passport, expiresAt: context.now, scopes: [] },
          keyActive: false,
          policy: null,
        },
      ).reasonCode,
    ).toBe("PASSPORT_EXPIRED");
    expect(
      decide(
        {},
        {
          passport: { ...context.passport, scopes: [] },
          keyActive: false,
          policy: null,
        },
      ).reasonCode,
    ).toBe("AGENT_KEY_INACTIVE");
    expect(
      decide(
        { amountCents: null, currency: null, merchantCategoryCode: null },
        { passport: { ...context.passport, scopes: [] }, policy: null },
      ).reasonCode,
    ).toBe("TOOL_OUT_OF_SCOPE");
  });

  it("allows in-scope non-spend before missing-policy and spend rules", () => {
    expect(
      decide({ amountCents: null, currency: null, merchantCategoryCode: null }, { policy: null }),
    ).toMatchObject({ decision: "allow", reasonCode: "NON_SPEND_ALLOWED" });
    expect(decide({}, { policy: null }).reasonCode).toBe("POLICY_REQUIRED");
  });

  it("orders HKD, passport cap, and required or mismatched MCC", () => {
    expect(
      decide({ currency: "USD", amountCents: 200_000, merchantCategoryCode: null }).reasonCode,
    ).toBe("CURRENCY_NOT_SUPPORTED");
    expect(decide({ amountCents: 200_000, merchantCategoryCode: null }).reasonCode).toBe(
      "PASSPORT_SPEND_CAP_EXCEEDED",
    );
    expect(decide({ merchantCategoryCode: null }).reasonCode).toBe("MCC_REQUIRED");
    expect(
      decide(
        { merchantCategoryCode: "7399", amountCents: 60_000 },
        { policy: { ...context.policy!, mccAllowlist: ["5411"] } },
      ).reasonCode,
    ).toBe("MCC_NOT_ALLOWED");
  });

  it("treats an optional nonempty MCC allowlist as authoritative on mismatch", () => {
    expect(
      decide({}, { policy: { ...context.policy!, mccRequired: false, mccAllowlist: ["5411"] } }),
    ).toMatchObject({ decision: "deny", reasonCode: "MCC_NOT_ALLOWED" });
    expect(
      decide({}, { policy: { ...context.policy!, mccRequired: false, mccAllowlist: [] } }),
    ).toMatchObject({ decision: "allow", reasonCode: "POLICY_ALLOWED" });
  });

  it("orders transaction, daily, monthly, threshold, risk, then allow", () => {
    expect(
      decide({ amountCents: 60_000 }, { dailySpendCents: 90_000, monthlySpendCents: 490_000 })
        .reasonCode,
    ).toBe("PER_TRANSACTION_LIMIT_EXCEEDED");
    expect(
      decide({ amountCents: 15_000 }, { dailySpendCents: 90_000, monthlySpendCents: 490_000 })
        .reasonCode,
    ).toBe("DAILY_LIMIT_EXCEEDED");
    expect(decide({ amountCents: 15_000 }, { monthlySpendCents: 490_000 }).reasonCode).toBe(
      "MONTHLY_LIMIT_EXCEEDED",
    );
    expect(
      decide({ amountCents: 25_000 }, { passport: { ...context.passport, risk: "high" } })
        .reasonCode,
    ).toBe("APPROVAL_REQUIRED");
    expect(decide({}, { passport: { ...context.passport, risk: "high" } }).reasonCode).toBe(
      "HIGH_RISK_REVIEW_REQUIRED",
    );
    expect(decide()).toMatchObject({ decision: "allow", reasonCode: "POLICY_ALLOWED" });
  });
});
