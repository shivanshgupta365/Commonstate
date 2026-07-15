import { expect, test, type Page } from "@playwright/test";

async function forceRecordedFallback(page: Page) {
  const apiRequests: string[] = [];
  await page.route("**/api/demo/**", async (route) => {
    const request = route.request();
    apiRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "RECORDED_TEST_API_UNAVAILABLE",
          message: "The live API is deliberately unavailable in this recorded-mode test.",
        },
      }),
    });
  });
  return apiRequests;
}

test("provider-neutral recorded client completes the six-step proof with zero API requests", async ({ page }) => {
  const apiRequests = await forceRecordedFallback(page);
  await page.goto("/tano?demo=recorded");
  await expect(page.getByRole("button", { name: "Recorded deterministic mode" })).toBeDisabled();
  const fixtureResponse = await page.request.get("/demo/recorded-tano-v1.json");
  expect(fixtureResponse.ok()).toBeTruthy();
  expect((await fixtureResponse.json()).fixtureVersion).toBe("recorded-tano-v1");

  const main = page.locator("#workspace-main");
  await page.getByRole("button", { name: "Start the 90-second proof" }).click();
  await main.getByRole("button", { name: /^Ask Commonstate/ }).click();
  await expect(main.getByRole("heading", { name: "2 eligible · 1 blocked" })).toBeVisible();

  await page.getByRole("button", { name: "Ingest operator update" }).click();
  await main.getByRole("button", { name: /Ingest Slack update/ }).click();
  await expect(main.getByText(/Blast radius · 2 dependencies/)).toBeVisible();
  await main.getByRole("button", { name: /Approve all \d+ & propagate/ }).click();
  await expect(main.getByText(/decision is preserved in the Evidence Ledger/)).toBeVisible();

  await page.getByRole("button", { name: "Run Relationship Agent" }).click();
  await main.getByRole("button", { name: /^Run Relationship Agent/ }).click();
  await expect(main.getByText("RECEIPT", { exact: true })).toBeVisible();
  await expect(main.getByText(/hold and escalate · Amara Okafor/i)).toBeVisible();

  await page.getByRole("button", { name: "Replay against new state" }).click();
  await main.getByRole("button", { name: /Replay against current state/ }).click();
  await expect(main.getByText("Hold Amara Okafor and escalate")).toBeVisible();
  await main.getByRole("button", { name: /Record campaign outcome/ }).click();
  await expect(main.getByText(/^Outcome receipt /)).toBeVisible();
  await expect(page.getByText("6/6", { exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("recorded rejection and reset branches are deterministic", async ({ page }) => {
  const apiRequests = await forceRecordedFallback(page);
  await page.goto("/tano?demo=recorded");
  const main = page.locator("#workspace-main");

  await main.getByRole("button", { name: "Ingest Slack update" }).click();
  await expect(page.getByText("1/6", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: /Reject all \d+/ }).click();
  await expect(page.getByText(/previous approved truth remains active/)).toBeVisible();

  await page.getByRole("button", { name: "Reset demo" }).click();
  await expect(page.getByText("0/6", { exact: true })).toBeVisible();
  await expect(main.getByText("Operator update ready to ingest")).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("recorded mode rejects unsupported input without pretending it ran live", async ({ page }) => {
  const apiRequests = await forceRecordedFallback(page);
  await page.goto("/tano?demo=recorded");
  const main = page.locator("#workspace-main");
  await expect(page.getByRole("button", { name: "Recorded deterministic mode" })).toBeDisabled();

  await page.getByRole("button", { name: "Start the 90-second proof" }).click();
  await page.getByLabel("Ask about this scope").fill("Can a creator launch on Instagram tomorrow?");
  await main.getByRole("button", { name: /^Ask Commonstate/ }).click();
  await expect(
    page.getByRole("alert").filter({
      hasText: "Recorded mode supports the scripted creator-eligibility question only",
    }),
  ).toBeVisible();
  await expect(page.getByText("0/6", { exact: true })).toBeVisible();
  expect(apiRequests).toEqual([]);
});
