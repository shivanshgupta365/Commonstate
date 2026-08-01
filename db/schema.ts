import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
};

export const organizations = pgTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    deploymentMode: text("deployment_mode").notNull().default("shared"),
    status: text("status").notNull().default("active"),
    billingMode: text("billing_mode").notNull().default("manual_pilot"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_slug_unique").on(table.slug)],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .default("org_legacy_demo")
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    edition: text("edition").notNull(),
    kind: text("kind").notNull().default("demo"),
    status: text("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("workspaces_slug_unique").on(table.slug),
    index("workspaces_organization_status_idx").on(table.organizationId, table.status),
  ],
);

export const scopes = pgTable(
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

export const actors = pgTable(
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
    permissions: jsonb("permissions")
      .$type<string[]>()
      .notNull(),
    writeBudget: integer("write_budget").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [index("actors_workspace_type_idx").on(table.workspaceId, table.actorType)],
);

export const sources = pgTable(
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
    immutable: boolean("immutable").notNull().default(true),
    sha256: text("sha256").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "string" }).notNull(),
    contentText: text("content_text").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("sources_workspace_key_unique").on(table.workspaceId, table.sourceKey),
    index("sources_workspace_class_idx").on(table.workspaceId, table.classification),
  ],
);

export const sourceEvents = pgTable(
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
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("source_events_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("source_events_workspace_source_idx").on(table.workspaceId, table.sourceId),
  ],
);

export const entities = pgTable(
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
    attributes: jsonb("attributes")
      .$type<Record<string, unknown>>()
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("entities_workspace_type_idx").on(table.workspaceId, table.entityType),
  ],
);

export const relationships = pgTable(
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
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "string" }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true, mode: "string" }),
    attributes: jsonb("attributes")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("relationships_workspace_from_idx").on(table.workspaceId, table.fromEntityId),
    index("relationships_workspace_to_idx").on(table.workspaceId, table.toEntityId),
  ],
);

export const claims = pgTable(
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
    value: jsonb("value").$type<unknown>().notNull(),
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
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "string" }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true, mode: "string" }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true, mode: "string" }),
    confidence: integer("confidence").notNull(),
    authority: text("authority").notNull(),
    lifecycle: text("lifecycle").notNull(),
    supersedesClaimId: text("supersedes_claim_id"),
    classification: text("classification").notNull(),
    freshnessSeconds: integer("freshness_seconds").notNull(),
    acl: jsonb("acl").$type<string[]>().notNull(),
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

export const memoryEvents = pgTable(
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
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("memory_events_workspace_sequence_unique").on(
      table.workspaceId,
      table.sequence,
    ),
  ],
);

export const conflicts = pgTable(
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
    detectedAt: timestamp("detected_at", { withTimezone: true, mode: "string" }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
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

export const approvals = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [index("approvals_workspace_claim_idx").on(table.workspaceId, table.claimId)],
);

export const contextPacks = pgTable(
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
    entityRefs: jsonb("entity_refs").$type<string[]>().notNull(),
    asOf: timestamp("as_of", { withTimezone: true, mode: "string" }).notNull(),
    versionHash: text("version_hash").notNull(),
    facts: jsonb("facts")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    constraints: jsonb("constraints").$type<string[]>().notNull(),
    blockers: jsonb("blockers").$type<string[]>().notNull(),
    citations: jsonb("citations")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    freshnessStatus: text("freshness_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    uniqueIndex("context_packs_workspace_version_unique").on(
      table.workspaceId,
      table.versionHash,
    ),
  ],
);

export const contextPackEvidence = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("context_pack_evidence_unique").on(
      table.contextPackId,
      table.claimId,
    ),
  ],
);

export const agentRuns = pgTable(
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
    tools: jsonb("tools").$type<string[]>().notNull(),
    decision: jsonb("decision")
      .$type<Record<string, unknown>>()
      .notNull(),
    approvalIds: jsonb("approval_ids").$type<string[]>().notNull(),
    latencyMs: integer("latency_ms").notNull(),
    tokenUsage: integer("token_usage").notNull(),
    costMicros: integer("cost_micros").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }).notNull(),
    receiptHash: text("receipt_hash").notNull(),
    replayOfRunId: text("replay_of_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("agent_runs_workspace_receipt_unique").on(
      table.workspaceId,
      table.receiptHash,
    ),
    index("agent_runs_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const runEvents = pgTable(
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
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("run_events_run_sequence_unique").on(table.runId, table.sequence),
  ],
);

export const outcomes = pgTable(
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
    metrics: jsonb("metrics")
      .$type<Record<string, number>>()
      .notNull(),
    notes: text("notes").notNull(),
    learningClaimId: text("learning_claim_id"),
    recordedByActorId: text("recorded_by_actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "restrict" }),
    receiptHash: text("receipt_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    uniqueIndex("outcomes_workspace_receipt_unique").on(
      table.workspaceId,
      table.receiptHash,
    ),
  ],
);

export const evaluationResults = pgTable(
  "evaluation_results",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    suite: text("suite").notNull(),
    category: text("category").notNull(),
    caseName: text("case_name").notNull(),
    passed: boolean("passed").notNull(),
    durationMs: integer("duration_ms").notNull(),
    details: jsonb("details")
      .$type<Record<string, unknown>>()
      .notNull(),
    runAt: timestamp("run_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("evaluation_results_workspace_suite_idx").on(
      table.workspaceId,
      table.suite,
    ),
  ],
);

// Multi-company product tables are additive. The original tables above remain
// the stable public demo contract while these records power authenticated
// production workspaces.
export const profiles = pgTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    status: text("status").notNull().default("active"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("profiles_email_unique").on(table.email)],
);

export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    roleKey: text("role_key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    system: boolean("system").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("roles_org_workspace_key_unique").on(
      table.organizationId,
      table.workspaceId,
      table.roleKey,
    ),
    index("roles_organization_idx").on(table.organizationId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("active"),
    provisionedBy: text("provisioned_by").notNull().default("commonstate"),
    externalRef: text("external_ref"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("memberships_workspace_profile_unique").on(
      table.workspaceId,
      table.profileId,
    ),
    index("memberships_profile_status_idx").on(table.profileId, table.status),
    index("memberships_organization_status_idx").on(table.organizationId, table.status),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"),
    invitedByProfileId: text("invited_by_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_workspace_email_idx").on(table.workspaceId, table.email),
  ],
);

export const scopeGrants = pgTable(
  "scope_grants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    scopeId: text("scope_id").references(() => scopes.id, { onDelete: "cascade" }),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    constraints: jsonb("constraints").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("scope_grants_principal_idx").on(
      table.workspaceId,
      table.principalType,
      table.principalId,
    ),
  ],
);

export const serviceAccounts = pgTable(
  "service_accounts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    roleId: text("role_id").references(() => roles.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull(),
    allowedScopeIds: jsonb("allowed_scope_ids").$type<string[]>().notNull(),
    active: boolean("active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "string" }),
    rotatedFromId: text("rotated_from_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("service_accounts_key_prefix_unique").on(table.keyPrefix),
    index("service_accounts_workspace_active_idx").on(table.workspaceId, table.active),
  ],
);

export const solutionTemplates = pgTable(
  "solution_templates",
  {
    id: text("id").primaryKey(),
    templateKey: text("template_key").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull(),
    evalDefinition: jsonb("eval_definition")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("solution_templates_key_version_unique").on(
      table.templateKey,
      table.version,
    ),
  ],
);

export const workspaceProfiles = pgTable(
  "workspace_profiles",
  {
    workspaceId: text("workspace_id")
      .primaryKey()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    templateKey: text("template_key").notNull(),
    setupStatus: text("setup_status").notNull().default("draft"),
    logoUrl: text("logo_url"),
    accentColor: text("accent_color").notNull().default("#7357FF"),
    locale: text("locale").notNull().default("en-GB"),
    timezone: text("timezone").notNull().default("UTC"),
    currency: text("currency").notNull().default("USD"),
    terminology: jsonb("terminology").$type<Record<string, string>>().notNull().default({}),
    enabledSurfaces: jsonb("enabled_surfaces").$type<string[]>().notNull(),
    draftConfiguration: jsonb("draft_configuration")
      .$type<Record<string, unknown>>()
      .notNull(),
    publishedConfigurationVersion: integer("published_configuration_version"),
    killSwitchEnabled: boolean("kill_switch_enabled").notNull().default(false),
    ...timestamps,
  },
  (table) => [index("workspace_profiles_org_idx").on(table.organizationId)],
);

export const workspaceConfigurationVersions = pgTable(
  "workspace_configuration_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("published"),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version").notNull(),
    ontology: jsonb("ontology").$type<Record<string, unknown>>().notNull(),
    policy: jsonb("policy").$type<Record<string, unknown>>().notNull(),
    branding: jsonb("branding").$type<Record<string, unknown>>().notNull(),
    agents: jsonb("agents").$type<Array<Record<string, unknown>>>().notNull(),
    outcomes: jsonb("outcomes").$type<Array<Record<string, unknown>>>().notNull(),
    configHash: text("config_hash").notNull(),
    createdByPrincipalId: text("created_by_principal_id").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_config_workspace_version_unique").on(
      table.workspaceId,
      table.version,
    ),
    uniqueIndex("workspace_config_workspace_hash_unique").on(
      table.workspaceId,
      table.configHash,
    ),
  ],
);

export const connectors = pgTable(
  "connectors",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectorType: text("connector_type").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("disconnected"),
    externalTenantRef: text("external_tenant_ref"),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    encryptedCredentialRef: text("encrypted_credential_ref"),
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default({}),
    sourceAclMode: text("source_acl_mode").notNull().default("mirror"),
    executionEnabled: boolean("execution_enabled").notNull().default(false),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("connectors_workspace_type_name_unique").on(
      table.workspaceId,
      table.connectorType,
      table.name,
    ),
    index("connectors_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const providerConfigurations = pgTable(
  "provider_configurations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    credentialMode: text("credential_mode").notNull().default("managed"),
    encryptedCredentialRef: text("encrypted_credential_ref"),
    model: text("model").notNull(),
    fallbackOrder: integer("fallback_order").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("provider_config_workspace_provider_unique").on(
      table.workspaceId,
      table.provider,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobType: text("job_type").notNull(),
    status: text("status").notNull().default("queued"),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: timestamp("run_after", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "string" }),
    lockedBy: text("locked_by"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("jobs_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("jobs_status_run_after_idx").on(table.status, table.runAfter),
  ],
);

export const actionProposals = pgTable(
  "action_proposals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    proposedByPrincipalType: text("proposed_by_principal_type").notNull(),
    proposedByPrincipalId: text("proposed_by_principal_id").notNull(),
    connectorId: text("connector_id").references(() => connectors.id, {
      onDelete: "set null",
    }),
    actionType: text("action_type").notNull(),
    riskTier: text("risk_tier").notNull(),
    status: text("status").notNull().default("proposed"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    contextPackId: text("context_pack_id").references(() => contextPacks.id, {
      onDelete: "restrict",
    }),
    ontologyVersion: integer("ontology_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    policyDecision: jsonb("policy_decision").$type<Record<string, unknown>>().notNull(),
    requiredApprovals: integer("required_approvals").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("action_proposals_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("action_proposals_workspace_status_idx").on(table.workspaceId, table.status),
  ],
);

export const actionApprovals = pgTable(
  "action_approvals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actionProposalId: text("action_proposal_id")
      .notNull()
      .references(() => actionProposals.id, { onDelete: "cascade" }),
    approverPrincipalId: text("approver_principal_id").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    reauthenticatedAt: timestamp("reauthenticated_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_approvals_proposal_approver_unique").on(
      table.actionProposalId,
      table.approverPrincipalId,
    ),
  ],
);

export const actionReceipts = pgTable(
  "action_receipts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actionProposalId: text("action_proposal_id")
      .notNull()
      .references(() => actionProposals.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    connectorPreflight: jsonb("connector_preflight")
      .$type<Record<string, unknown>>()
      .notNull(),
    beforeEvidence: jsonb("before_evidence").$type<string[]>().notNull(),
    afterEvidence: jsonb("after_evidence").$type<string[]>().notNull(),
    compensationStatus: text("compensation_status").notNull().default("not_required"),
    externalRef: text("external_ref"),
    receiptHash: text("receipt_hash").notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true, mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("action_receipts_proposal_unique").on(table.actionProposalId),
    uniqueIndex("action_receipts_workspace_hash_unique").on(
      table.workspaceId,
      table.receiptHash,
    ),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    requestId: text("request_id").notNull(),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    policyDecision: text("policy_decision").notNull(),
    beforeHash: text("before_hash"),
    afterHash: text("after_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_events_workspace_request_action_unique").on(
      table.workspaceId,
      table.requestId,
      table.action,
      table.resourceId,
    ),
    index("audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    principalId: text("principal_id").notNull(),
    meter: text("meter").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_events_workspace_idempotency_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("usage_events_org_meter_occurred_idx").on(
      table.organizationId,
      table.meter,
      table.occurredAt,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    principalId: text("principal_id").notNull(),
    route: text("route").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idempotency_records_principal_route_key_unique").on(
      table.principalId,
      table.route,
      table.idempotencyKey,
    ),
    index("idempotency_records_expires_idx").on(table.expiresAt),
  ],
);

export const sourceArtifacts = pgTable(
  "source_artifacts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    storageBucket: text("storage_bucket").notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256").notNull(),
    classification: text("classification").notNull(),
    acl: jsonb("acl").$type<string[]>().notNull(),
    status: text("status").notNull().default("ready"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("source_artifacts_workspace_storage_key_unique").on(
      table.workspaceId,
      table.storageBucket,
      table.storageKey,
    ),
    index("source_artifacts_workspace_source_idx").on(table.workspaceId, table.sourceId),
  ],
);

export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    artifactId: text("artifact_id").references(() => sourceArtifacts.id, {
      onDelete: "set null",
    }),
    ordinal: integer("ordinal").notNull(),
    contentText: text("content_text").notNull(),
    searchText: text("search_text").notNull(),
    contentHash: text("content_hash").notNull(),
    tokenCount: integer("token_count").notNull(),
    classification: text("classification").notNull(),
    acl: jsonb("acl").$type<string[]>().notNull(),
    configurationVersion: integer("configuration_version").notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("source_chunks_source_ordinal_hash_unique").on(
      table.sourceId,
      table.ordinal,
      table.contentHash,
    ),
    index("source_chunks_workspace_source_idx").on(table.workspaceId, table.sourceId),
  ],
);
