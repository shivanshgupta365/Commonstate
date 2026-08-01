import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const useLocalProductAuth = process.env.COMMONSTATE_E2E_LOCAL_AUTH === "true";

export default defineConfig({
  testDir: "./tests/e2e",
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
    navigationTimeout: 15_000,
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
        env: {
          ...(useLocalProductAuth
            ? {
                // The application still requires a loopback PostgreSQL URL
                // and rejects this path on Vercel. Clearing CI only in the
                // spawned localhost server lets the production build exercise
                // the local-bootstrap principal without enabling it in a
                // deployed environment.
                CI: "",
                COMMONSTATE_LOCAL_AUTH: "true",
              }
            : {}),
        },
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
