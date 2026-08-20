import { expect, test } from "@playwright/test";

const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";
const did = "did:web:hermespass.asia:agent:public-demo";

test.describe("public verification API", () => {
  test("uses one exact Bearer credential and exposes only the safe projection", async ({
    page,
  }) => {
    let requestCount = 0;
    let authorization: string | undefined;
    await page.route("**/api/v1/verify/**", async (route) => {
      requestCount += 1;
      authorization = route.request().headers()["authorization"];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            valid: true,
            status: "active",
            did,
            credentialId: "urn:uuid:public-demo",
            issuer: "did:web:hermespass.asia",
            credential: {
              credentialSubject: { id: did, name: "Public Demo", scopes: ["catalog.read"] },
            },
          },
        }),
      });
    });
    await page.setExtraHTTPHeaders({ authorization: "Bearer hp_live_public_demo" });

    const response = await page.goto(NEXT_BASE_URL + "/api/v1/verify/" + encodeURIComponent(did), {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);
    expect(requestCount).toBe(1);
    expect(authorization).toBe("Bearer hp_live_public_demo");

    const body = JSON.parse(await page.locator("body").innerText()) as {
      data: Record<string, unknown>;
    };
    expect(body.data).toMatchObject({ valid: true, status: "active", did });
    expect(body.data).not.toHaveProperty("organizationId");
    expect(body.data).not.toHaveProperty("credentialJws");
    expect(JSON.stringify(body)).not.toContain("governance");
    expect(JSON.stringify(body)).not.toContain("hp_live_");
  });

  test("does not retry or broaden an invalid credential response", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/v1/verify/**", async (route) => {
      requestCount += 1;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "API_KEY_INVALID",
            message: "A valid HermesPass API key is required.",
            requestId: "e2e-public-verification",
          },
        }),
      });
    });

    const response = await page.goto(NEXT_BASE_URL + "/api/v1/verify/" + encodeURIComponent(did), {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(401);
    expect(requestCount).toBe(1);

    const body = JSON.parse(await page.locator("body").innerText()) as {
      error: Record<string, unknown>;
    };
    expect(body.error).toMatchObject({ code: "API_KEY_INVALID" });
    expect(JSON.stringify(body)).not.toContain("organizationId");
    expect(JSON.stringify(body)).not.toContain("credentialJws");
  });
});
