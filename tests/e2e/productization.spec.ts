import { expect, test } from "@playwright/test";

const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";

test.describe("Phase 5 productization release smoke", () => {
  test("keeps public verification, report, billing, and inbound message envelopes safe", async ({
    page,
  }) => {
    await page.route("**/api/v1/verify/**", async (route) => {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "API_KEY_RATE_LIMITED",
            message: "API key rate limit exceeded.",
            retryAfterSeconds: 60,
            requestId: "e2e-productization",
          },
        }),
      });
    });
    await page.route("**/api/reports/compliance**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { report: { frameworkCode: "imda" } } }),
      });
    });
    await page.route("**/api/billing/checkout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { url: "https://checkout.stripe.test/session" } }),
      });
    });
    await page.route("**/api/comms/inbound", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { messageId: "message-1", agentId: "agent-1" } }),
      });
    });
    await page.goto(`${NEXT_BASE_URL}/`);
    const responses = await page.evaluate(async () => {
      const [verify, report, billing, comms] = await Promise.all([
        fetch("/api/v1/verify/did:web:hermespass.asia:agent:demo", {
          headers: { authorization: "Bearer hp_live_fixture" },
        }),
        fetch("/api/reports/compliance?framework=imda&format=json"),
        fetch("/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ tier: "starter" }),
        }),
        fetch("/api/comms/inbound", {
          method: "POST",
          body: JSON.stringify({ from: "sender@example.test", to: "demo@agents.hermespass.asia" }),
        }),
      ]);
      return Promise.all([verify.json(), report.json(), billing.json(), comms.json()]);
    });
    expect(responses[0]).toMatchObject({ error: { code: "API_KEY_RATE_LIMITED" } });
    expect(responses[1]).toEqual({ data: { report: { frameworkCode: "imda" } } });
    expect(responses[2]).toEqual({ data: { url: "https://checkout.stripe.test/session" } });
    expect(responses[3]).toEqual({ data: { messageId: "message-1", agentId: "agent-1" } });
    expect(JSON.stringify(responses)).not.toMatch(
      /secret|private|governance|credential|stripe_customer/i,
    );
  });
});
