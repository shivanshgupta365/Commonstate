import { createHash } from "node:crypto";

export type UsageMetric =
  | "api_request"
  | "source_bytes_ingested"
  | "claim_proposal"
  | "context_pack"
  | "model_input_token"
  | "model_output_token"
  | "agent_run"
  | "action_execution"
  | "connector_sync";

export type UsageEvent = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  actorId: string | null;
  metric: UsageMetric;
  quantity: number;
  unit: "count" | "byte" | "token";
  dimensions: Readonly<Record<string, string | number | boolean>>;
  occurredAt: string;
  requestId: string;
}>;

export type UsageAggregate = Readonly<{
  organizationId: string;
  workspaceId: string | null;
  metric: UsageMetric;
  quantity: number;
  periodStart: string;
  periodEnd: string;
}>;

export function validateUsageEvent(event: UsageEvent): void {
  if (!event.id || !event.organizationId || !event.workspaceId || !event.requestId) {
    throw new UsageEventError("INVALID_USAGE_EVENT", "Usage identity fields are required.");
  }
  if (!Number.isFinite(event.quantity) || event.quantity < 0) {
    throw new UsageEventError("INVALID_USAGE_QUANTITY", "Usage quantity must be finite and non-negative.");
  }
  if (!Number.isFinite(Date.parse(event.occurredAt))) {
    throw new UsageEventError("INVALID_USAGE_EVENT", "Usage occurredAt must be an ISO-compatible timestamp.");
  }
  for (const [key, value] of Object.entries(event.dimensions)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      throw new UsageEventError("INVALID_USAGE_DIMENSION", `Invalid usage dimension key: ${key}`);
    }
    if (typeof value === "string" && value.length > 128) {
      throw new UsageEventError("INVALID_USAGE_DIMENSION", `Usage dimension ${key} exceeds 128 characters.`);
    }
  }
}

export class UsageEventError extends Error {
  readonly code: "INVALID_USAGE_EVENT" | "INVALID_USAGE_QUANTITY" | "INVALID_USAGE_DIMENSION";

  constructor(code: "INVALID_USAGE_EVENT" | "INVALID_USAGE_QUANTITY" | "INVALID_USAGE_DIMENSION", message: string) {
    super(message);
    this.name = "UsageEventError";
    this.code = code;
  }
}

export function aggregateUsage(input: {
  events: readonly UsageEvent[];
  organizationId: string;
  workspaceId?: string;
  periodStart: string;
  periodEnd: string;
}): readonly UsageAggregate[] {
  const start = Date.parse(input.periodStart);
  const end = Date.parse(input.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new RangeError("Usage aggregation requires a valid half-open time interval.");
  }
  const totals = new Map<UsageMetric, number>();
  for (const event of input.events) {
    validateUsageEvent(event);
    const occurred = Date.parse(event.occurredAt);
    if (
      event.organizationId === input.organizationId &&
      (!input.workspaceId || event.workspaceId === input.workspaceId) &&
      occurred >= start &&
      occurred < end
    ) {
      totals.set(event.metric, (totals.get(event.metric) ?? 0) + event.quantity);
    }
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([metric, quantity]) => ({
      organizationId: input.organizationId,
      workspaceId: input.workspaceId ?? null,
      metric,
      quantity,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
    }));
}

export type AuditPrincipal = Readonly<{
  type: "user" | "service_account" | "system";
  principalId: string;
  actorId: string;
}>;

export type AuditEventInput = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  sequence: number;
  principal: AuditPrincipal;
  requestId: string;
  action: string;
  targetType: string;
  targetId: string;
  policyDecision: "allowed" | "denied" | "not_applicable";
  beforeHash: string | null;
  afterHash: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  occurredAt: string;
}>;

export type AuditEvent = AuditEventInput & Readonly<{
  previousEventHash: string | null;
  eventHash: string;
}>;

export type AuditEventProjection = Readonly<{
  id: string;
  organizationId: string;
  workspaceId: string;
  sequence: number;
  principalType: AuditPrincipal["type"];
  actorId: string;
  requestId: string;
  action: string;
  targetType: string;
  targetId: string;
  policyDecision: AuditEventInput["policyDecision"];
  occurredAt: string;
  eventHash: string;
}>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function hashAuditPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function createAuditEvent(previous: AuditEvent | null, input: AuditEventInput): AuditEvent {
  if (input.sequence < 1 || !Number.isInteger(input.sequence)) {
    throw new AuditLedgerError("AUDIT_SEQUENCE_INVALID", "Audit sequence must be a positive integer.");
  }
  if (previous) {
    if (previous.organizationId !== input.organizationId || previous.workspaceId !== input.workspaceId) {
      throw new AuditLedgerError("AUDIT_TENANT_MISMATCH", "Audit chains cannot cross organization or workspace boundaries.");
    }
    if (input.sequence !== previous.sequence + 1) {
      throw new AuditLedgerError("AUDIT_SEQUENCE_INVALID", "Audit sequence must advance exactly once.");
    }
  } else if (input.sequence !== 1) {
    throw new AuditLedgerError("AUDIT_SEQUENCE_INVALID", "The first audit event must have sequence 1.");
  }
  const previousEventHash = previous?.eventHash ?? null;
  const eventHash = hashAuditPayload({ ...input, previousEventHash });
  return Object.freeze({ ...structuredClone(input), previousEventHash, eventHash });
}

export function verifyAuditChain(events: readonly AuditEvent[]): Readonly<{
  valid: boolean;
  invalidEventId: string | null;
}> {
  let previous: AuditEvent | null = null;
  for (const event of events) {
    try {
      const expected = createAuditEvent(previous, {
        id: event.id,
        organizationId: event.organizationId,
        workspaceId: event.workspaceId,
        sequence: event.sequence,
        principal: event.principal,
        requestId: event.requestId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        policyDecision: event.policyDecision,
        beforeHash: event.beforeHash,
        afterHash: event.afterHash,
        metadata: event.metadata,
        occurredAt: event.occurredAt,
      });
      if (expected.previousEventHash !== event.previousEventHash || expected.eventHash !== event.eventHash) {
        return { valid: false, invalidEventId: event.id };
      }
    } catch {
      return { valid: false, invalidEventId: event.id };
    }
    previous = event;
  }
  return { valid: true, invalidEventId: null };
}

export function projectAuditEvent(event: AuditEvent): AuditEventProjection {
  return Object.freeze({
    id: event.id,
    organizationId: event.organizationId,
    workspaceId: event.workspaceId,
    sequence: event.sequence,
    principalType: event.principal.type,
    actorId: event.principal.actorId,
    requestId: event.requestId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    policyDecision: event.policyDecision,
    occurredAt: event.occurredAt,
    eventHash: event.eventHash,
  });
}

export class AuditLedgerError extends Error {
  readonly code: "AUDIT_SEQUENCE_INVALID" | "AUDIT_TENANT_MISMATCH";

  constructor(code: "AUDIT_SEQUENCE_INVALID" | "AUDIT_TENANT_MISMATCH", message: string) {
    super(message);
    this.name = "AuditLedgerError";
    this.code = code;
  }
}

export type RetentionPolicy = Readonly<{
  sourceBodyDays: number;
  runEventDays: number;
  auditEventDays: number | null;
  legalHold: boolean;
}>;

export function retentionDisposition(input: {
  recordType: "source_body" | "run_event" | "audit_event";
  createdAt: string;
  now: string;
  policy: RetentionPolicy;
}): "retain" | "delete" {
  if (input.policy.legalHold) return "retain";
  const days = input.recordType === "source_body"
    ? input.policy.sourceBodyDays
    : input.recordType === "run_event"
      ? input.policy.runEventDays
      : input.policy.auditEventDays;
  if (days === null) return "retain";
  const ageMs = Date.parse(input.now) - Date.parse(input.createdAt);
  if (!Number.isFinite(ageMs) || days < 0) throw new RangeError("Retention inputs are invalid.");
  return ageMs >= days * 24 * 60 * 60 * 1000 ? "delete" : "retain";
}
