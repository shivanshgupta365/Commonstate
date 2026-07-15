import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "**/*.recorded.spec.ts",
  outputDir: "test-results",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run start -- --hostname 127.0.0.1 --port 3000",
        // Local smoke runs may opt into the isolated in-process store. CI's
        // browser-live job supplies DATABASE_URL and must fail closed if that
        // durable store becomes unavailable instead of silently falling back.
        env: {
          COMMONSTATE_TEST_MEMORY: process.env.DATABASE_URL ? "0" : "1",
        },
        url: `${baseURL}/api/demo/state?workspace=playwright-readiness`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
