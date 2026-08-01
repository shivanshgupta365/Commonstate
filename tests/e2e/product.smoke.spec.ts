import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const publicPacks = [
  { slug: "ai-operations", name: "AI Operations" },
  { slug: "enterprise-governance", name: "Enterprise Governance" },
  { slug: "agency-operations", name: "Agency Operations" },
] as const;

const provisionablePacks = [
  ...publicPacks,
  { slug: "blank", name: "Blank custom" },
] as const;

const validPackClaims = {
  "ai-operations": {
    subjectName: "Operations Agent",
    subjectType: "agent",
    predicate: "agent.allowed_tool",
    value: "incident.runbook",
  },
  "enterprise-governance": {
    subjectName: "Access Review Control",
    subjectType: "control",
    predicate: "control.status",
    value: "effective",
  },
  "agency-operations": {
    subjectName: "Launch Deliverable",
    subjectType: "deliverable",
    predicate: "deliverable.status",
    value: "approved",
  },
  blank: {
    subjectName: "Custom Decision",
    subjectType: "decision",
    predicate: "decision.current_rule",
    value: "approved review required",
  },
} as const;

type ApiEnvelope<T> =
  | { ok: true; data: T; meta: { requestId: string } }
  | { ok: false; error: { code: string; message: string }; meta?: { requestId: string } };

async function successfulJson<T>(response: APIResponse, operation: string): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  expect(response.ok(), `${operation} returned HTTP ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.ok, `${operation} failed: ${JSON.stringify(body)}`).toBe(true);
  if (!body.ok) throw new Error(`${operation} failed: ${body.error.code}`);
  return body.data;
}

function idempotencyKey(prefix: string) {
  return `e2e-${prefix}-${crypto.randomUUID()}`;
}

async function productWrite<T>(
  request: APIRequestContext,
  pathname: string,
  data: Record<string, unknown>,
  operation: string,
  key = idempotencyKey(operation.replaceAll(" ", "-")),
): Promise<T> {
  return successfulJson<T>(
    await request.post(pathname, {
      headers: { "Idempotency-Key": key },
      data,
    }),
    operation,
  );
}

async function productGet<T>(
  request: APIRequestContext,
  pathname: string,
  operation: string,
): Promise<T> {
  return successfulJson<T>(await request.get(pathname), operation);
}

async function expectNoBlockingA11y(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const summaries = blocking.flatMap((violation) =>
    violation.nodes.map((node) =>
      `${violation.id} ${node.target.join(" ")}: ${node.failureSummary ?? violation.help}`,
    ),
  );
  expect(
    summaries,
    `${surface}:\n${summaries.join("\n")}`,
  ).toEqual([]);
}

test("solution switcher exposes three equally complete product packs", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("tablist", { name: "Solution packs" });

  for (const pack of publicPacks) {
    const tab = tabs.getByRole("tab", { name: new RegExp(pack.name) });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: "Open recorded demo" })).toHaveAttribute(
      "href",
      `/demo/${pack.slug}`,
    );
  }
});

for (const pack of publicPacks) {
  test(`${pack.name} public fixture completes decision, review, agent, replay, and outcome`, async ({ page }) => {
    const productApiRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith("/api/v1")) productApiRequests.push(`${request.method()} ${pathname}`);
    });

    await page.goto(`/demo/${pack.slug}`);
    await expect(page.getByText("Recorded deterministic")).toBeVisible();
    await expect(page.getByText("Not a production workspace")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    await page.getByRole("button", { name: "Start the workflow" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ask Commonstate" })).toBeVisible();
    await page.getByRole("button", { name: "Compile recorded context" }).click();
    await expect(page.getByText("Recorded deterministic answer")).toBeVisible();
    await page.getByRole("button", { name: "Evidence 1" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Synthetic Evidence Ledger")).toBeVisible();
    await page.getByRole("button", { name: "Close evidence" }).first().click();

    await page.getByRole("button", { name: "Change Inbox" }).click();
    await page.getByRole("button", { name: "Approve and propagate" }).click();
    await expect(page.getByRole("button", { name: "Approved" })).toBeDisabled();

    await page.getByRole("button", { name: "Agent Console" }).click();
    await page.getByRole("button", { name: "Run recorded agent" }).click();
    await expect(page.getByText("Immutable fixture receipt")).toBeVisible();

    await page.getByRole("button", { name: "Replay" }).click();
    await page.getByRole("button", { name: "Run temporal replay" }).click();
    await expect(page.getByRole("heading", { name: "Current-state comparison" })).toBeVisible();
    await expect(page.getByText("0 live API requests")).toBeVisible();

    await page.getByRole("button", { name: "Outcome" }).click();
    await page.getByRole("button", { name: "Record synthetic outcome" }).click();
    await expect(page.getByRole("heading", { name: "Learning proposed for review." })).toBeVisible();

    await page.getByRole("button", { name: "Reset fixture" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    expect(productApiRequests).toEqual([]);
  });
}

test("public template rejects unsupported questions instead of presenting canned data as fresh", async ({ page }) => {
  await page.goto("/demo/ai-operations");
  await page.getByRole("button", { name: "Start the workflow" }).click();
  await page.getByLabel("Ask this recorded workspace").fill("Send a production incident message now");
  await page.getByRole("button", { name: "Compile recorded context" }).click();
  await expect(page.getByText("Not included in this recording.")).toBeVisible();
  await expect(page.getByText(/never present a canned result as a fresh answer/i)).toBeVisible();
});

test("authenticated setup publishes a live workspace and never requests demo state", async ({ page }) => {
  test.skip(!process.env.DATABASE_URL, "Authenticated product E2E requires PostgreSQL.");
  test.setTimeout(90_000);
  const demoRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/demo")) demoRequests.push(`${request.method()} ${pathname}`);
  });

  const suffix = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const workspaceSlug = `e2e-agency-${suffix}`;
  await page.goto("/setup?template=agency-operations");
  await page.getByLabel("Organization name").fill(`E2E Agency ${suffix}`);
  await page.getByLabel("Workspace name").fill(`E2E Agency Operations ${suffix}`);
  await page.getByLabel("Workspace URL").fill(workspaceSlug);

  for (const heading of [
    "Make it unmistakably yours.",
    "Start from a proven operating model.",
    "Use the language your teams already use.",
    "Connect the systems where truth changes.",
    "Define what automation may do.",
    "Your first governed workspace is ready.",
  ]) {
    await page.getByRole("button", { name: "Continue →" }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  await Promise.all([
    page.waitForURL(new RegExp(`/app/${workspaceSlug}/overview$`), { timeout: 45_000 }),
    page.getByRole("button", { name: "Publish workspace →" }).click(),
  ]);
  await expect(page.getByRole("heading", { level: 1, name: "Operational overview" })).toBeVisible();
  await expect(page.getByText("Authenticated state")).toBeVisible();
  await expect(page.getByText(/Ontology v1 · Policy v1/)).toBeVisible();

  const expectedSurfaces = [
    ["Change Inbox", "Change Inbox"],
    ["Memory Map", "Memory Map"],
    ["Ask Commonstate", "Ask Commonstate"],
    ["Agent Console", "Agent Console"],
    ["Replay", "Replay"],
    ["Evals", "Evals"],
    ["Workspace Settings", "Workspace Settings"],
  ] as const;
  const workspaceNavigation = page.getByRole("navigation", { name: "Workspace navigation" });
  for (const [navigationName, heading] of expectedSurfaces) {
    await workspaceNavigation.getByRole("link").filter({ hasText: navigationName }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    if (heading === "Evals") {
      await expect(page.getByRole("heading", { name: "Evaluation suite not run" })).toBeVisible();
      await expect(page.getByText("Not measured", { exact: true })).toBeVisible();
    }
  }

  await workspaceNavigation.getByRole("link").filter({ hasText: "Change Inbox" }).click();
  await page.getByRole("button", { name: "Ingest source" }).click();
  const sourceText = `E2E Launch Deliverable is approved for the current engagement. Exact evidence: approved.`;
  await page.getByLabel("Source title").fill(`E2E agency launch note ${suffix}`);
  await page.getByLabel("Paste UTF-8 source text").fill(sourceText);
  await page.getByLabel("Also propose one configured claim").check();
  await page.getByLabel("Subject name").fill("E2E Launch Deliverable");
  await page.getByLabel("Entity type").selectOption("deliverable");
  await page.getByLabel("Predicate").selectOption("deliverable.status");
  await page.getByLabel("Value · JSON or text").fill("approved");
  await page.getByLabel("Exact source excerpt").fill("Exact evidence: approved.");
  await page.getByRole("button", { name: "Store evidence" }).click();
  await expect(page.getByText("E2E Launch Deliverable", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("proposed", { exact: true }).first()).toBeVisible();

  await workspaceNavigation.getByRole("link").filter({ hasText: "Workspace Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workspace Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Operating model" }).click();
  for (const section of ["Company terminology", "Claims and predicates", "Agent identities", "Outcome metrics", "Guided workflows"]) {
    await expect(page.getByText(section, { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Identity & locale" }).click();

  const companyName = page.getByLabel("Company name");
  await companyName.fill(`E2E Agency Updated ${suffix}`);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft confirmed by the workspace API")).toBeVisible();
  await page.getByRole("button", { name: "Publish v2 →" }).first().click();
  await expect(page.getByText(/Configuration v2 · published/)).toBeVisible();
  expect(demoRequests, "authenticated product routes must never fall back to demo APIs").toEqual([]);
});

test("all solution packs exercise the live truth, agent, action, replay, and outcome contracts", async ({ request }) => {
  test.skip(!process.env.DATABASE_URL, "Authenticated product E2E requires PostgreSQL.");
  test.setTimeout(120_000);

  const templates = await productGet<{
    items: Array<{ id: string; configuration: Record<string, unknown> }>;
  }>(request, "/api/v1/templates", "template registry");

  for (const pack of provisionablePacks) {
    const suffix = `${pack.slug}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    const provisioned = await productWrite<{
      organization: { id: string };
      workspace: { id: string; slug: string; kind?: string };
    }>(
      request,
      "/api/v1/organizations",
      {
        organizationName: `E2E ${pack.name} ${suffix}`,
        organizationSlug: `e2e-${suffix}`,
        workspaceName: `E2E ${pack.name}`,
        workspaceSlug: `e2e-${suffix}`,
        template: pack.slug,
        publish: true,
        onboarding: {
          scopeKinds: pack.slug === "blank" ? ["Company", "Program", "Workstream"] : undefined,
          entityTypes: pack.slug === "blank" ? ["Decision", "Policy", "Outcome"] : undefined,
          connectors: ["file", "webhook"],
          requiredApprovers: 2,
          lowRiskAutoExecution: true,
          managedProvider: "gemini",
        },
      },
      `${pack.name} provision`,
    );
    const slug = provisioned.workspace.slug;
    const commandPath = `/api/v1/workspaces/${encodeURIComponent(slug)}/commands`;

    if (pack.slug === "blank") {
      const template = templates.items.find((item) => item.id === "blank");
      expect(template, "blank template must exist in the authenticated registry").toBeTruthy();
      const configuration = structuredClone(template!.configuration);
      configuration.branding = {
        ...(configuration.branding as Record<string, unknown>),
        companyName: `E2E custom company ${suffix}`,
      };
      configuration.entityKinds = [{
        key: "decision",
        label: "Decision",
        icon: "branch",
        attributesSchema: { type: "object", properties: {}, additionalProperties: false },
      }];
      configuration.predicates = [{
        key: "decision.current_rule",
        label: "Current rule",
        subjectKinds: ["decision"],
        valueSchema: { type: "string" },
        freshnessSeconds: 86_400,
        conflictRisk: "medium",
        classification: "private",
      }];
      configuration.agents = [{
        key: "decision_agent",
        name: "Decision Agent",
        purpose: "Review custom decisions against current approved truth",
        allowedTools: ["get_context_pack", "record_outcome"],
        writeBudget: 10,
        allowedScopeKinds: ["company"],
      }];
      await successfulJson(
        await request.patch(`/api/v1/workspaces/${encodeURIComponent(slug)}/configuration/draft`, {
          headers: { "Idempotency-Key": idempotencyKey("blank-configuration-draft") },
          data: { configuration },
        }),
        "blank configuration draft",
      );
      await productWrite(
        request,
        `/api/v1/workspaces/${encodeURIComponent(slug)}/configuration/publish`,
        { expectedVersion: 1 },
        "blank configuration publish",
      );
    }

    const state = await productGet<{
      workspace: { kind: string };
      profile: { publishedConfigurationVersion: number };
      scopes: Array<{ id: string }>;
      agents: Array<{ id: string }>;
      sources: Array<Record<string, unknown>>;
    }>(request, `/api/v1/workspaces/${encodeURIComponent(slug)}/state`, `${pack.name} state`);
    expect(state.workspace.kind).toBe("production");
    expect(state.profile.publishedConfigurationVersion).toBe(pack.slug === "blank" ? 2 : 1);
    expect(state.scopes.length).toBeGreaterThan(0);
    expect(state.agents.length, `${pack.name} needs a configured agent for the accepted workflow`).toBeGreaterThan(0);

    const scopeId = state.scopes[0].id;
    const claim = validPackClaims[pack.slug];
    const sourceContent = `${claim.subjectName} may proceed when the current reviewed operating rule is approved. Exact evidence: ${claim.value}.`;
    const sourceSpan = `Exact evidence: ${claim.value}.`;
    const ingested = await productWrite<{
      command: string;
      result: { proposals: Array<{ id: string }> };
      state: { sources: Array<Record<string, unknown>> };
    }>(
      request,
      `${commandPath}/ingest`,
      {
        scopeId,
        source: {
          title: `${pack.name} operating rule`,
          type: "file",
          classification: "private",
          content: sourceContent,
        },
        claims: [{
          ...claim,
          sourceSpan,
        }],
      },
      `${pack.name} ingest`,
    );
    expect(ingested.command).toBe("ingest");
    expect(ingested.result.proposals).toHaveLength(1);
    expect(
      ingested.state.sources.every((source) => !("contentText" in source)),
      "private collection projections must not contain source bodies",
    ).toBe(true);
    const claimId = ingested.result.proposals[0].id;

    const unsupported = await request.post(`${commandPath}/ingest`, {
      headers: { "Idempotency-Key": idempotencyKey(`${pack.slug}-invalid-predicate`) },
      data: {
        scopeId,
        source: {
          title: `${pack.name} unsupported claim`,
          type: "file",
          classification: "private",
          content: "Unsupported claim evidence.",
        },
        claims: [{
          subjectName: claim.subjectName,
          subjectType: claim.subjectType,
          predicate: "unsupported.unconfigured_predicate",
          value: "must not enter truth",
          sourceSpan: "Unsupported claim evidence.",
        }],
      },
    });
    const unsupportedBody = await unsupported.json() as ApiEnvelope<unknown>;
    expect(unsupported.status()).toBe(400);
    expect(unsupportedBody.ok).toBe(false);
    if (unsupportedBody.ok) throw new Error("Unsupported predicate was accepted unexpectedly.");
    expect(unsupportedBody.error.code).toBe("VALIDATION_ERROR");
    const afterInvalid = await productGet<{ sources: Array<{ id: string }>; claims: Array<{ id: string }> }>(
      request,
      `/api/v1/workspaces/${encodeURIComponent(slug)}/state`,
      `${pack.name} state after invalid ingest`,
    );
    expect(afterInvalid.sources).toHaveLength(ingested.state.sources.length);
    expect(afterInvalid.claims.map((candidate) => candidate.id)).toContain(claimId);

    await productWrite(
      request,
      `${commandPath}/approve`,
      { claimId, reason: "E2E authorized review" },
      `${pack.name} approve`,
    );
    const asked = await productWrite<{
      result: { contextPack: { citations: Array<{ claimId: string }> } };
    }>(
      request,
      `${commandPath}/ask`,
      { question: `What is the current rule for ${pack.name}?`, scopeId },
      `${pack.name} ask`,
    );
    expect(asked.result.contextPack.citations.map((citation) => citation.claimId)).toContain(claimId);

    const agentRun = await productWrite<{
      result: { run: { id: string; receiptHash: string }; contextPack: { id: string; versionHash: string } };
    }>(
      request,
      `${commandPath}/run-agent`,
      { task: `Review the current ${pack.name} decision.`, scopeId },
      `${pack.name} run agent`,
    );
    expect(agentRun.result.run.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(agentRun.result.contextPack.versionHash).toMatch(/^[a-f0-9]{64}$/);

    const actionKey = idempotencyKey(`${pack.slug}-action`);
    const actionInput = {
      actionType: "label.apply",
      payload: { label: "e2e-reviewed" },
      evidenceClaimIds: [claimId],
      contextPackId: agentRun.result.contextPack.id,
    };
    const action = await productWrite<{
      result: { proposal: { id: string; status: string }; receipt: { id: string; status: string } | null };
    }>(request, `${commandPath}/propose-action`, actionInput, `${pack.name} action`, actionKey);
    const repeatedAction = await productWrite<{
      result: { proposal: { id: string; status: string }; receipt: { id: string; status: string } | null };
    }>(request, `${commandPath}/propose-action`, actionInput, `${pack.name} repeated action`, actionKey);
    expect(action.result.proposal.status).toBe("executed");
    expect(action.result.receipt?.status).toBe("executed");
    expect(repeatedAction.result.receipt?.id).toBe(action.result.receipt?.id);

    const replay = await productWrite<{
      result: { replay: { replayOfRunId: string }; comparison: { currentContextHash: string } };
    }>(
      request,
      `${commandPath}/replay`,
      { runId: agentRun.result.run.id },
      `${pack.name} replay`,
    );
    expect(replay.result.replay.replayOfRunId).toBe(agentRun.result.run.id);
    expect(replay.result.comparison.currentContextHash).toMatch(/^[a-f0-9]{64}$/);

    const outcome = await productWrite<{
      result: { outcome: { runId: string; receiptHash: string } };
    }>(
      request,
      `${commandPath}/outcome`,
      { runId: agentRun.result.run.id, status: "verified", metrics: { quality: 1 } },
      `${pack.name} outcome`,
    );
    expect(outcome.result.outcome.runId).toBe(agentRun.result.run.id);
    expect(outcome.result.outcome.receiptHash).toMatch(/^[a-f0-9]{64}$/);

    const rejectedSource = `Rejected evidence for ${claim.subjectName}: ${claim.value}.`;
    const rejected = await productWrite<{
      result: { proposals: Array<{ id: string }> };
    }>(
      request,
      `${commandPath}/ingest`,
      {
        scopeId,
        source: {
          title: `${pack.name} rejected note`,
          type: "file",
          classification: "private",
          content: rejectedSource,
        },
        claims: [{
          ...claim,
          sourceSpan: rejectedSource,
        }],
      },
      `${pack.name} second ingest`,
    );
    await productWrite(
      request,
      `${commandPath}/reject`,
      { claimId: rejected.result.proposals[0].id, reason: "Not authoritative" },
      `${pack.name} reject`,
    );
  }
});

test("login, setup, and all public templates have no serious accessibility findings", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const path of [...publicPacks.map((pack) => `/demo/${pack.slug}`), "/login", "/setup"]) {
    await page.goto(path);
    await expectNoBlockingA11y(page, path);
  }
});

test.describe("390px product layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("landing, setup, and public console avoid page-level horizontal overflow", async ({ page }) => {
    for (const path of ["/", "/setup", "/demo/agency-operations"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });

  test("all authenticated console surfaces remain within the mobile viewport", async ({ page, request }) => {
    test.skip(!process.env.DATABASE_URL, "Authenticated product E2E requires PostgreSQL.");
    const session = await productGet<{
      memberships: Array<{ workspace: { slug: string } }>;
    }>(request, "/api/v1/session", "mobile authenticated session");
    const slug = session.memberships[0]?.workspace.slug;
    expect(slug, "the local E2E principal needs an active workspace").toBeTruthy();

    for (const surface of ["overview", "inbox", "map", "ask", "agents", "replay", "evals", "settings"]) {
      await page.goto(`/app/${encodeURIComponent(slug!)}/${surface}`);
      await expect(page.locator("#product-main h1")).toBeVisible();
      await expect(page.getByText("No demo data was substituted.")).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${surface} authenticated horizontal overflow`).toBeLessThanOrEqual(1);
    }
  });
});
