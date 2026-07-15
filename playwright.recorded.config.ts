import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.RECORDED_DEMO_BASE_URL ?? "http://127.0.0.1:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.recorded.spec.ts",
  outputDir: "test-results-recorded",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-recorded-report", open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "recorded-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    env: { COMMONSTATE_TEST_MEMORY: "1" },
    url: `${baseURL}/demo/recorded-tano-v1.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
