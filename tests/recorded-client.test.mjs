import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const QUESTION =
  "Which creators can launch whitelisted TikTok ads this week under £15k, with current rights and no unresolved deliverables?";
const INGEST_TEXT =
  "Synthetic Slack update: Use a supportive, low-pressure rebrief. Amara's paid usage now ends 18 July and her revised hook is still unresolved. Hold paid activation until both are confirmed.";
const INGEST_KEY = "demo-slack-update-2026-07-15-v1";
const APPROVAL_REASON =
  "Human operator verified all three source spans and accepted their blast radius.";
const REJECTION_REASON = "Human operator rejected the ingested source claims.";
const AGENT_TASK =
  "Prepare the Bloom & Wild TikTok creator launch queue and fail closed on rights or delivery uncertainty.";
const OUTCOME_NOTES =
  "Synthetic demo outcome: early rights checks reduced rebrief work without executing an external campaign mutation.";

async function withRecordedModule(run) {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  const originalFetch = globalThis.fetch;
  const fixtureText = await readFile(
    new URL("../public/demo/recorded-tano-v1.json", import.meta.url),
    "utf8",
  );
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url === "/demo/recorded-tano-v1.json") {
      return new Response(fixtureText, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Unexpected network request in recorded test: ${url}`);
  };
  try {
    const clientModule = await import("../components/console/demoClient.ts");
    return await run(clientModule);
  } finally {
    globalThis.fetch = originalFetch;
    unregister();
  }
}

test("recorded client enforces its workflow order and exact declared inputs", async () => {
  await withRecordedModule(async ({ RecordedDemoClient }) => {
    const client = await RecordedDemoClient.load();
    assert.ok(client instanceof RecordedDemoClient);

    const prematureRun = await client.execute("run-agent", {
      task: AGENT_TASK,
      mode: "recorded",
    });
    assert.equal(prematureRun.ok, false);
    assert.equal(prematureRun.error.code, "RECORDED_DEMO_OUT_OF_SEQUENCE");

    const alteredQuestion = await client.execute("ask", {
      question: QUESTION,
      extra: true,
    });
    assert.equal(alteredQuestion.ok, false);
    assert.equal(alteredQuestion.error.code, "RECORDED_INPUT_UNSUPPORTED");
    assert.equal((await client.execute("ask", { question: QUESTION })).ok, true);

    const ingest = await client.execute("ingest", {
      text: INGEST_TEXT,
      idempotencyKey: INGEST_KEY,
    });
    assert.equal(ingest.ok, true);
    assert.equal(ingest.result.proposalIds.length, 3);

    const wrongReason = await client.execute("approve", {
      proposalId: ingest.result.proposalIds[0],
      reason: "Approved without the recorded evidence review.",
    });
    assert.equal(wrongReason.ok, false);
    assert.equal(wrongReason.error.code, "RECORDED_INPUT_UNSUPPORTED");

    for (const proposalId of ingest.result.proposalIds) {
      const approval = await client.execute("approve", {
        proposalId,
        reason: APPROVAL_REASON,
      });
      assert.equal(approval.ok, true);
    }

    const alteredRun = await client.execute("run-agent", {
      task: AGENT_TASK,
      mode: "recorded",
      hidden: "extra",
    });
    assert.equal(alteredRun.ok, false);
    assert.equal(alteredRun.error.code, "RECORDED_INPUT_UNSUPPORTED");

    const run = await client.execute("run-agent", {
      task: AGENT_TASK,
      mode: "recorded",
    });
    assert.equal(run.ok, true);
    const repeatedRun = await client.execute("run-agent", {
      task: AGENT_TASK,
      mode: "recorded",
    });
    assert.equal(repeatedRun.ok, false);
    assert.equal(repeatedRun.error.code, "RECORDED_DEMO_OUT_OF_SEQUENCE");

    const initial = (await RecordedDemoClient.load());
    assert.ok(initial instanceof RecordedDemoClient);
    const initialState = await initial.getState();
    assert.equal(initialState.ok, true);
    const baselineRun = [...initialState.state.agentRuns]
      .reverse()
      .find((candidate) => candidate.mode !== "replay");
    assert.ok(baselineRun);

    const replay = await client.execute("replay", { runId: baselineRun.id });
    assert.equal(replay.ok, true);

    const extraMetric = await client.execute("outcome", {
      runId: run.result.run.id,
      status: "measured",
      metrics: { rebriefHoursSaved: 3.2, ctrLiftPercent: 18.4, ignored: 1 },
      notes: OUTCOME_NOTES,
    });
    assert.equal(extraMetric.ok, false);
    assert.equal(extraMetric.error.code, "RECORDED_INPUT_UNSUPPORTED");

    const reorderedMetrics = await client.execute("outcome", {
      runId: run.result.run.id,
      status: "measured",
      metrics: { rebriefHoursSaved: 3.2, ctrLiftPercent: 18.4 },
      notes: OUTCOME_NOTES,
    });
    assert.equal(reorderedMetrics.ok, true);
  });
});

test("recorded decisions cannot mix rejection and approval branches", async () => {
  await withRecordedModule(async ({ RecordedDemoClient }) => {
    const client = await RecordedDemoClient.load();
    assert.ok(client instanceof RecordedDemoClient);
    const ingest = await client.execute("ingest", {
      text: INGEST_TEXT,
      idempotencyKey: INGEST_KEY,
    });
    assert.equal(ingest.ok, true);

    const rejection = await client.execute("reject", {
      proposalId: ingest.result.proposalIds[0],
      reason: REJECTION_REASON,
    });
    assert.equal(rejection.ok, true);
    const mixedApproval = await client.execute("approve", {
      proposalId: ingest.result.proposalIds[1],
      reason: APPROVAL_REASON,
    });
    assert.equal(mixedApproval.ok, false);
    assert.equal(mixedApproval.error.code, "RECORDED_DEMO_OUT_OF_SEQUENCE");

    const invalidReset = await client.execute("reset", { unexpected: true });
    assert.equal(invalidReset.ok, false);
    assert.equal(invalidReset.error.code, "RECORDED_INPUT_UNSUPPORTED");
    assert.equal((await client.execute("reset", {})).ok, true);
  });
});

test("automatic fallback is initial-only and validation errors remain live failures", async () => {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  const originalFetch = globalThis.fetch;
  const fixtureText = await readFile(
    new URL("../public/demo/recorded-tano-v1.json", import.meta.url),
    "utf8",
  );
  try {
    const requests = [];
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      requests.push(url);
      if (url === "/api/demo/state") {
        return Response.json(
          { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "offline" } },
          { status: 503 },
        );
      }
      if (url === "/demo/recorded-tano-v1.json") {
        return new Response(fixtureText, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const clientModule = await import("../components/console/demoClient.ts");
    const fallback = await clientModule.bootstrapDemoClient();
    assert.equal(fallback.client?.mode, "recorded");
    assert.deepEqual(requests, ["/api/demo/state", "/demo/recorded-tano-v1.json"]);

    requests.length = 0;
    globalThis.fetch = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      requests.push(url);
      return Response.json(
        { ok: false, error: { code: "INVALID_INPUT", message: "bad request" } },
        { status: 422 },
      );
    };
    const validation = await clientModule.bootstrapDemoClient();
    assert.equal(validation.client, null);
    assert.equal(validation.response.ok, false);
    assert.deepEqual(requests, ["/api/demo/state"]);
  } finally {
    globalThis.fetch = originalFetch;
    unregister();
  }
});
