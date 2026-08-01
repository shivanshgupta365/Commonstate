import { createHash } from "node:crypto";
import Ajv, { type ValidateFunction } from "ajv";
import { resolveCommandContext } from "./auth";
import { ProductError } from "./errors";
import { productResponse, readJson, type JsonRecord } from "./http";
import {
  executeWorkspaceCommand,
  getActionStatus,
  getClaimEvidence,
  getPendingClaimApprovals,
} from "./repository";

type RpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

const tools = [
  {
    name: "get_context_pack",
    description: "Compile current permission-scoped claims for a task.",
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
    description: "Resolve claim IDs to authorized immutable source spans.",
    inputSchema: {
      type: "object",
      properties: { claim_ids: { type: "array", items: { type: "string" } } },
      required: ["claim_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_claim",
    description: "Propose an evidence-backed claim for human review.",
    inputSchema: {
      type: "object",
      properties: {
        subject_ref: { type: "string" },
        subject_name: { type: "string" },
        subject_type: { type: "string" },
        predicate: { type: "string" },
        value: {},
        source_ref: { type: "string" },
        source_span: { type: "string" },
        scope_id: { type: "string" },
        validity: { type: "object" },
        idempotency_key: { type: "string" },
      },
      required: [
        "subject_ref",
        "predicate",
        "value",
        "source_ref",
        "source_span",
        "validity",
        "idempotency_key",
      ],
      additionalProperties: false,
    },
  },
  {
    name: "request_claim_approval",
    description: "Return pending claim proposals requiring a human decision.",
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
    name: "propose_action",
    description: "Apply deterministic risk policy and propose an action.",
    inputSchema: {
      type: "object",
      properties: {
        action_type: { type: "string" },
        payload: { type: "object" },
        connector_id: { type: "string" },
        context_pack_id: { type: "string" },
        idempotency_key: { type: "string" },
      },
      required: ["action_type", "payload", "idempotency_key"],
      additionalProperties: false,
    },
  },
  {
    name: "request_action_approval",
    description: "Return an action's human-approval requirements without approving it.",
    inputSchema: {
      type: "object",
      properties: { proposal_id: { type: "string" }, reason: { type: "string" } },
      required: ["proposal_id", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "get_action_status",
    description: "Read deterministic policy, approvals, and execution receipt for an action.",
    inputSchema: {
      type: "object",
      properties: { proposal_id: { type: "string" } },
      required: ["proposal_id"],
      additionalProperties: false,
    },
  },
  {
    name: "record_outcome",
    description: "Append an immutable outcome to an agent run.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string" },
        status: { type: "string" },
        metrics: { type: "object", additionalProperties: { type: "number" } },
        notes: { type: "string" },
        idempotency_key: { type: "string" },
      },
      required: ["run_id", "status", "idempotency_key"],
      additionalProperties: false,
    },
  },
] as const;

const toolValidators = (() => {
  const ajv = new Ajv({ allErrors: true, strict: true });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value: string) => {
      const parsed = new Date(value);
      return !Number.isNaN(parsed.getTime()) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
    },
  });
  return new Map<string, ValidateFunction>(
    tools.map((tool) => [
      tool.name,
      ajv.compile(tool.inputSchema as unknown as Record<string, unknown>),
    ]),
  );
})();

function validateToolArguments(name: string, args: JsonRecord): void {
  const validate = toolValidators.get(name);
  if (!validate) throw new ProductError("NOT_FOUND", `Unknown MCP tool: ${name}.`, 404);
  if (!validate(args)) {
    throw new ProductError(
      "VALIDATION_ERROR",
      `Arguments for ${name} do not match its declared input schema.`,
      400,
      {
        errors: (validate.errors ?? []).map((error) => ({
          path: error.instancePath || "/",
          keyword: error.keyword,
          message: error.message,
        })),
      },
    );
  }
}

function success(id: unknown, result: unknown): Response {
  return productResponse({ jsonrpc: "2.0", id: id ?? null, result });
}

function failure(id: unknown, code: number, message: string, data?: unknown): Response {
  return productResponse({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function idempotency(tool: string, rpcId: unknown, args: JsonRecord): string {
  const supplied = args.idempotency_key;
  if (typeof supplied === "string" && supplied.trim()) return supplied.trim().slice(0, 200);
  return `mcp:${tool}:${createHash("sha256")
    .update(JSON.stringify({ rpcId, args }))
    .digest("hex")}`;
}

async function callTool(
  context: Awaited<ReturnType<typeof resolveCommandContext>>,
  rpcId: unknown,
  name: string,
  args: JsonRecord,
): Promise<Record<string, unknown>> {
  if (context.principal.type !== "service_account") {
    throw new ProductError("UNAUTHENTICATED", "MCP requires a service account.", 401);
  }
  if (name === "get_context_pack") {
    return executeWorkspaceCommand(
      context,
      "ask",
      {
        question: typeof args.task === "string" ? args.task : "",
        entityRefs: strings(args.entity_refs),
        asOf: args.as_of,
      },
      idempotency(name, rpcId, args),
    );
  }
  if (name === "get_evidence") {
    return { evidence: await getClaimEvidence(context, strings(args.claim_ids)) };
  }
  if (name === "propose_claim") {
    const validity =
      args.validity && typeof args.validity === "object" ? (args.validity as JsonRecord) : {};
    return executeWorkspaceCommand(
      context,
      "ingest",
      {
        scopeId: args.scope_id,
        source: {
          title:
            typeof args.source_ref === "string" ? `MCP evidence: ${args.source_ref}` : "MCP evidence",
          type: "mcp",
          classification: "private",
          content: typeof args.source_span === "string" ? args.source_span : "",
        },
        claims: [
          {
            subjectId: args.subject_ref,
            subjectName: args.subject_name,
            subjectType: args.subject_type,
            predicate: args.predicate,
            value: args.value,
            sourceSpan: args.source_span,
            validFrom: validity.from,
            validTo: validity.to,
          },
        ],
      },
      idempotency(name, rpcId, args),
    );
  }
  if (name === "request_claim_approval") {
    const result = await getPendingClaimApprovals(context, strings(args.proposal_ids));
    return { ...result, reason: args.reason };
  }
  if (name === "propose_action") {
    return executeWorkspaceCommand(
      context,
      "propose-action",
      {
        actionType: args.action_type,
        payload: args.payload,
        connectorId: args.connector_id,
        contextPackId: args.context_pack_id,
      },
      idempotency(name, rpcId, args),
    );
  }
  if (name === "request_action_approval" || name === "get_action_status") {
    const proposalId = typeof args.proposal_id === "string" ? args.proposal_id : "";
    const status = await getActionStatus(context, proposalId);
    return {
      ...status,
      ...(name === "request_action_approval"
        ? { approvalStatus: "human_approval_required", reason: args.reason }
        : {}),
    };
  }
  if (name === "record_outcome") {
    return executeWorkspaceCommand(
      context,
      "outcome",
      { runId: args.run_id, status: args.status, metrics: args.metrics, notes: args.notes },
      idempotency(name, rpcId, args),
    );
  }
  throw new ProductError("NOT_FOUND", `Unknown MCP tool: ${name}.`, 404);
}

async function mcpContext(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer\s+cs_sa_/i.test(authorization)) {
    throw new ProductError(
      "UNAUTHENTICATED",
      "MCP requires a bearer service-account credential.",
      401,
    );
  }
  const context = await resolveCommandContext(request);
  if (context.principal.type !== "service_account") {
    throw new ProductError("UNAUTHENTICATED", "MCP requires a service account.", 401);
  }
  return context;
}

export async function productMcp(request: Request): Promise<Response> {
  let rpc: RpcRequest = {};
  try {
    rpc = (await readJson(request)) as RpcRequest;
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
      return failure(rpc.id, -32600, "Invalid JSON-RPC 2.0 request");
    }
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    const context = await mcpContext(request);
    if (rpc.method === "initialize") {
      return success(rpc.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "commonstate", version: "1.0.0-private-beta" },
        instructions:
          "Use claim-level evidence and scoped context. Agents may request approval but cannot impersonate human approvers.",
      });
    }
    if (rpc.method === "tools/list") return success(rpc.id, { tools });
    if (rpc.method !== "tools/call") return failure(rpc.id, -32601, "Method not found");
    const params = rpc.params && typeof rpc.params === "object" ? (rpc.params as JsonRecord) : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args =
      params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? (params.arguments as JsonRecord)
        : {};
    validateToolArguments(name, args);
    const result = await callTool(context, rpc.id, name, args);
    return success(rpc.id, {
      content: [{ type: "text", text: JSON.stringify({ ok: true, tool: name, result }) }],
    });
  } catch (error) {
    if (error instanceof ProductError) {
      return failure(rpc.id, -32000, error.message, { code: error.code, details: error.details });
    }
    return failure(rpc.id, -32603, "Internal MCP error");
  }
}
