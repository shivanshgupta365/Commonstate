import { createHash } from "node:crypto";

export type ActionRisk = "low" | "medium" | "high" | "critical";
export type ActionPolicyErrorCode =
  | "ACTION_DISALLOWED"
  | "APPROVAL_REQUIRED"
  | "REAUTHENTICATION_REQUIRED"
  | "ACTION_PREFLIGHT_FAILED"
  | "ACTION_EXECUTION_DISABLED";

export type ActionProposal = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  scopeId: string;
  actionKind: string;
  connectorId: string | null;
  requestedRisk: ActionRisk;
  reversible: boolean;
  externalSideEffect: boolean;
  proposedByActorId: string;
  proposedAt: string;
  idempotencyKey: string;
  input: Readonly<Record<string, unknown>>;
  evidenceClaimIds: readonly string[];
}>;

export type ActionApproval = Readonly<{
  id: string;
  actionId: string;
  actorId: string;
  decision: "approved" | "rejected";
  authorized: boolean;
  reason: string;
  createdAt: string;
}>;

export type ActionActorContext = Readonly<{
  actorId: string;
  permissions: readonly string[];
  authenticatedAt: string;
}>;

export type WorkspaceExecutionPolicy = Readonly<{
  killSwitchEnabled: boolean;
  disabledConnectorIds: readonly string[];
  allowedActionKinds: readonly string[];
  privateBeta: boolean;
  reauthenticationMaxAgeSeconds: number;
}>;

export type ActionRequirements = Readonly<{
  approvals: number;
  recentReauthentication: boolean;
  preflight: boolean;
  explicitExecution: boolean;
}>;

export type ActionPolicyDecision = Readonly<{
  risk: ActionRisk;
  state: "auto_execute" | "needs_approval" | "ready" | "blocked";
  allowed: boolean;
  reasons: readonly string[];
  requirements: ActionRequirements;
  acceptedApprovalIds: readonly string[];
}>;

const RISK_RANK: Readonly<Record<ActionRisk, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const CRITICAL_ACTION_KINDS = new Set([
  "payment",
  "payment.execute",
  "contract.change",
  "access.change",
  "source.destructive_delete",
  "message.send_external",
]);

const REQUIREMENTS: Readonly<Record<ActionRisk, ActionRequirements>> = Object.freeze({
  low: { approvals: 0, recentReauthentication: false, preflight: false, explicitExecution: false },
  medium: { approvals: 1, recentReauthentication: false, preflight: true, explicitExecution: false },
  high: { approvals: 2, recentReauthentication: true, preflight: true, explicitExecution: true },
  critical: { approvals: 0, recentReauthentication: true, preflight: true, explicitExecution: true },
});

function maxRisk(left: ActionRisk, right: ActionRisk): ActionRisk {
  return RISK_RANK[left] >= RISK_RANK[right] ? left : right;
}

export function classifyActionRisk(action: ActionProposal): ActionRisk {
  if (CRITICAL_ACTION_KINDS.has(action.actionKind)) return "critical";
  let deterministicFloor: ActionRisk = action.reversible && !action.externalSideEffect ? "low" : "medium";
  if (action.externalSideEffect) deterministicFloor = "high";
  return maxRisk(action.requestedRisk, deterministicFloor);
}

function acceptedApprovals(action: ActionProposal, approvals: readonly ActionApproval[]): readonly ActionApproval[] {
  const acceptedByActor = new Map<string, ActionApproval>();
  for (const approval of approvals) {
    if (
      approval.actionId === action.id &&
      approval.authorized &&
      approval.decision === "approved" &&
      approval.actorId !== action.proposedByActorId
    ) {
      acceptedByActor.set(approval.actorId, approval);
    }
  }
  return [...acceptedByActor.values()].sort((left, right) => left.actorId.localeCompare(right.actorId));
}

export function decideActionPolicy(input: {
  action: ActionProposal;
  policy: WorkspaceExecutionPolicy;
  approvals: readonly ActionApproval[];
  executor: ActionActorContext;
  now: string;
  explicitExecutionConfirmed: boolean;
}): ActionPolicyDecision {
  const risk = classifyActionRisk(input.action);
  const requirements = REQUIREMENTS[risk];
  const accepted = acceptedApprovals(input.action, input.approvals);
  const reasons: string[] = [];

  if (input.policy.killSwitchEnabled) reasons.push("The workspace execution kill switch is enabled.");
  if (input.action.connectorId && input.policy.disabledConnectorIds.includes(input.action.connectorId)) {
    reasons.push(`Execution is disabled for connector ${input.action.connectorId}.`);
  }
  if (!input.policy.allowedActionKinds.includes(input.action.actionKind)) {
    reasons.push(`Action kind ${input.action.actionKind} is not allowlisted.`);
  }
  if (!input.executor.permissions.includes("actions.execute")) {
    reasons.push("The executing actor does not have actions.execute permission.");
  }
  if (risk === "critical") {
    reasons.push(input.policy.privateBeta
      ? "Critical actions are blocked during private beta."
      : "Critical actions are blocked by the Commonstate safety baseline.");
  }

  const authenticatedAt = Date.parse(input.executor.authenticatedAt);
  const now = Date.parse(input.now);
  const reauthenticationCurrent = Number.isFinite(authenticatedAt) && Number.isFinite(now) &&
    now - authenticatedAt <= input.policy.reauthenticationMaxAgeSeconds * 1000;
  if (requirements.recentReauthentication && !reauthenticationCurrent) {
    reasons.push("Recent reauthentication is required.");
  }
  if (requirements.explicitExecution && !input.explicitExecutionConfirmed) {
    reasons.push("Explicit execution confirmation is required.");
  }

  const hardBlock = reasons.length > 0;
  if (hardBlock) {
    return {
      risk,
      state: "blocked",
      allowed: false,
      reasons,
      requirements,
      acceptedApprovalIds: accepted.map((approval) => approval.id),
    };
  }
  if (accepted.length < requirements.approvals) {
    return {
      risk,
      state: "needs_approval",
      allowed: false,
      reasons: [`${requirements.approvals - accepted.length} additional authorized approval${requirements.approvals - accepted.length === 1 ? " is" : "s are"} required.`],
      requirements,
      acceptedApprovalIds: accepted.map((approval) => approval.id),
    };
  }
  return {
    risk,
    state: risk === "low" ? "auto_execute" : "ready",
    allowed: true,
    reasons: [],
    requirements,
    acceptedApprovalIds: accepted.map((approval) => approval.id),
  };
}

export class ActionPolicyError extends Error {
  readonly code: ActionPolicyErrorCode;
  readonly decision: ActionPolicyDecision;

  constructor(code: ActionPolicyErrorCode, message: string, decision: ActionPolicyDecision) {
    super(message);
    this.name = "ActionPolicyError";
    this.code = code;
    this.decision = decision;
  }
}

export type ActionPreflight = Readonly<{
  allowed: boolean;
  reason: string | null;
  providerReference: string | null;
  checkedAt: string;
}>;

export interface ActionExecutor {
  preflight(action: ActionProposal): Promise<ActionPreflight>;
  execute(action: ActionProposal): Promise<Readonly<{ providerReference: string | null; output: Readonly<Record<string, unknown>> }>>;
  compensate?(action: ActionProposal, output: Readonly<Record<string, unknown>> | null): Promise<void>;
}

export type ActionReceipt = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  actionId: string;
  idempotencyKey: string;
  status: "succeeded" | "failed" | "compensated" | "compensation_failed";
  risk: ActionRisk;
  executorActorId: string;
  approvalIds: readonly string[];
  evidenceClaimIds: readonly string[];
  policyDecision: ActionPolicyDecision;
  preflight: ActionPreflight | null;
  providerReference: string | null;
  output: Readonly<Record<string, unknown>> | null;
  error: string | null;
  compensationStatus: "not_required" | "not_available" | "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  receiptHash: string;
}>;

export interface ActionReceiptStore {
  get(workspaceId: string, idempotencyKey: string): Promise<ActionReceipt | null>;
  putIfAbsent(receipt: ActionReceipt): Promise<ActionReceipt>;
}

export class InMemoryActionReceiptStore implements ActionReceiptStore {
  readonly #receipts = new Map<string, ActionReceipt>();

  async get(workspaceId: string, idempotencyKey: string): Promise<ActionReceipt | null> {
    return this.#receipts.get(`${workspaceId}:${idempotencyKey}`) ?? null;
  }

  async putIfAbsent(receipt: ActionReceipt): Promise<ActionReceipt> {
    const key = `${receipt.workspaceId}:${receipt.idempotencyKey}`;
    const current = this.#receipts.get(key);
    if (current) return current;
    this.#receipts.set(key, Object.freeze(structuredClone(receipt)));
    return this.#receipts.get(key) ?? receipt;
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function hashActionReceipt(receipt: Omit<ActionReceipt, "receiptHash">): string {
  return createHash("sha256").update(JSON.stringify(stable(receipt))).digest("hex");
}

export class ActionExecutionCoordinator {
  readonly #store: ActionReceiptStore;
  readonly #inflight = new Map<string, Promise<ActionReceipt>>();

  constructor(store: ActionReceiptStore) {
    this.#store = store;
  }

  async execute(input: {
    action: ActionProposal;
    policy: WorkspaceExecutionPolicy;
    approvals: readonly ActionApproval[];
    executorActor: ActionActorContext;
    adapter: ActionExecutor;
    now: string;
    explicitExecutionConfirmed: boolean;
  }): Promise<ActionReceipt> {
    const key = `${input.action.workspaceId}:${input.action.idempotencyKey}`;
    const previous = await this.#store.get(input.action.workspaceId, input.action.idempotencyKey);
    if (previous) return previous;
    const inflight = this.#inflight.get(key);
    if (inflight) return inflight;
    const execution = this.#executeOnce(input).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, execution);
    return execution;
  }

  async #executeOnce(input: {
    action: ActionProposal;
    policy: WorkspaceExecutionPolicy;
    approvals: readonly ActionApproval[];
    executorActor: ActionActorContext;
    adapter: ActionExecutor;
    now: string;
    explicitExecutionConfirmed: boolean;
  }): Promise<ActionReceipt> {
    const key = `${input.action.workspaceId}:${input.action.idempotencyKey}`;
    const decision = decideActionPolicy({
      action: input.action,
      policy: input.policy,
      approvals: input.approvals,
      executor: input.executorActor,
      now: input.now,
      explicitExecutionConfirmed: input.explicitExecutionConfirmed,
    });
    if (!decision.allowed) {
      const code: ActionPolicyErrorCode = decision.state === "needs_approval"
        ? "APPROVAL_REQUIRED"
        : decision.reasons.some((reason) => reason.includes("reauthentication"))
          ? "REAUTHENTICATION_REQUIRED"
          : "ACTION_DISALLOWED";
      throw new ActionPolicyError(code, decision.reasons.join(" "), decision);
    }

    const startedAt = input.now;
    let preflight: ActionPreflight | null = null;
    if (decision.requirements.preflight) {
      preflight = await input.adapter.preflight(input.action);
      if (!preflight.allowed) {
        throw new ActionPolicyError(
          "ACTION_PREFLIGHT_FAILED",
          preflight.reason ?? "The action preflight failed.",
          { ...decision, allowed: false, state: "blocked", reasons: [preflight.reason ?? "The action preflight failed."] },
        );
      }
    }

    let status: ActionReceipt["status"] = "succeeded";
    let output: Readonly<Record<string, unknown>> | null = null;
    let providerReference: string | null = preflight?.providerReference ?? null;
    let errorMessage: string | null = null;
    let compensationStatus: ActionReceipt["compensationStatus"] = "not_required";
    try {
      const result = await input.adapter.execute(input.action);
      output = result.output;
      providerReference = result.providerReference ?? providerReference;
    } catch (error) {
      status = "failed";
      errorMessage = error instanceof Error ? error.message : "Unknown action execution failure";
      if (input.action.reversible && input.adapter.compensate) {
        try {
          await input.adapter.compensate(input.action, output);
          status = "compensated";
          compensationStatus = "succeeded";
        } catch {
          status = "compensation_failed";
          compensationStatus = "failed";
        }
      } else if (input.action.reversible) {
        compensationStatus = "not_available";
      }
    }

    const completedAt = input.now;
    const unsigned: Omit<ActionReceipt, "receiptHash"> = {
      id: `action-receipt:${createHash("sha256").update(`${key}:${startedAt}`).digest("hex").slice(0, 24)}`,
      organizationId: input.action.organizationId,
      workspaceId: input.action.workspaceId,
      actionId: input.action.id,
      idempotencyKey: input.action.idempotencyKey,
      status,
      risk: decision.risk,
      executorActorId: input.executorActor.actorId,
      approvalIds: decision.acceptedApprovalIds,
      evidenceClaimIds: [...input.action.evidenceClaimIds].sort(),
      policyDecision: decision,
      preflight,
      providerReference,
      output,
      error: errorMessage,
      compensationStatus,
      startedAt,
      completedAt,
    };
    return this.#store.putIfAbsent(Object.freeze({ ...unsigned, receiptHash: hashActionReceipt(unsigned) }));
  }
}
