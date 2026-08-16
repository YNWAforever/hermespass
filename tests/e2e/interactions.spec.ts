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

    test("gateway stream and held-action review controls remain interactive", async ({ page }) => {
      await page.goto(`${NEXT_BASE_URL}/dashboard/approvals`);
      await page.getByRole("button", { name: "Pause stream" }).click();
      await expect(page.getByRole("button", { name: "Resume stream" })).toBeVisible();
      await page.getByRole("button", { name: "Resume stream" }).click();
      await expect(page.getByRole("button", { name: "Pause stream" })).toBeVisible();

      const firstHold = page.getByRole("button", {
        name: /Refund of HK\$ 820\.00 for Order #9812/i,
      });
      await firstHold.click();
      await page.getByRole("button", { name: "Escalate to Telegram" }).click();
      await expect(page.getByText("escalated · telegram", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Approve action" }).click();
      await expect(firstHold.getByText("Allow", { exact: true })).toBeVisible();

      const secondHold = page.getByRole("button", {
        name: /Raise daily budget to S\$ 3,200\.00/i,
      });
      await secondHold.click();
      await page.getByRole("button", { name: "Reject action" }).click();
      await expect(secondHold.getByText("Deny", { exact: true })).toBeVisible();
    });

    test("wallet limits change and a card can be frozen", async ({ page }) => {
      await page.goto(`${NEXT_BASE_URL}/dashboard/wallets`);
      const sliders = page.getByRole("slider");
      await expect(sliders.nth(0)).toHaveAttribute("aria-valuenow", "500");
      await sliders.nth(0).press("ArrowRight");
      await expect(sliders.nth(0)).toHaveAttribute("aria-valuenow", "600");

      await page.getByRole("button", { name: "Freeze card" }).first().click();
      await expect(sliders.nth(0)).toHaveAttribute("aria-valuenow", "0");
      await expect(sliders.nth(1)).toHaveAttribute("aria-valuenow", "0");
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
