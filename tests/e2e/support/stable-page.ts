import { expect, type Page, type ViewportSize } from "@playwright/test";

const FIXED_NOW = Date.parse("2026-08-15T10:00:00.000Z");
const STABLE_CSS = `
  *, *::before, *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    scroll-behavior: auto !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }
  nextjs-portal { display: none !important; }
`;

export async function openStablePage(page: Page, url: string, viewport: ViewportSize) {
  await page.setViewportSize(viewport);
  await page.addInitScript((fixedNow) => {
    const NativeDate = Date;

    globalThis.Date = class FrozenDate extends NativeDate {
      constructor(value?: string | number) {
        super(value === undefined ? fixedNow : value);
      }

      static override now() {
        return fixedNow;
      }
    } as DateConstructor;
  }, FIXED_NOW);

  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.status(), url).toBe(200);
  await page.addStyleTag({ content: STABLE_CSS });
  await page.waitForLoadState("networkidle");
  await page.locator("main").first().waitFor({ state: "visible" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  if ((await page.locator(".recharts-wrapper").count()) > 0) {
    await page.waitForTimeout(1_700);
  }
}
