import { expect, test, type Page } from "@playwright/test";

import {
  DASHBOARD_ROUTES,
  INVALID_ROUTES,
  METADATA_PARITY_ROUTES,
  PUBLIC_ROUTES,
  ROUTES,
} from "../fixtures/routes";
import { E2E_AUTH_STORAGE_STATE } from "./support/auth-state";

const LEGACY_BASE_URL = process.env["LEGACY_BASE_URL"] ?? "http://127.0.0.1:3100";
const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";
async function metadataAt(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.status(), url).toBe(200);

  return {
    title: await page.title(),
    description: await page.locator('meta[name="description"]').getAttribute("content"),
    openGraphTitle: await page.locator('meta[property="og:title"]').getAttribute("content"),
    openGraphDescription: await page
      .locator('meta[property="og:description"]')
      .getAttribute("content"),
  };
}

test.describe("39-public-route and 5-dashboard contract", () => {
  test("the shared route manifest has exactly 39 public and 5 dashboard URLs", () => {
    expect(PUBLIC_ROUTES).toHaveLength(39);
    expect(DASHBOARD_ROUTES).toHaveLength(5);
    expect(ROUTES).toHaveLength(44);
    expect(new Set(ROUTES).size).toBe(44);
  });

  for (const path of PUBLIC_ROUTES) {
    test(`${path} returns 200 on legacy and Next`, async ({ request }) => {
      for (const [runtime, baseUrl] of [
        ["legacy", LEGACY_BASE_URL],
        ["next", NEXT_BASE_URL],
      ] as const) {
        const response = await request.get(`${baseUrl}${path}`, { maxRedirects: 0 });
        expect(response.status(), `${runtime} ${path}`).toBe(200);
      }
    });
  }

  for (const path of DASHBOARD_ROUTES) {
    test(`${path} requires authentication on Next`, async ({ request }) => {
      const legacy = await request.get(`${LEGACY_BASE_URL}${path}`, { maxRedirects: 0 });
      expect(legacy.status(), `legacy ${path}`).toBe(200);
      const next = await request.get(`${NEXT_BASE_URL}${path}`, { maxRedirects: 0 });
      expect(next.status(), `Next ${path}`).toBe(307);
      expect(next.headers()["location"]).toBe(`/login?next=${encodeURIComponent(path)}`);
    });
  }

  test("/login?next=%2Fdashboard stays public and advertises the magic-link flow", async ({
    page,
    request,
  }) => {
    const response = await request.get(`${NEXT_BASE_URL}/login?next=%2Fdashboard`, {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);

    await page.goto(`${NEXT_BASE_URL}/login?next=%2Fdashboard`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Email me a sign-in link")).toBeVisible();
  });

  test.describe("authenticated dashboard route contract", () => {
    test.use({ storageState: E2E_AUTH_STORAGE_STATE });

    for (const path of DASHBOARD_ROUTES) {
      test(`${path} returns 200 for an authorized member`, async ({ request }) => {
        const response = await request.get(`${NEXT_BASE_URL}${path}`, { maxRedirects: 0 });
        expect(response.status(), `Next ${path}`).toBe(200);
      });
    }
  });

  for (const path of INVALID_ROUTES) {
    test(`${path} returns 404 on legacy and Next`, async ({ request }) => {
      for (const [runtime, baseUrl] of [
        ["legacy", LEGACY_BASE_URL],
        ["next", NEXT_BASE_URL],
      ] as const) {
        const response = await request.get(`${baseUrl}${path}`, { maxRedirects: 0 });
        expect(response.status(), `${runtime} ${path}`).toBe(404);
      }
    });
  }

  for (const path of METADATA_PARITY_ROUTES) {
    test(`${path} preserves representative metadata`, async ({ page }) => {
      const legacy = await metadataAt(page, `${LEGACY_BASE_URL}${path}`);
      const next = await metadataAt(page, `${NEXT_BASE_URL}${path}`);

      expect(next).toEqual(legacy);
    });
  }
});
