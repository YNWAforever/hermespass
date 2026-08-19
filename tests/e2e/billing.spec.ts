const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";
import { test, expect } from "@playwright/test";

test.describe("billing API browser contract", () => {
  test("returns a safe checkout envelope without exposing provider fields", async ({ page }) => {
    await page.route("**/api/billing/checkout", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { url: "https://checkout.stripe.test/session" } }),
      });
    });
    await page.goto(NEXT_BASE_URL + "/");
    const body = await page.evaluate(async () => {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ tier: "starter" }),
      });
      return response.json();
    });
    expect(body).toEqual({ data: { url: "https://checkout.stripe.test/session" } });
    expect(JSON.stringify(body)).not.toMatch(/secret|customer|subscription/i);
  });
});
