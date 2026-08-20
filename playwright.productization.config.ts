import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/productization",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/productization" }],
  ],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    colorScheme: "dark",
    locale: "en-HK",
    timezoneId: "Asia/Hong_Kong",
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "bun run build && bun start -p 3101",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
  },
});
