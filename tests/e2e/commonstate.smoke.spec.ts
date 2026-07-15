import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const WORKSPACE = "demo-tano";
const workspaceHeaders = {
  "content-type": "application/json",
  "x-commonstate-workspace": WORKSPACE,
};

async function resetWorkspace(request: APIRequestContext) {
  const response = await request.post("/api/demo/reset", {
    headers: workspaceHeaders,
    data: { workspace: WORKSPACE },
  });
  expect(response.ok(), `reset returned ${response.status()}`).toBeTruthy();
}

async function clickAndWaitForApi(
  page: Page,
  target: Locator,
  pathname: string,
) {
  await expect(target).toBeVisible();
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        new URL(candidate.url()).pathname === pathname &&
        candidate.request().method() === "POST",
    ),
    target.click(),
  ]);
  expect(response.ok(), `${pathname} returned ${response.status()}`).toBeTruthy();
  return response;
}

test.beforeEach(async ({ request }) => {
  await resetWorkspace(request);
});

test("landing page presents the product thesis and opens the Tano Edition", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Commonstate — Every human\. Every agent\. Same state\./);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /Every human\. Every agent\. Same state\./,
    }),
  ).toBeVisible();
  await expect(page.getByText("Operational context control plane").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "deterministic scenarios" })).toBeVisible();
  await expect(page.getByText("Independent, unofficial Tano concept")).toBeVisible();

  await page.getByRole("link", { name: /Explore the Tano edition/i }).click();
  await expect(page).toHaveURL(/\/tano$/);
  await expect(page.getByRole("button", { name: "Start the 90-second proof" })).toBeVisible();
});

test("guided console completes the cited ask-to-outcome workflow", async ({ page }) => {
  await page.goto("/tano");
  const main = page.locator("#workspace-main");

  await expect(page.getByText("0/6", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start the 90-second proof" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Ask Commonstate" })).toBeVisible();
  await expect(page.getByLabel("Ask about this scope")).toHaveValue(
    /Which creators can launch whitelisted TikTok ads this week under £15k/,
  );

  await clickAndWaitForApi(
    page,
    main.getByRole("button", { name: /^Ask Commonstate/ }),
    "/api/demo/ask",
  );
  await expect(main.getByRole("heading", { name: "2 eligible · 1 blocked" })).toBeVisible();
  await expect(main.getByText(/Amara Okafor and Imani Brooks can launch this week/)).toBeVisible();
  await expect(main.getByText("Why this answer is safe")).toBeVisible();

  await page.getByRole("button", { name: "Ingest operator update" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Change Inbox" })).toBeVisible();
  await clickAndWaitForApi(
    page,
    main.getByRole("button", { name: /Ingest Slack update/ }),
    "/api/demo/ingest",
  );
  await expect(main.getByRole("heading", { name: "Summer TikTok Whitelisting" })).toBeVisible();
  await expect(main.getByText("Synthetic demo").first()).toBeVisible();
  await expect(main.getByText(/Blast radius · 2 dependencies/)).toBeVisible();

  await clickAndWaitForApi(
    page,
    main.getByRole("button", { name: /Approve all \d+ & propagate/ }),
    "/api/demo/approve",
  );
  await expect(main.getByText(/decision is preserved in the Evidence Ledger/)).toBeVisible();

  await page.getByRole("button", { name: "Run Relationship Agent" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Agent Console" })).toBeVisible();
  await clickAndWaitForApi(
    page,
    main.getByRole("button", { name: /^Run Relationship Agent/ }),
    "/api/demo/run-agent",
  );
  await expect(main.getByText("RECEIPT", { exact: true })).toBeVisible();
  await expect(main.getByText(/hold and escalate · Amara Okafor/i)).toBeVisible();
  await expect(main.getByText(/0 consequential actions executed\. All proposals remain dry-run only\./)).toBeVisible();

  await page.getByRole("button", { name: "Replay against new state" }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Replay decisions" })).toBeVisible();
  await clickAndWaitForApi(
    page,
    main.getByRole("button", { name: /Replay against current state/ }),
    "/api/demo/replay",
  );
  await expect(main.getByText("Hold Amara Okafor and escalate")).toBeVisible();
  await expect(main.getByText("newly blocked")).toBeVisible();

  await clickAndWaitForApi(
    page,
    main.getByRole("button", { name: /Record campaign outcome/ }),
    "/api/demo/outcome",
  );
  await expect(main.getByText(/^Outcome receipt /)).toBeVisible();
  await expect(page.getByText("6/6", { exact: true })).toBeVisible();
  await expect(page.getByText("Workflow complete")).toBeVisible();
});

test("reset restores the isolated deterministic workspace", async ({ page }) => {
  await page.goto("/tano");
  const main = page.locator("#workspace-main");

  await clickAndWaitForApi(
    page,
    main.getByRole("button", { name: "Ingest Slack update" }),
    "/api/demo/ingest",
  );
  await expect(page.getByText("1/6", { exact: true })).toBeVisible();

  await clickAndWaitForApi(
    page,
    page.getByRole("button", { name: "Reset demo" }),
    "/api/demo/reset",
  );
  await expect(page.getByText("0/6", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("heading", {
      level: 1,
      name: /Every human\. Every agent\. Same state\./,
    }),
  ).toBeVisible();
  await expect(main.getByText("Operator update ready to ingest")).toBeVisible();
});

test.describe("mobile smoke", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("landing and console remain usable without page-level overflow", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /Every human\. Every agent\. Same state\./,
      }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Explore the Tano edition/i }).click();

    await expect(page.getByRole("complementary", { name: "Tano Edition navigation" })).toBeVisible();
    await expect(page.getByLabel("Current workspace scope")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start the 90-second proof" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
