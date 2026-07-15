/**
 * Regenerate with:
 *   node --experimental-transform-types scripts/generate-recorded-fixture.ts
 *
 * This deliberately exercises the pure domain model. It does not start a web
 * server, call an API route, inspect a build directory, or rewrite page assets.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import type {
  DomainState,
  JsonObject,
  StorageMeta,
} from "../lib/commonstate/domain";
import type { BackendState } from "../components/console/demoData";

const domain = (await import(
  new URL("../lib/commonstate/domain.ts", import.meta.url).href
)) as typeof import("../lib/commonstate/domain");
const {
  DEFAULT_AGENT_TASK,
  DEFAULT_QUESTION,
  DEMO_NOW,
  askCommonstate,
  createSeedState,
  decideProposals,
  ingestUpdate,
  publicSnapshot,
  recordOutcome,
  replayAgentRun,
  runRelationshipAgent,
} = domain;

type Mutation = {
  state: DomainState;
  changed: boolean;
  result: JsonObject;
};

const workspaceId = "recorded-tano-v1";
const ingestText =
  "Synthetic Slack update: Use a supportive, low-pressure rebrief. Amara's paid usage now ends 18 July and her revised hook is still unresolved. Hold paid activation until both are confirmed.";
const ingestIdempotencyKey = "demo-slack-update-2026-07-15-v1";
const approvalReason =
  "Human operator verified all three source spans and accepted their blast radius.";
const rejectionReason = "Human operator rejected the ingested source claims.";
const outcomeStatus = "measured";
const outcomeMetrics = { ctrLiftPercent: 18.4, rebriefHoursSaved: 3.2 };
const outcomeNotes =
  "Synthetic demo outcome: early rights checks reduced rebrief work without executing an external campaign mutation.";
const storage: StorageMeta = {
  mode: "memory-local",
  deterministic: true,
  notice: "Versioned deterministic recording generated from the Commonstate domain model.",
};

function objects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
}

function frontendSnapshot(state: DomainState): BackendState {
  const raw = publicSnapshot(state, storage) as Record<string, unknown>;
  const rawEvals = raw.evals as Record<string, unknown>;
  const sources = objects(raw.sources).map((source) => ({
    id: source.id,
    title: source.title,
    sourceType: source.sourceType,
    classification: source.classification,
    sha256: source.sha256,
    capturedAt: source.capturedAt,
    contentPreview: source.contentPreview,
  }));
  const agentRuns = objects(raw.agentRuns).map((run) => {
    const withoutReceipt = { ...run };
    delete withoutReceipt.receipt;
    return withoutReceipt;
  });
  const evalResults = objects(rawEvals.results).map((result) => ({
    id: result.id,
    category: result.category,
    caseName: result.caseName,
    passed: result.passed,
    durationMs: result.durationMs,
  }));

  return {
    meta: raw.meta,
    metrics: raw.metrics,
    sources,
    claims: raw.claims,
    proposals: raw.proposals,
    conflicts: raw.conflicts,
    contextPacks: raw.contextPacks,
    agentRuns,
    outcomes: raw.outcomes,
    eligibleCreators: raw.eligibleCreators,
    blockedCreators: raw.blockedCreators,
    evals: {
      suite: rawEvals.suite,
      passed: rawEvals.passed,
      total: rawEvals.total,
      durationMs: rawEvals.durationMs,
      results: evalResults,
    },
  } as BackendState;
}

function response(action: string, result: JsonObject, state: DomainState) {
  return {
    ok: true as const,
    action,
    result,
    state: frontendSnapshot(state),
  };
}

function commit(current: DomainState, mutation: Mutation): DomainState {
  if (!mutation.changed) return current;
  const next = mutation.state;
  next.workspace.version = current.workspace.version + 1;
  next.workspace.updatedAt = new Date(
    Date.parse(DEMO_NOW) + next.workspace.version * 3 * 60_000,
  ).toISOString();
  return next;
}

function apply(
  current: DomainState,
  action: string,
  mutation: Mutation,
): [DomainState, ReturnType<typeof response>] {
  const next = commit(current, mutation);
  return [next, response(action, mutation.result, next)];
}

async function recordRejections() {
  let state = await createSeedState(workspaceId);
  [state] = apply(state, "ask", askCommonstate(state, { question: DEFAULT_QUESTION }));
  const ingestMutation = await ingestUpdate(state, {
    idempotencyKey: ingestIdempotencyKey,
    text: ingestText,
  });
  const [ingestedState, ingestResponse] = apply(state, "ingest", ingestMutation);
  state = ingestedState;
  const proposalIds = Array.isArray(ingestResponse.result.proposalIds)
    ? ingestResponse.result.proposalIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const rejections: Array<ReturnType<typeof response>> = [];
  for (const proposalId of proposalIds) {
    let rejection: ReturnType<typeof response>;
    [state, rejection] = apply(
      state,
      "reject",
      decideProposals(
        state,
        { proposalId, reason: rejectionReason },
        "rejected",
      ),
    );
    rejections.push(rejection);
  }
  return rejections;
}

async function generateFixture() {
  const rejections = await recordRejections();
  let state = await createSeedState(workspaceId);
  const initial = frontendSnapshot(state);

  const [askedState, ask] = apply(
    state,
    "ask",
    askCommonstate(state, { question: DEFAULT_QUESTION }),
  );
  state = askedState;

  const [ingestedState, ingest] = apply(
    state,
    "ingest",
    await ingestUpdate(state, {
      idempotencyKey: ingestIdempotencyKey,
      text: ingestText,
    }),
  );
  state = ingestedState;
  const proposalIds = Array.isArray(ingest.result.proposalIds)
    ? ingest.result.proposalIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (proposalIds.length !== 3) {
    throw new Error(`Expected 3 recorded proposals, received ${proposalIds.length}.`);
  }

  const approvals: Array<ReturnType<typeof response>> = [];
  for (const proposalId of proposalIds) {
    let approval: ReturnType<typeof response>;
    [state, approval] = apply(
      state,
      "approve",
      decideProposals(
        state,
        { proposalId, reason: approvalReason },
        "approved",
      ),
    );
    approvals.push(approval);
  }

  const [agentState, runAgent] = apply(
    state,
    "run-agent",
    runRelationshipAgent(state, {
      task: DEFAULT_AGENT_TASK,
      mode: "recorded",
    }),
  );
  state = agentState;
  const recordedRunId =
    typeof runAgent.result.run === "object" &&
    runAgent.result.run !== null &&
    typeof (runAgent.result.run as JsonObject).id === "string"
      ? ((runAgent.result.run as JsonObject).id as string)
      : null;
  if (!recordedRunId) throw new Error("The recorded Relationship Agent run is missing.");
  const baselineRun = [...state.agentRuns]
    .reverse()
    .find((run) => run.mode !== "replay" && run.id !== recordedRunId);
  if (!baselineRun) throw new Error("The seeded baseline run is missing.");

  const [replayedState, replay] = apply(
    state,
    "replay",
    replayAgentRun(state, { runId: baselineRun.id }),
  );
  state = replayedState;

  const [, outcome] = apply(
    state,
    "outcome",
    recordOutcome(state, {
      runId: recordedRunId,
      status: outcomeStatus,
      metrics: outcomeMetrics,
      notes: outcomeNotes,
    }),
  );

  const fixturePayload = {
    schemaVersion: 1 as const,
    fixtureVersion: "recorded-tano-v1",
    generatorVersion: "pure-domain-v1",
    label: "Recorded deterministic Commonstate walkthrough",
    evalSummary: {
      passed: initial.evals.passed,
      total: initial.evals.total,
    },
    supported: {
      question: DEFAULT_QUESTION,
      ingestText,
      ingestIdempotencyKey,
      approvalReason,
      rejectionReason,
      agentTask: DEFAULT_AGENT_TASK,
      runMode: "recorded" as const,
      outcomeStatus,
      outcomeMetrics,
      outcomeNotes,
    },
    initial,
    ask,
    ingest,
    approvals,
    rejections,
    runAgent,
    replay,
    outcome,
  };

  if (
    fixturePayload.evalSummary.passed !== 24 ||
    fixturePayload.evalSummary.total !== 24
  ) {
    throw new Error(
      `The recording requires 24/24 evals; received ${fixturePayload.evalSummary.passed}/${fixturePayload.evalSummary.total}.`,
    );
  }
  const fixtureHash = createHash("sha256")
    .update(JSON.stringify(fixturePayload))
    .digest("hex");
  if (!/^[a-f0-9]{64}$/.test(fixtureHash)) {
    throw new Error("The fixture generator did not produce a valid SHA-256 hash.");
  }
  return { ...fixturePayload, fixtureHash };
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  projectRoot,
  "public",
  "demo",
  "recorded-tano-v1.json",
);
const fixture = await generateFixture();
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(fixture, null, 2)}\n`);
process.stdout.write(
  `Recorded fixture generated from pure domain functions: ${path.relative(process.cwd(), outputPath)}\n`,
);
