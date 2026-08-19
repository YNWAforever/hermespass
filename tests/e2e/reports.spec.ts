import { expect, test } from "@playwright/test";

import { E2E_AUTH_STORAGE_STATE } from "./support/auth-state";

const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";

test.describe("compliance framework reports", () => {
  test.use({ storageState: E2E_AUTH_STORAGE_STATE });

  test("downloads deterministic IMDA and HKMA CSV reports through the dashboard links", async ({
    page,
  }) => {
    const requests: string[] = [];
    await page.route("**/api/reports/compliance**", async (route) => {
      const url = new URL(route.request().url());
      requests.push(url.toString());
      const framework = url.searchParams.get("framework") ?? "imda";
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="hermespass-${framework}-report-2026-12-31.csv"`,
        },
        body: `"framework","framework_code"\r\n"${framework.toUpperCase()}","${framework}"\r\n`,
      });
    });

    await page.goto(`${NEXT_BASE_URL}/dashboard/compliance`);

    const imdaDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export IMDA report" }).click();
    expect((await imdaDownload).suggestedFilename()).toBe("hermespass-imda-report-2026-12-31.csv");

    const hkmaDownload = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export HKMA report" }).click();
    expect((await hkmaDownload).suggestedFilename()).toBe("hermespass-hkma-report-2026-12-31.csv");

    expect(requests).toHaveLength(2);
    expect(new URL(requests[0]!).searchParams.get("framework")).toBe("imda");
    expect(new URL(requests[1]!).searchParams.get("framework")).toBe("hkma");
    expect(new URL(requests[0]!).searchParams.get("format")).toBe("csv");
  });
});
