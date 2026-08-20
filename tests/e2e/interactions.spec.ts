import { expect, test } from "@playwright/test";

import { E2E_AUTH_STORAGE_STATE } from "./support/auth-state";

const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";
test.describe("Next interactions", () => {
  test("contact validation and simulated submission", async ({ page }) => {
    await page.goto(`${NEXT_BASE_URL}/contact`);
    await page.getByRole("button", { name: "Request briefing" }).click();
    await expect(page.getByText("Please enter your name.")).toBeVisible();
    await expect(page.getByText("Enter a valid work email address.")).toBeVisible();
    await expect(page.getByText("Select a region.")).toBeVisible();

    await page.getByPlaceholder("Alex Chan").fill("Alex Chan");
    await page.getByPlaceholder("alex@company.com").fill("alex@company.com");
    await page.getByPlaceholder("Company Ltd").fill("Company Ltd");
    await page
      .getByPlaceholder(/procurement agents raising POs/i)
      .fill("We govern procurement agents.");
    await page.getByRole("combobox", { name: "Region" }).click();
    await page.getByRole("option", { name: "Hong Kong SAR" }).click();
    await page.getByRole("button", { name: "Request briefing" }).click();

    await expect(page.getByRole("heading", { name: "Thanks, Alex." })).toBeVisible();
    await expect(page.getByText(/alex@company.com/i)).toBeVisible();
  });

  test("ROI inputs recalculate the annual total", async ({ page }) => {
    await page.goto(`${NEXT_BASE_URL}/roi-calculator`);
    await expect(page.getByText("$360,000", { exact: true })).toBeVisible();
    await page.getByRole("spinbutton").first().fill("50");
    await expect(page.getByText("$705,600", { exact: true })).toBeVisible();
  });

  test("desktop mega-menu and mobile menu navigate to preserved destinations", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${NEXT_BASE_URL}/`);
    await page.getByRole("button", { name: "Platform" }).click();
    await expect(page.getByRole("link", { name: /Product overview/i }).first()).toHaveAttribute(
      "href",
      "/product",
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${NEXT_BASE_URL}/`);
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    await expect(page.locator("header").getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });

  test.describe("authenticated dashboard interactions", () => {
    test.use({ storageState: E2E_AUTH_STORAGE_STATE });

    test("issuing a passport does not create a scoped wallet", async ({ page }) => {
      await page.goto(`${NEXT_BASE_URL}/dashboard/agents`);
      await page.getByRole("button", { name: "Issue new agent passport" }).click();
      await page.getByLabel("Agent name").fill("Parity Agent");
      await page.getByLabel("Role").fill("Support operations");
      await page.getByRole("button", { name: "Mint passport" }).click();
      await expect(page.getByRole("heading", { name: "Parity Agent" })).toBeVisible();

      await page.getByRole("link", { name: /Scoped Wallets/i }).click();
      await expect(page).toHaveURL(`${NEXT_BASE_URL}/dashboard/wallets`);
      await expect(page.getByText("Parity Agent", { exact: true })).not.toBeVisible();
    });

    test("live gateway polling pauses and resumes deterministic API requests", async ({ page }) => {
      let activityRequests = 0;
      let approvalRequests = 0;

      await page.route("**/api/gateway/activity", async (route) => {
        activityRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              activity: [],
              aggregates: {
                actionsToday: 0,
                pendingHolds: 0,
                blockedSpendCents: 0,
                deniedCount: 0,
                decisionCounts: {
                  allow: 0,
                  hold: 0,
                  deny: 0,
                },
                trend: [],
              },
            },
          }),
        });
      });
      await page.route("**/api/approvals", async (route) => {
        approvalRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              approvals: [],
            },
          }),
        });
      });

      await page.goto(`${NEXT_BASE_URL}/dashboard/approvals`);
      await expect.poll(() => activityRequests).toBeGreaterThan(0);
      await expect.poll(() => approvalRequests).toBeGreaterThan(0);

      await page.getByRole("button", { name: "Pause stream" }).click();
      await expect(page.getByRole("button", { name: "Resume stream" })).toBeVisible();
      await page.waitForTimeout(3_500);
      const pausedActivityRequests = activityRequests;
      const pausedApprovalRequests = approvalRequests;

      await page.waitForTimeout(3_500);
      expect(activityRequests).toBe(pausedActivityRequests);
      expect(approvalRequests).toBe(pausedApprovalRequests);

      await page.getByRole("button", { name: "Resume stream" }).click();
      await expect(page.getByRole("button", { name: "Pause stream" })).toBeVisible();
      await expect
        .poll(() => activityRequests, { timeout: 5_000 })
        .toBeGreaterThan(pausedActivityRequests);
      await expect
        .poll(() => approvalRequests, { timeout: 5_000 })
        .toBeGreaterThan(pausedApprovalRequests);

      await expect(page.getByText(/Refund of HK\$ 820\.00 for Order #9812/i)).toHaveCount(0);
    });

    test("wallet limits change and a card can be frozen", async ({ page }) => {
      const agentId = "00000000-0000-4000-8000-000000000011";
      const cardId = "11111111-1111-4111-8111-111111111111";
      let cardStatus = "active";
      await page.route("**/api/wallets", async (route) => {
        if (route.request().method() !== "GET") return route.continue();
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              cards: [
                {
                  id: cardId,
                  agentId,
                  agentSlug: "fimmick-merchant-concierge",
                  agentDid: "did:web:hermespass.asia:agent:fimmick-merchant-concierge",
                  rail: "mock",
                  last4: "4242",
                  brand: "Mock",
                  currency: "HKD",
                  status: cardStatus,
                  policyVersion: 1,
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  frozenAt: cardStatus === "frozen" ? "2026-01-01T00:00:00.000Z" : null,
                },
              ],
            },
          }),
        });
      });
      await page.route("**/api/agents/*/policy", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              policy: {
                id: "22222222-2222-4222-8222-222222222222",
                agentId,
                version: 1,
                currency: "HKD",
                perTransactionLimitCents: 50000,
                dailyLimitCents: 100000,
                monthlyLimitCents: 400000,
                approvalThresholdCents: 5000,
                mccAllowlist: [],
                mccRequired: false,
                assignedReviewerUserId: "e2e-owner",
                isActive: true,
                supersededAt: null,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            },
          }),
        });
      });
      await page.route("**/api/wallets/*/status", async (route) => {
        cardStatus = "frozen";
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { card: { id: cardId, status: "frozen" } } }),
        });
      });
      await page.goto(
        (process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101") + "/dashboard/wallets",
      );
      const sliders = page.getByRole("slider");
      await expect(sliders.nth(0)).toHaveAttribute("aria-valuenow", "500");
      await expect(sliders.nth(0)).toHaveAttribute("data-disabled", "");
      await sliders.nth(0).press("ArrowRight");
      await expect(sliders.nth(0)).toHaveAttribute("aria-valuenow", "500");

      await page.getByRole("button", { name: "Freeze card" }).first().click();
      await expect(page.getByRole("button", { name: "Unfreeze card" })).toBeVisible();
    });
    test("compliance print and CSV export actions work", async ({ page }) => {
      await page.addInitScript(() => {
        window.print = () => {
          document.documentElement.dataset["printCalled"] = "true";
        };
      });
      await page.goto(`${NEXT_BASE_URL}/dashboard/compliance`);

      await page.getByRole("button", { name: "PDF report" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-print-called", "true");

      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("link", { name: "1-click regulatory export" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^hermespass-audit-\d{4}-\d{2}-\d{2}\.csv$/);
    });
  });
});
