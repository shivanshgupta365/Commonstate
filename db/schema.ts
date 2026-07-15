import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
};

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    edition: text("edition").notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)],
);

export const scopes = sqliteTable(
  "scopes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentScopeId: text("parent_scope_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    externalRef: text("external_ref"),
    ...timestamps,
  },
  (table) => [
    index("scopes_workspace_kind_idx").on(table.workspaceId, table.kind),
  ],
);

export const actors = sqliteTable(
  "actors",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    role: text("role").notNull(),
    permissions: text("permissions", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    writeBudget: integer("write_budget").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [index("actors_workspace_type_idx").on(table.workspaceId, table.actorType)],
);

export const sources = sqliteTable(
  "sources",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceKey: text("source_key").notNull(),
    sourceType: text("source_type").notNull(),
    title: text("title").notNull(),
    uri: text("uri"),
    classification: text("classification").notNull(),
    immutable: integer("immutable", { mode: "boolean" }).notNull().default(true),
    sha256: text("sha256").notNull(),
    capturedAt: text("captured_at").notNull(),
    contentText: text("content_text").notNull(),
    metadata: text("metadata", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sources_workspace_key_unique").on(table.workspaceId, table.sourceKey),
    index("sources_workspace_class_idx").on(table.workspaceId, table.classification),
  ],
);

export const sourceEvents = sqliteTable(
  "source_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceHash: text("source_hash").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("source_events_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("source_events_workspace_source_idx").on(table.workspaceId, table.sourceId),
  ],
);

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopeId: text("scope_id").references(() => scopes.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    externalRef: text("external_ref"),
    attributes: text("attributes", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("entities_workspace_type_idx").on(table.workspaceId, table.entityType),
  ],
);

export const relationships = sqliteTable(
  "relationships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fromEntityId: text("from_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    toEntityId: text("to_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    relationshipType: text("relationship_type").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    attributes: text("attributes", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("relationships_workspace_from_idx").on(table.workspaceId, table.fromEntityId),
    index("relationships_workspace_to_idx").on(table.workspaceId, table.toEntityId),
  ],
);

export const claims = sqliteTable(
  "claims",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopeId: text("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    subjectEntityId: text("subject_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    predicate: text("predicate").notNull(),
    value: text("value", { mode: "json" }).$type<unknown>().notNull(),
    valueType: text("value_type").notNull(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    sourceEventId: text("source_event_id").references(() => sourceEvents.id, {
      onDelete: "set null",
    }),
    sourceSpan: text("source_span").notNull(),
    authorActorId: text("author_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "restrict" }),
    observedAt: text("observed_at").notNull(),
    validFrom: text("valid_from").notNull(),
    validTo: text("valid_to"),
    confidence: integer("confidence").notNull(),
    authority: text("authority").notNull(),
    lifecycle: text("lifecycle").notNull(),
    supersedesClaimId: text("supersedes_claim_id"),
    classification: text("classification").notNull(),
    freshnessSeconds: integer("freshness_seconds").notNull(),
    acl: text("acl", { mode: "json" }).$type<string[]>().notNull(),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index("claims_workspace_lifecycle_idx").on(table.workspaceId, table.lifecycle),
    index("claims_workspace_subject_predicate_idx").on(
      table.workspaceId,
      table.subjectEntityId,
      table.predicate,
    ),
    index("claims_workspace_scope_validity_idx").on(
      table.workspaceId,
      table.scopeId,
      table.validFrom,
      table.validTo,
    ),
  ],
);

export const memoryEvents = sqliteTable(
  "memory_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    summary: text("summary").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("memory_events_workspace_sequence_unique").on(
      table.workspaceId,
      table.sequence,
    ),
  ],
);

export const conflicts = sqliteTable(
  "conflicts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopeId: text("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    subjectEntityId: text("subject_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    predicate: text("predicate").notNull(),
    leftClaimId: text("left_claim_id").notNull(),
    rightClaimId: text("right_claim_id").notNull(),
    risk: text("risk").notNull(),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    detectedAt: text("detected_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolutionClaimId: text("resolution_claim_id"),
    ...timestamps,
  },
  (table) => [
    index("conflicts_workspace_status_risk_idx").on(
      table.workspaceId,
      table.status,
      table.risk,
    ),
  ],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "restrict" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    previousLifecycle: text("previous_lifecycle").notNull(),
    resultingLifecycle: text("resulting_lifecycle").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("approvals_workspace_claim_idx").on(table.workspaceId, table.claimId)],
);

export const contextPacks = sqliteTable(
  "context_packs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scopeId: text("scope_id")
      .notNull()
      .references(() => scopes.id, { onDelete: "cascade" }),
    task: text("task").notNull(),
    entityRefs: text("entity_refs", { mode: "json" }).$type<string[]>().notNull(),
    asOf: text("as_of").notNull(),
    versionHash: text("version_hash").notNull(),
    facts: text("facts", { mode: "json" })
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    constraints: text("constraints", { mode: "json" }).$type<string[]>().notNull(),
    blockers: text("blockers", { mode: "json" }).$type<string[]>().notNull(),
    citations: text("citations", { mode: "json" })
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    freshnessStatus: text("freshness_status").notNull(),
    createdAt: text("created_at").notNull(),
    invalidatedAt: text("invalidated_at"),
  },
  (table) => [
    uniqueIndex("context_packs_workspace_version_unique").on(
      table.workspaceId,
      table.versionHash,
    ),
  ],
);

export const contextPackEvidence = sqliteTable(
  "context_pack_evidence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    contextPackId: text("context_pack_id")
      .notNull()
      .references(() => contextPacks.id, { onDelete: "cascade" }),
    claimId: text("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "restrict" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    sourceSpan: text("source_span").notNull(),
    ordinal: integer("ordinal").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("context_pack_evidence_unique").on(
      table.contextPackId,
      table.claimId,
    ),
  ],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agentActorId: text("agent_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "restrict" }),
    task: text("task").notNull(),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    contextPackId: text("context_pack_id")
      .notNull()
      .references(() => contextPacks.id, { onDelete: "restrict" }),
    contextVersionHash: text("context_version_hash").notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    tools: text("tools", { mode: "json" }).$type<string[]>().notNull(),
    decision: text("decision", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    approvalIds: text("approval_ids", { mode: "json" }).$type<string[]>().notNull(),
    latencyMs: integer("latency_ms").notNull(),
    tokenUsage: integer("token_usage").notNull(),
    costMicros: integer("cost_micros").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull(),
    receiptHash: text("receipt_hash").notNull(),
    replayOfRunId: text("replay_of_run_id"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("agent_runs_workspace_receipt_unique").on(
      table.workspaceId,
      table.receiptHash,
    ),
    index("agent_runs_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payload: text("payload", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("run_events_run_sequence_unique").on(table.runId, table.sequence),
  ],
);

export const outcomes = sqliteTable(
  "outcomes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    metrics: text("metrics", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull(),
    notes: text("notes").notNull(),
    learningClaimId: text("learning_claim_id"),
    recordedByActorId: text("recorded_by_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "restrict" }),
    receiptHash: text("receipt_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("outcomes_workspace_receipt_unique").on(
      table.workspaceId,
      table.receiptHash,
    ),
  ],
);

export const evaluationResults = sqliteTable(
  "evaluation_results",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    suite: text("suite").notNull(),
    category: text("category").notNull(),
    caseName: text("case_name").notNull(),
    passed: integer("passed", { mode: "boolean" }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    details: text("details", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    runAt: text("run_at").notNull(),
  },
  (table) => [
    index("evaluation_results_workspace_suite_idx").on(
      table.workspaceId,
      table.suite,
    ),
  ],
);
