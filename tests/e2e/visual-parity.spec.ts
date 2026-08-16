import { test } from "@playwright/test";

import { VISUAL_PARITY_ROUTES, VISUAL_VIEWPORTS } from "../fixtures/routes";
import { assertImageParity } from "./support/image-diff";
import { openStablePage } from "./support/stable-page";

const LEGACY_BASE_URL = process.env["LEGACY_BASE_URL"] ?? "http://127.0.0.1:3100";
const NEXT_BASE_URL = process.env["NEXT_BASE_URL"] ?? "http://127.0.0.1:3101";

for (const viewport of VISUAL_VIEWPORTS) {
  for (const path of VISUAL_PARITY_ROUTES) {
    test(`${viewport.name} ${path} stays within the 0.5% visual threshold`, async ({
      browser,
    }, testInfo) => {
      const context = await browser.newContext({
        viewport,
        colorScheme: "dark",
        locale: "en-HK",
        timezoneId: "Asia/Hong_Kong",
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      const legacyPage = await context.newPage();
      const nextPage = await context.newPage();

      try {
        await Promise.all([
          openStablePage(legacyPage, `${LEGACY_BASE_URL}${path}`, viewport),
          openStablePage(nextPage, `${NEXT_BASE_URL}${path}`, viewport),
        ]);
        const [legacy, next] = await Promise.all([
          legacyPage.screenshot({ animations: "disabled", caret: "hide" }),
          nextPage.screenshot({ animations: "disabled", caret: "hide" }),
        ]);

        await assertImageParity({
          legacy,
          next,
          label: `${viewport.name}-${path}`,
          testInfo,
          maxDiffRatio: 0.005,
        });
      } finally {
        await context.close();
      }
    });
  }
}
