import {
  askCommonstate,
  decideProposals,
  DomainError,
  ingestUpdate,
  proposeClaim,
  publicSnapshot,
  recordOutcome,
  replayAgentRun,
  resolveWorkspaceIdentity,
  runRelationshipAgent,
  type DomainState,
  type JsonObject,
  type StorageMeta,
} from "./domain";
import {
  commitWorkspace,
  openWorkspace,
  resetWorkspace,
  type WorkspaceSession,
} from "./repository";

type DomainMutationResult = {
  state: DomainState;
  changed: boolean;
  result: JsonObject;
};

type DomainMutation = (
  state: DomainState,
  input: JsonObject,
) => DomainMutationResult | Promise<DomainMutationResult>;

const jsonHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
};

function response(body: unknown, init?: ResponseInit, setCookie?: string): Response {
  const headers = new Headers(jsonHeaders);
  if (init?.headers) {
    new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  }
  if (setCookie) headers.append("set-cookie", setCookie);
  return Response.json(body, {
    ...init,
    headers,
  });
}

async function readPayload(request: Request): Promise<JsonObject> {
  const maxBytes = 64 * 1024;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maxBytes) {
    throw new DomainError("PAYLOAD_TOO_LARGE", "request body must be 64KB or smaller", 413);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) {
      throw new DomainError("PAYLOAD_TOO_LARGE", "request body must be 64KB or smaller", 413);
    }
    const payload: unknown = JSON.parse(raw);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new DomainError("INVALID_JSON", "request body must be a JSON object");
    }
    return payload as JsonObject;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("INVALID_JSON", "request body contains invalid JSON");
  }
}

function toErrorResponse(error: unknown, setCookie?: string): Response {
  if (error instanceof DomainError) {
    return response(
      { ok: false, error: { code: error.code, message: error.message } },
      { status: error.status },
      setCookie,
    );
  }
  return response(
    {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "The demo command could not be completed safely.",
      },
    },
    { status: 500 },
    setCookie,
  );
}

async function mutate(
  request: Request,
  action: string,
  operation: DomainMutation,
): Promise<Response> {
  let setCookie: string | undefined;
  try {
    const preliminaryIdentity = await resolveWorkspaceIdentity(request);
    setCookie = preliminaryIdentity.setCookie;
    const payload = await readPayload(request);
    const identity = preliminaryIdentity.localTestOverride
      ? await resolveWorkspaceIdentity(request, payload)
      : preliminaryIdentity;
    setCookie = identity.setCookie;
    const session = await openWorkspace(identity.workspaceId);
    const mutation = await operation(session.state, payload);
    let storage = session.storage;
    if (mutation.changed) storage = await commitWorkspace(session, mutation.state);
    const state = publicSnapshot(mutation.changed ? mutation.state : session.state, storage);
    return response({ ok: true, action, result: mutation.result, state }, undefined, setCookie);
  } catch (error) {
    return toErrorResponse(error, setCookie);
  }
}

export async function getState(request: Request): Promise<Response> {
  let setCookie: string | undefined;
  try {
    const identity = await resolveWorkspaceIdentity(request);
    setCookie = identity.setCookie;
    const session = await openWorkspace(identity.workspaceId);
    return response(
      { ok: true, state: publicSnapshot(session.state, session.storage) },
      undefined,
      setCookie,
    );
  } catch (error) {
    return toErrorResponse(error, setCookie);
  }
}

export async function resetState(request: Request): Promise<Response> {
  let setCookie: string | undefined;
  try {
    const preliminaryIdentity = await resolveWorkspaceIdentity(request);
    setCookie = preliminaryIdentity.setCookie;
    const payload = await readPayload(request);
    const identity = preliminaryIdentity.localTestOverride
      ? await resolveWorkspaceIdentity(request, payload)
      : preliminaryIdentity;
    setCookie = identity.setCookie;
    const session = await openWorkspace(identity.workspaceId);
    const reset = await resetWorkspace(session);
    return response({
      ok: true,
      action: "reset",
      result: { reset: true, message: "The isolated demo workspace returned to its seeded state." },
      state: publicSnapshot(reset.state, reset.storage),
    }, undefined, setCookie);
  } catch (error) {
    return toErrorResponse(error, setCookie);
  }
}

export async function ingest(request: Request): Promise<Response> {
  return mutate(request, "ingest", ingestUpdate);
}

export async function approve(request: Request): Promise<Response> {
  return mutate(request, "approve", (state, payload) =>
    decideProposals(state, payload, "approved"),
  );
}

export async function reject(request: Request): Promise<Response> {
  return mutate(request, "reject", (state, payload) =>
    decideProposals(state, payload, "rejected"),
  );
}

export async function ask(request: Request): Promise<Response> {
  return mutate(request, "ask", askCommonstate);
}

export async function runAgent(request: Request): Promise<Response> {
  return mutate(request, "run-agent", runRelationshipAgent);
}

export async function replay(request: Request): Promise<Response> {
  return mutate(request, "replay", replayAgentRun);
}

export async function outcome(request: Request): Promise<Response> {
  return mutate(request, "outcome", recordOutcome);
}

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

function rpcSuccess(id: unknown, result: unknown, setCookie?: string): Response {
  return response({ jsonrpc: "2.0", id: id ?? null, result }, undefined, setCookie);
}

function rpcError(
  id: unknown,
  code: number,
  message: string,
  data?: unknown,
  setCookie?: string,
): Response {
  return response({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }, undefined, setCookie);
}

const mcpTools = [
  {
    name: "get_context_pack",
    description: "Compile the minimum current, permission-scoped evidence for an agent task.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        entity_refs: { type: "array", items: { type: "string" } },
        as_of: { type: "string", format: "date-time" },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    name: "get_evidence",
    description: "Resolve claim IDs to immutable source spans in the authenticated workspace.",
    inputSchema: {
      type: "object",
      properties: { claim_ids: { type: "array", items: { type: "string" } } },
      required: ["claim_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_claim",
    description: "Ingest an untrusted source event and propose claims for human review.",
    inputSchema: {
      type: "object",
      properties: {
        subject_ref: { type: "string" },
        predicate: { type: "string" },
        source_ref: { type: "string" },
        value: {},
        value_type: { type: "string" },
        source_span: { type: "string" },
        validity: {
          type: "object",
          properties: { from: { type: "string" }, to: { type: "string" } },
          additionalProperties: false,
        },
        idempotency_key: { type: "string" },
      },
      required: ["subject_ref", "predicate", "value", "source_ref", "validity", "idempotency_key"],
      additionalProperties: false,
    },
  },
  {
    name: "request_approval",
    description: "Request a human-reviewed approval decision for proposed claims.",
    inputSchema: {
      type: "object",
      properties: {
        proposal_ids: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["proposal_ids", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "record_outcome",
    description: "Append an immutable outcome receipt and create a proposed learning.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        status: { type: "string" },
        metrics: { type: "object", additionalProperties: { type: "number" } },
        notes: { type: "string" },
      },
      required: ["run_id", "status"],
      additionalProperties: false,
    },
  },
] as const;

async function mcpToolCall(
  session: WorkspaceSession,
  name: string,
  args: JsonObject,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  let mutation: DomainMutationResult | null = null;
  let directResult: unknown = null;
  if (name === "get_context_pack") {
    mutation = askCommonstate(session.state, {
      question: args.task,
      asOf: args.as_of,
      entityRefs: args.entity_refs,
      // Workspace and identity intentionally do not come from model-supplied arguments.
    });
    directResult = mutation.result;
  } else if (name === "get_evidence") {
    const requested = Array.isArray(args.claim_ids)
      ? args.claim_ids.filter((value): value is string => typeof value === "string")
      : [];
    const localClaims = session.state.claims.filter(
      (claim) => requested.includes(claim.id) && claim.workspaceId === session.state.workspace.id,
    );
    directResult = localClaims.map((claim) => {
      const source = session.state.sources.find((item) => item.id === claim.sourceId);
      return {
        claimId: claim.id,
        value: claim.value,
        sourceTitle: source?.title ?? "Unavailable source",
        sourceSpan: claim.sourceSpan,
        sourceHash: source?.sha256 ?? null,
        classification: claim.classification,
      };
    });
  } else if (name === "propose_claim") {
    mutation = proposeClaim(session.state, args);
    directResult = mutation.result;
  } else if (name === "request_approval") {
    // MCP can create an approval request, but the deterministic demo never lets
    // the calling agent impersonate a human approver. Return the pending claims.
    const requested = Array.isArray(args.proposal_ids)
      ? args.proposal_ids.filter((value): value is string => typeof value === "string")
      : [];
    directResult = {
      status: "human_approval_required",
      proposalIds: session.state.claims
        .filter(
          (claim) =>
            claim.lifecycle === "proposed" &&
            claim.workspaceId === session.state.workspace.id &&
            requested.includes(claim.id),
        )
        .map((claim) => claim.id),
      reason: args.reason,
    };
  } else if (name === "record_outcome") {
    mutation = recordOutcome(session.state, {
      runId: args.run_id,
      status: args.status,
      metrics: args.metrics,
      notes: args.notes,
    });
    directResult = mutation.result;
  } else {
    throw new DomainError("METHOD_NOT_FOUND", `Unknown MCP tool: ${name}`, 404);
  }

  let storage: StorageMeta = session.storage;
  if (mutation?.changed) storage = await commitWorkspace(session, mutation.state);
  const payload = {
    ok: true,
    tool: name,
    result: directResult,
    meta: {
      storage: storage.mode,
      workspaceId: session.state.workspace.id,
      authenticatedIdentitySource: "secure HttpOnly browser session",
    },
  };
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

export async function mcp(request: Request): Promise<Response> {
  let rpc: JsonRpcRequest = {};
  let setCookie: string | undefined;
  try {
    const identity = await resolveWorkspaceIdentity(request);
    setCookie = identity.setCookie;
    rpc = (await readPayload(request)) as JsonRpcRequest;
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
      return rpcError(rpc.id, -32600, "Invalid JSON-RPC 2.0 request", undefined, setCookie);
    }
    if (rpc.method === "initialize") {
      return rpcSuccess(rpc.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "commonstate-tano-edition", version: "0.1.0" },
        instructions:
          "Use scoped context packs and claim evidence. Consequential actions are always dry-run and human-approved.",
      }, setCookie);
    }
    if (rpc.method === "notifications/initialized") {
      return new Response(null, { status: 202, headers: { "set-cookie": setCookie } });
    }
    if (rpc.method === "tools/list") return rpcSuccess(rpc.id, { tools: mcpTools }, setCookie);
    if (rpc.method !== "tools/call") {
      return rpcError(rpc.id, -32601, "Method not found", undefined, setCookie);
    }
    const params =
      typeof rpc.params === "object" && rpc.params !== null ? (rpc.params as JsonObject) : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      typeof params.arguments === "object" && params.arguments !== null
        ? (params.arguments as JsonObject)
        : {};
    const session = await openWorkspace(identity.workspaceId);
    const result = await mcpToolCall(session, name, args);
    return rpcSuccess(rpc.id, result, setCookie);
  } catch (error) {
    if (error instanceof DomainError) {
      return rpcError(rpc.id, -32000, error.message, { code: error.code }, setCookie);
    }
    return rpcError(rpc.id, -32603, "Internal MCP error", undefined, setCookie);
  }
}
