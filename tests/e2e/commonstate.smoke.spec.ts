import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const WORKSPACE = "demo-tano";
const workspaceHeaders = {
  "content-type": "application/json",
  "x-commonstate-workspace": WORKSPACE,
};

async function expectNoSeriousAccessibilityViolations(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  expect(
    blocking,
    `${surface} accessibility violations:\n${blocking
      .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`)
      .join("\n")}`,
  ).toEqual([]);
}

async function resetWorkspace(request: APIRequestContext) {
  const response = await request.post("/api/demo/reset", {
    headers: workspaceHeaders,
    data: { workspace: WORKSPACE },
  });
  expect(response.ok(), `reset returned ${response.status()}`).toBeTruthy();
  const expectedStorageMode = process.env.COMMONSTATE_EXPECT_STORAGE_MODE;
  if (expectedStorageMode) {
    const payload = await response.json();
    expect(payload.state?.meta?.mode).toBe(expectedStorageMode);
  }
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

test("a failed live mutation stays pinned and offers an explicit recorded reset", async ({ page }) => {
  await page.goto("/tano");
  const main = page.locator("#workspace-main");
  await page.getByRole("button", { name: "Start the 90-second proof" }).click();
  await page.route("**/api/demo/ask", (route) => route.abort("failed"));

  await main.getByRole("button", { name: /^Ask Commonstate/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Ask failed" })).toBeVisible();
  const recovery = page.getByRole("button", {
    name: "Reset into recorded deterministic mode",
  });
  await expect(recovery).toBeVisible();
  await expect(page).not.toHaveURL(/demo=recorded/);

  await recovery.click();
  await expect(page).toHaveURL(/\/tano\?demo=recorded$/);
  await expect(
    page.getByRole("button", { name: "Recorded deterministic mode" }),
  ).toBeDisabled();
});

test("keyboard navigation, command palette, and evidence dialog remain operable", async ({ page }) => {
  await page.goto("/tano");
  const main = page.locator("#workspace-main");
  const overviewTab = page.getByRole("tab", { name: /Overview/ });

  await overviewTab.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("tab", { name: /Change inbox/ })).toBeFocused();
  await expect(main.getByRole("heading", { level: 1, name: "Change Inbox" })).toBeVisible();

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await palette.getByPlaceholder("Search surfaces and commands…").fill("Replay");
  await palette.getByRole("button", { name: /Replay/ }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Replay decisions" })).toBeVisible();

  await page.getByRole("tab", { name: /Overview/ }).click();
  await main.getByRole("button", { name: /Sources/ }).click();
  const evidenceDialog = page.getByRole("dialog", { name: /Claim source/ });
  await expect(evidenceDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(evidenceDialog).toBeHidden();
});

test("landing and every console surface have no serious WCAG A or AA violations", async ({ page }) => {
  // Scan the stable reduced-motion presentation. The console's 260 ms view
  // entrance fades otherwise blend every text color with its background while
  // axe samples the first frame, producing transient contrast false positives.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /Every human\. Every agent\. Same state\./ }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "landing");

  await page.goto("/tano");
  await expect(page.getByRole("button", { name: "Start the 90-second proof" })).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page, "console/overview");

  for (const surface of [
    "Change inbox",
    "Memory map",
    "Ask Commonstate",
    "Agent console",
    "Replay",
    "Evals",
  ]) {
    await page.getByRole("tab", { name: new RegExp(surface, "i") }).click();
    await expect(page.locator("#workspace-main [role='tabpanel']")).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page, `console/${surface}`);
  }
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
