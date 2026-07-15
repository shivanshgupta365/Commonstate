import {
  DEFAULT_QUESTION,
  INGEST_TEXT,
  type BackendState,
} from "./demoData";

export type DemoAction =
  | "reset"
  | "ask"
  | "ingest"
  | "approve"
  | "reject"
  | "run-agent"
  | "replay"
  | "outcome";

export type DemoApiError = {
  code: string;
  message: string;
  status?: number;
};

export type DemoApiSuccess<T> = {
  ok: true;
  action?: string;
  result: T;
  state: BackendState;
};

export type DemoApiFailure = {
  ok: false;
  error: DemoApiError;
};

export type DemoApiResponse<T> = DemoApiSuccess<T> | DemoApiFailure;
export type DemoInput = Readonly<Record<string, unknown>>;
export type DemoResponse<T = unknown> = DemoApiResponse<T>;

export interface DemoClient {
  readonly mode: "fresh" | "recorded";
  getState(options?: { timeoutMs?: number }): Promise<DemoResponse<never>>;
  execute<T>(
    action: DemoAction,
    input?: DemoInput,
  ): Promise<DemoResponse<T>>;
}

type RecordedDemoFixture = {
  schemaVersion: 1;
  fixtureVersion: string;
  generatorVersion: string;
  label: string;
  evalSummary: { passed: number; total: number };
  supported: {
    question: string;
    ingestText: string;
    ingestIdempotencyKey: string;
    approvalReason: string;
    rejectionReason: string;
    agentTask: string;
    runMode: "recorded";
    outcomeStatus: string;
    outcomeMetrics: Record<string, number>;
    outcomeNotes: string;
  };
  initial: BackendState;
  ask: DemoApiSuccess<unknown>;
  ingest: DemoApiSuccess<unknown>;
  approvals: Array<DemoApiSuccess<unknown>>;
  rejections: Array<DemoApiSuccess<unknown>>;
  runAgent: DemoApiSuccess<unknown>;
  replay: DemoApiSuccess<unknown>;
  outcome: DemoApiSuccess<unknown>;
  fixtureHash: string;
};

const DEFAULT_INITIAL_TIMEOUT_MS = 2_000;
const RECORDED_FIXTURE_URL = "/demo/recorded-tano-v1.json";

function failure(
  code: string,
  message: string,
  status?: number,
): DemoApiFailure {
  return {
    ok: false,
    error: { code, message, ...(status === undefined ? {} : { status }) },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRecordedFixture(value: unknown): value is RecordedDemoFixture {
  if (!isObject(value) || value.schemaVersion !== 1) return false;
  if (
    typeof value.fixtureVersion !== "string" ||
    typeof value.generatorVersion !== "string" ||
    !isObject(value.supported) ||
    !isObject(value.evalSummary) ||
    value.evalSummary.passed !== 24 ||
    value.evalSummary.total !== 24 ||
    typeof value.fixtureHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.fixtureHash)
  ) return false;
  if (
    value.supported.question !== DEFAULT_QUESTION ||
    value.supported.ingestText !== INGEST_TEXT ||
    typeof value.supported.ingestIdempotencyKey !== "string" ||
    typeof value.supported.approvalReason !== "string" ||
    typeof value.supported.rejectionReason !== "string" ||
    typeof value.supported.agentTask !== "string" ||
    value.supported.runMode !== "recorded" ||
    typeof value.supported.outcomeStatus !== "string" ||
    !isObject(value.supported.outcomeMetrics) ||
    typeof value.supported.outcomeNotes !== "string"
  ) {
    return false;
  }
  if (!isObject(value.initial) || !isObject(value.ask) || !isObject(value.ingest)) return false;
  const initialEvals = isObject(value.initial.evals) ? value.initial.evals : null;
  if (
    !initialEvals ||
    initialEvals.passed !== value.evalSummary.passed ||
    initialEvals.total !== value.evalSummary.total
  ) return false;
  if (!Array.isArray(value.approvals) || !Array.isArray(value.rejections)) return false;
  return isObject(value.runAgent) && isObject(value.replay) && isObject(value.outcome);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hasValidFixtureHash(fixture: RecordedDemoFixture): Promise<boolean> {
  const { fixtureHash, ...payload } = fixture;
  return (await sha256Hex(JSON.stringify(payload))) === fixtureHash;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parsedFailure(payload: unknown, status: number, fallbackMessage: string): DemoApiFailure {
  if (isObject(payload) && payload.ok === false && isObject(payload.error)) {
    const code = typeof payload.error.code === "string" ? payload.error.code : `HTTP_${status}`;
    const message = typeof payload.error.message === "string" ? payload.error.message : fallbackMessage;
    return failure(code, message, status);
  }
  return failure(`HTTP_${status}`, fallbackMessage, status);
}

export class ApiDemoClient implements DemoClient {
  readonly mode = "fresh" as const;

  async getState(
    options: { timeoutMs?: number } = {},
  ): Promise<DemoApiResponse<never>> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_INITIAL_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("/api/demo/state", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok: true; state: BackendState }
        | DemoApiFailure
        | null;
      if (!response.ok || !payload || payload.ok !== true) {
        return parsedFailure(
          payload,
          response.status,
          "The isolated demo state could not be loaded.",
        );
      }
      return { ok: true, result: undefined as never, state: payload.state };
    } catch (error) {
      if (controller.signal.aborted) {
        return failure(
          "REQUEST_TIMEOUT",
          `The fresh demo did not respond within ${timeoutMs}ms.`,
        );
      }
      return failure(
        "NETWORK_ERROR",
        error instanceof Error
          ? `The fresh demo could not be reached: ${error.message}`
          : "The fresh demo could not be reached.",
      );
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  async execute<T>(
    action: DemoAction,
    body: DemoInput = {},
  ): Promise<DemoApiResponse<T>> {
    try {
      const response = await fetch(`/api/demo/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as
        | DemoApiResponse<T>
        | null;
      if (!response.ok || !payload || payload.ok !== true) {
        return parsedFailure(
          payload,
          response.status,
          "The demo API rejected this request.",
        );
      }
      return payload;
    } catch (error) {
      return failure(
        "NETWORK_ERROR",
        error instanceof Error
          ? `The demo API could not be reached: ${error.message}`
          : "The demo API could not be reached.",
      );
    }
  }
}

function resultObject(response: DemoApiSuccess<unknown>): Record<string, unknown> {
  return isObject(response.result) ? response.result : {};
}

function stringAt(value: unknown, ...path: string[]): string | null {
  let current: unknown = value;
  for (const segment of path) {
    if (!isObject(current)) return null;
    current = current[segment];
  }
  return typeof current === "string" ? current : null;
}

function responseProposalId(response: DemoApiSuccess<unknown>): string | null {
  const proposalIds = resultObject(response).proposalIds;
  return Array.isArray(proposalIds) && typeof proposalIds[0] === "string"
    ? proposalIds[0]
    : null;
}

function sameMetrics(
  candidate: unknown,
  supported: Record<string, number>,
): boolean {
  if (!isObject(candidate)) return false;
  const candidateKeys = Object.keys(candidate).sort();
  const supportedKeys = Object.keys(supported).sort();
  return (
    candidateKeys.length === supportedKeys.length &&
    candidateKeys.every(
      (key, index) =>
        key === supportedKeys[index] &&
        typeof candidate[key] === "number" &&
        Number.isFinite(candidate[key]) &&
        candidate[key] === supported[key],
    )
  );
}

function hasExactKeys(value: DemoInput, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

type RecordedPhase =
  | "initial"
  | "asked"
  | "ingested"
  | "approving"
  | "rejecting"
  | "approved"
  | "rejected"
  | "agent-run"
  | "replayed"
  | "outcome";

export class RecordedDemoClient implements DemoClient {
  readonly mode = "recorded" as const;
  private currentState: BackendState;
  private approvalIndex = 0;
  private rejectionIndex = 0;
  private phase: RecordedPhase = "initial";

  private constructor(private readonly fixture: RecordedDemoFixture) {
    this.currentState = clone(fixture.initial);
  }

  static async load(): Promise<RecordedDemoClient | DemoApiFailure> {
    try {
      const response = await fetch(RECORDED_FIXTURE_URL, {
        cache: "force-cache",
        headers: { accept: "application/json" },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        return failure(
          `RECORDED_FIXTURE_HTTP_${response.status}`,
          "The deterministic fallback recording could not be loaded.",
          response.status,
        );
      }
      if (!isRecordedFixture(payload)) {
        return failure(
          "RECORDED_FIXTURE_INVALID",
          "The deterministic fallback recording has an unsupported schema or script.",
        );
      }
      if (!(await hasValidFixtureHash(payload))) {
        return failure(
          "RECORDED_FIXTURE_HASH_MISMATCH",
          "The deterministic fallback recording failed its SHA-256 integrity check.",
        );
      }
      return new RecordedDemoClient(payload);
    } catch (error) {
      return failure(
        "RECORDED_FIXTURE_UNAVAILABLE",
        error instanceof Error
          ? `The deterministic fallback recording could not be loaded: ${error.message}`
          : "The deterministic fallback recording could not be loaded.",
      );
    }
  }

  async getState(): Promise<DemoApiResponse<never>> {
    return {
      ok: true,
      result: undefined as never,
      state: clone(this.currentState),
    };
  }

  private unsupported(message: string): DemoApiFailure {
    return failure("RECORDED_INPUT_UNSUPPORTED", message, 422);
  }

  private outOfSequence(action: DemoAction, expected: string): DemoApiFailure {
    return failure(
      "RECORDED_DEMO_OUT_OF_SEQUENCE",
      `Recorded ${action} is not available during ${this.phase}. ${expected}`,
      409,
    );
  }

  private apply<T>(
    response: DemoApiSuccess<unknown> | undefined,
    action: DemoAction,
  ): DemoApiResponse<T> {
    if (!response) {
      return failure(
        "RECORDED_DEMO_OUT_OF_SEQUENCE",
        `No recorded response remains for ${action}. Reset the deterministic demo to replay it.`,
        409,
      );
    }
    const copy = clone(response);
    this.currentState = clone(copy.state);
    return copy as DemoApiSuccess<T>;
  }

  async execute<T>(
    action: DemoAction,
    body: DemoInput = {},
  ): Promise<DemoApiResponse<T>> {
    const supported = this.fixture.supported;
    switch (action) {
      case "reset":
        if (!hasExactKeys(body, [])) {
          return this.unsupported("Recorded reset does not accept additional input.");
        }
        this.currentState = clone(this.fixture.initial);
        this.approvalIndex = 0;
        this.rejectionIndex = 0;
        this.phase = "initial";
        return {
          ok: true,
          action: "reset",
          result: {
            reset: true,
            message: "Recorded deterministic workspace restored.",
          } as T,
          state: clone(this.fixture.initial),
        };
      case "ask": {
        if (this.phase !== "initial") {
          return this.outOfSequence(action, "Reset the recording before asking again.");
        }
        if (!hasExactKeys(body, ["question"]) || body.question !== supported.question) {
          return this.unsupported(
            "Recorded mode supports the scripted creator-eligibility question only. Reset the question to the suggested prompt or retry the fresh API.",
          );
        }
        const response = this.apply<T>(this.fixture.ask, action);
        if (response.ok) this.phase = "asked";
        return response;
      }
      case "ingest": {
        if (this.phase !== "initial" && this.phase !== "asked") {
          return this.outOfSequence(action, "Reset the recording before ingesting again.");
        }
        if (
          !hasExactKeys(body, ["idempotencyKey", "text"]) ||
          body.text !== supported.ingestText ||
          body.idempotencyKey !== supported.ingestIdempotencyKey
        ) {
          return this.unsupported(
            "Recorded mode supports the labelled synthetic Slack update only.",
          );
        }
        this.approvalIndex = 0;
        this.rejectionIndex = 0;
        const response = this.apply<T>(this.fixture.ingest, action);
        if (response.ok) this.phase = "ingested";
        return response;
      }
      case "approve": {
        if (this.phase !== "ingested" && this.phase !== "approving") {
          return this.outOfSequence(action, "Ingest the recorded update before approving it.");
        }
        const response = this.fixture.approvals[this.approvalIndex];
        if (
          !hasExactKeys(body, ["proposalId", "reason"]) ||
          !response ||
          body.proposalId !== responseProposalId(response) ||
          body.reason !== supported.approvalReason
        ) {
          return this.unsupported(
            "That proposal is not the next claim in the recorded approval sequence.",
          );
        }
        this.approvalIndex += 1;
        const result = this.apply<T>(response, action);
        if (result.ok) {
          this.phase = this.approvalIndex === this.fixture.approvals.length
            ? "approved"
            : "approving";
        }
        return result;
      }
      case "reject": {
        if (this.phase !== "ingested" && this.phase !== "rejecting") {
          return this.outOfSequence(action, "Ingest the recorded update before rejecting it.");
        }
        const response = this.fixture.rejections[this.rejectionIndex];
        if (
          !hasExactKeys(body, ["proposalId", "reason"]) ||
          !response ||
          body.proposalId !== responseProposalId(response) ||
          body.reason !== supported.rejectionReason
        ) {
          return this.unsupported(
            "That proposal is not the next claim in the recorded rejection sequence.",
          );
        }
        this.rejectionIndex += 1;
        const result = this.apply<T>(response, action);
        if (result.ok) {
          this.phase = this.rejectionIndex === this.fixture.rejections.length
            ? "rejected"
            : "rejecting";
        }
        return result;
      }
      case "run-agent": {
        if (this.phase !== "approved") {
          return this.outOfSequence(action, "Approve every recorded proposal before running the agent.");
        }
        if (
          !hasExactKeys(body, ["mode", "task"]) ||
          body.task !== supported.agentTask ||
          body.mode !== supported.runMode
        ) {
          return this.unsupported(
            "Recorded mode supports the scripted Relationship Agent task in recorded mode only.",
          );
        }
        const response = this.apply<T>(this.fixture.runAgent, action);
        if (response.ok) this.phase = "agent-run";
        return response;
      }
      case "replay": {
        if (this.phase !== "agent-run") {
          return this.outOfSequence(action, "Run the recorded agent before replaying its prior receipt.");
        }
        const runId = stringAt(this.fixture.replay.result, "originalRun", "id");
        if (!hasExactKeys(body, ["runId"]) || !runId || body.runId !== runId) {
          return this.unsupported(
            "Recorded mode can replay the seeded baseline receipt only.",
          );
        }
        const response = this.apply<T>(this.fixture.replay, action);
        if (response.ok) this.phase = "replayed";
        return response;
      }
      case "outcome": {
        if (this.phase !== "replayed") {
          return this.outOfSequence(action, "Replay the recorded decision before closing the loop.");
        }
        const runId = stringAt(this.fixture.runAgent.result, "run", "id");
        if (
          !hasExactKeys(body, ["metrics", "notes", "runId", "status"]) ||
          !runId ||
          body.runId !== runId ||
          body.status !== supported.outcomeStatus ||
          body.notes !== supported.outcomeNotes ||
          !sameMetrics(body.metrics, supported.outcomeMetrics)
        ) {
          return this.unsupported(
            "Recorded mode supports the scripted synthetic campaign outcome only.",
          );
        }
        const response = this.apply<T>(this.fixture.outcome, action);
        if (response.ok) this.phase = "outcome";
        return response;
      }
    }
  }
}

function mayUseInitialFallback(response: DemoApiFailure): boolean {
  return (
    response.error.code === "NETWORK_ERROR" ||
    response.error.code === "REQUEST_TIMEOUT" ||
    response.error.status === 503
  );
}

export type DemoBootstrapResult =
  | {
      client: DemoClient;
      response: DemoApiSuccess<never>;
      fallbackReason: DemoApiError | null;
    }
  | {
      client: null;
      response: DemoApiFailure;
      fallbackReason: DemoApiError | null;
    };

export async function bootstrapDemoClient(
  options: { forceRecorded?: boolean } = {},
): Promise<DemoBootstrapResult> {
  if (options.forceRecorded) {
    const recordedClient = await RecordedDemoClient.load();
    if (!(recordedClient instanceof RecordedDemoClient)) {
      return { client: null, response: recordedClient, fallbackReason: null };
    }
    const response = await recordedClient.getState();
    return response.ok
      ? { client: recordedClient, response, fallbackReason: null }
      : { client: null, response, fallbackReason: null };
  }

  const apiClient = new ApiDemoClient();
  const apiResponse = await apiClient.getState({
    timeoutMs: DEFAULT_INITIAL_TIMEOUT_MS,
  });
  if (apiResponse.ok) {
    return { client: apiClient, response: apiResponse, fallbackReason: null };
  }
  if (!mayUseInitialFallback(apiResponse)) {
    return { client: null, response: apiResponse, fallbackReason: null };
  }

  const recordedClient = await RecordedDemoClient.load();
  if (!(recordedClient instanceof RecordedDemoClient)) {
    return {
      client: null,
      response: recordedClient,
      fallbackReason: apiResponse.error,
    };
  }
  const recordedState = await recordedClient.getState();
  if (!recordedState.ok) {
    return {
      client: null,
      response: recordedState,
      fallbackReason: apiResponse.error,
    };
  }
  return {
    client: recordedClient,
    response: recordedState,
    fallbackReason: apiResponse.error,
  };
}
