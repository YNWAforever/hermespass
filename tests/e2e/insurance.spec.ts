import { expect, test } from "@playwright/test";

import { E2E_AUTH_STORAGE_STATE } from "./support/auth-state";

const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";

test.describe("insurance API acceptance", () => {
  test.use({ storageState: E2E_AUTH_STORAGE_STATE });

  test("keeps quote and bind envelopes safe and organization-free in the browser contract", async ({
    page,
  }) => {
    let quoteBody: Record<string, unknown> | undefined;
    let bindBody: Record<string, unknown> | undefined;
    await page.route("**/api/insurance/quote", async (route) => {
      quoteBody = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            policy: {
              id: "11111111-1111-4111-8111-111111111111",
              status: "quoted",
              riskTier: "medium",
              coverageCents: 200000000,
              premiumCents: 25000,
              commissionCents: 5000,
            },
          },
        }),
      });
    });
    await page.route("**/api/insurance/bind", async (route) => {
      bindBody = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            policy: {
              id: "11111111-1111-4111-8111-111111111111",
              status: "active",
              insurerPolicyId: "mockp_e2e",
              coverageCents: 200000000,
              premiumCents: 25000,
              commissionCents: 5000,
            },
          },
        }),
      });
    });

    await page.goto(`${NEXT_BASE_URL}/dashboard/agents`);
    const result = await page.evaluate(async () => {
      const quote = await fetch("/api/insurance/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "22222222-2222-4222-8222-222222222222" }),
      });
      const quoteData = await quote.json();
      const bind = await fetch("/api/insurance/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policyId: quoteData.data.policy.id }),
      });
      return {
        quoteStatus: quote.status,
        quoteData,
        bindStatus: bind.status,
        bindData: await bind.json(),
      };
    });

    expect(result.quoteStatus).toBe(201);
    expect(result.bindStatus).toBe(200);
    expect(result.bindData.data.policy.status).toBe("active");
    expect(quoteBody).toEqual({ agentId: "22222222-2222-4222-8222-222222222222" });
    expect(bindBody).toEqual({ policyId: "11111111-1111-4111-8111-111111111111" });
    expect(quoteBody).not.toHaveProperty("organizationId");
    expect(bindBody).not.toHaveProperty("attemptId");
    expect(bindBody).not.toHaveProperty("providerPayload");
  });
});
