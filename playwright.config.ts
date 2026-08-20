import { defineConfig } from "@playwright/test";
const startLocalServers = process.env["PLAYWRIGHT_SKIP_WEBSERVER"] !== "1";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  ...(startLocalServers ? { globalSetup: "./tests/e2e/global-setup.ts" } : {}),
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  ...(process.env["CI"] ? { workers: 1 } : {}),
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    colorScheme: "dark",
    locale: "en-HK",
    timezoneId: "Asia/Hong_Kong",
    contextOptions: {
      reducedMotion: "reduce",
    },
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
