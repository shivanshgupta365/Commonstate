/**
 * Provider-independent workspace configuration for Commonstate.
 *
 * Configuration is data, never executable customer code. Drafts are mutable in
 * the product, while published versions are immutable and are referenced by
 * context packs, agent receipts, and audit records.
 */

export const CONFIGURATION_SCHEMA_VERSION = 1 as const;

export type JsonSchema = Readonly<Record<string, unknown>>;
export type SolutionPackId =
  | "ai-operations"
  | "enterprise-governance"
  | "agency-operations"
  | "blank";
export type SurfaceId =
  | "overview"
  | "inbox"
  | "map"
  | "ask"
  | "agents"
  | "replay"
  | "evals"
  | "settings";
export type RiskTier = "low" | "medium" | "high" | "critical";

export type BrandingConfiguration = Readonly<{
  companyName: string;
  logoUrl: string | null;
  accent: string;
  locale: string;
  timezone: string;
  currency: string;
}>;

export type TerminologyConfiguration = Readonly<{
  workspace: string;
  scope: string;
  entity: string;
  claim: string;
  approval: string;
  outcome: string;
}>;

export type ScopeKindDefinition = Readonly<{
  key: string;
  label: string;
  parentKinds: readonly string[];
  root: boolean;
}>;

export type EntityKindDefinition = Readonly<{
  key: string;
  label: string;
  icon: string;
  attributesSchema: JsonSchema;
}>;

export type PredicateDefinition = Readonly<{
  key: string;
  label: string;
  subjectKinds: readonly string[];
  valueSchema: JsonSchema;
  freshnessSeconds: number | null;
  conflictRisk: RiskTier;
  classification: "public" | "private" | "synthetic";
}>;

export type AuthorityRule = Readonly<{
  authority: "authoritative" | "operator_note" | "derived" | "public_copy";
  rank: number;
}>;

export type ApprovalPolicyDefinition = Readonly<{
  risk: RiskTier;
  requiredApprovals: number;
  recentReauthentication: boolean;
  preflightRequired: boolean;
  executable: boolean;
}>;

export type AgentDefinition = Readonly<{
  key: string;
  name: string;
  purpose: string;
  allowedTools: readonly string[];
  writeBudget: number;
  allowedScopeKinds: readonly string[];
}>;

export type MetricDefinition = Readonly<{
  key: string;
  label: string;
  unit: "count" | "percent" | "currency" | "milliseconds" | "score";
  direction: "higher" | "lower" | "neutral";
}>;

export type WorkflowDefinition = Readonly<{
  key: string;
  name: string;
  summary: string;
  steps: readonly string[];
}>;

export type EvaluationDefinition = Readonly<{
  key: string;
  name: string;
  invariant: string;
  severity: RiskTier;
}>;

export type WorkspaceConfiguration = Readonly<{
  schemaVersion: typeof CONFIGURATION_SCHEMA_VERSION;
  template: SolutionPackId;
  branding: BrandingConfiguration;
  terminology: TerminologyConfiguration;
  enabledSurfaces: readonly SurfaceId[];
  scopeKinds: readonly ScopeKindDefinition[];
  entityKinds: readonly EntityKindDefinition[];
  predicates: readonly PredicateDefinition[];
  authorityRules: readonly AuthorityRule[];
  approvalPolicies: readonly ApprovalPolicyDefinition[];
  agents: readonly AgentDefinition[];
  metrics: readonly MetricDefinition[];
  workflows: readonly WorkflowDefinition[];
  evaluations: readonly EvaluationDefinition[];
}>;

export type ConfigurationVersion = Readonly<{
  id: string;
  workspaceId: string;
  version: number;
  status: "draft" | "published" | "superseded";
  basedOnVersionId: string | null;
  configuration: WorkspaceConfiguration;
  createdByActorId: string;
  createdAt: string;
  publishedAt: string | null;
  contentHash: string;
}>;

export type TemplateDefinition = Readonly<{
  id: SolutionPackId;
  version: string;
  name: string;
  audience: string;
  description: string;
  recordedDemoAvailable: boolean;
  sampleWorkspaceName: string;
  configuration: WorkspaceConfiguration;
}>;

const ALL_SURFACES: readonly SurfaceId[] = [
  "overview",
  "inbox",
  "map",
  "ask",
  "agents",
  "replay",
  "evals",
  "settings",
];

const TERMINOLOGY: TerminologyConfiguration = {
  workspace: "Workspace",
  scope: "Scope",
  entity: "Entity",
  claim: "Claim",
  approval: "Approval",
  outcome: "Outcome",
};

const APPROVAL_POLICIES: readonly ApprovalPolicyDefinition[] = [
  { risk: "low", requiredApprovals: 0, recentReauthentication: false, preflightRequired: false, executable: true },
  { risk: "medium", requiredApprovals: 1, recentReauthentication: false, preflightRequired: true, executable: true },
  { risk: "high", requiredApprovals: 2, recentReauthentication: true, preflightRequired: true, executable: true },
  { risk: "critical", requiredApprovals: 0, recentReauthentication: true, preflightRequired: true, executable: false },
];

const AUTHORITY_RULES: readonly AuthorityRule[] = [
  { authority: "authoritative", rank: 400 },
  { authority: "operator_note", rank: 300 },
  { authority: "derived", rank: 200 },
  { authority: "public_copy", rank: 100 },
];

function objectSchema(properties: Record<string, unknown>, required: readonly string[] = []): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function stringSchema(extra: Record<string, unknown> = {}): JsonSchema {
  return { type: "string", ...extra };
}

function baseConfiguration(
  template: SolutionPackId,
  companyName: string,
): Pick<
  WorkspaceConfiguration,
  | "schemaVersion"
  | "template"
  | "branding"
  | "terminology"
  | "enabledSurfaces"
  | "authorityRules"
  | "approvalPolicies"
> {
  return {
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    template,
    branding: {
      companyName,
      logoUrl: null,
      accent: "#7357FF",
      locale: "en-GB",
      timezone: "UTC",
      currency: "GBP",
    },
    terminology: TERMINOLOGY,
    enabledSurfaces: ALL_SURFACES,
    authorityRules: AUTHORITY_RULES,
    approvalPolicies: APPROVAL_POLICIES,
  };
}

const AI_OPERATIONS: TemplateDefinition = {
  id: "ai-operations",
  version: "1.0.0",
  name: "AI Operations",
  audience: "Teams operating production agents and automated workflows",
  description: "Govern agent context, incidents, tools, decisions, and measurable outcomes.",
  recordedDemoAvailable: true,
  sampleWorkspaceName: "Northstar AI Operations",
  configuration: {
    ...baseConfiguration("ai-operations", "Northstar"),
    scopeKinds: [
      { key: "company", label: "Company", parentKinds: [], root: true },
      { key: "team", label: "Team", parentKinds: ["company"], root: false },
      { key: "workflow", label: "Workflow", parentKinds: ["team"], root: false },
    ],
    entityKinds: [
      { key: "agent", label: "Agent", icon: "spark", attributesSchema: objectSchema({ owner: stringSchema(), model: stringSchema() }, ["owner"]) },
      { key: "tool", label: "Tool", icon: "wrench", attributesSchema: objectSchema({ provider: stringSchema(), version: stringSchema() }) },
      { key: "run", label: "Run", icon: "play", attributesSchema: objectSchema({ status: stringSchema(), durationMs: { type: "integer", minimum: 0 } }, ["status"]) },
      { key: "incident", label: "Incident", icon: "alert", attributesSchema: objectSchema({ severity: stringSchema({ enum: ["low", "medium", "high", "critical"] }) }) },
      { key: "policy", label: "Policy", icon: "shield", attributesSchema: objectSchema({ owner: stringSchema(), reviewDate: stringSchema({ format: "date" }) }) },
      { key: "decision", label: "Decision", icon: "branch", attributesSchema: objectSchema({ status: stringSchema() }) },
    ],
    predicates: [
      { key: "agent.allowed_tool", label: "Allowed tool", subjectKinds: ["agent"], valueSchema: stringSchema(), freshnessSeconds: 86400, conflictRisk: "high", classification: "private" },
      { key: "agent.model_version", label: "Model version", subjectKinds: ["agent"], valueSchema: stringSchema(), freshnessSeconds: 86400, conflictRisk: "medium", classification: "private" },
      { key: "workflow.execution_policy", label: "Execution policy", subjectKinds: ["policy"], valueSchema: objectSchema({ risk: stringSchema() }, ["risk"]), freshnessSeconds: 86400, conflictRisk: "high", classification: "private" },
      { key: "incident.resolution", label: "Incident resolution", subjectKinds: ["incident"], valueSchema: stringSchema(), freshnessSeconds: null, conflictRisk: "medium", classification: "private" },
    ],
    agents: [
      { key: "operations_agent", name: "Operations Agent", purpose: "Triage runs and propose safe remediations", allowedTools: ["get_context_pack", "propose_action", "record_outcome"], writeBudget: 20, allowedScopeKinds: ["team", "workflow"] },
    ],
    metrics: [
      { key: "successful_run_rate", label: "Successful run rate", unit: "percent", direction: "higher" },
      { key: "mean_time_to_recovery", label: "Mean time to recovery", unit: "milliseconds", direction: "lower" },
      { key: "human_correction_rate", label: "Human correction rate", unit: "percent", direction: "lower" },
    ],
    workflows: [
      { key: "incident_response", name: "Agent incident response", summary: "Turn a failed run into a cited, approved remediation", steps: ["Ingest run event", "Resolve current policy", "Propose remediation", "Approve by risk", "Execute or block", "Record outcome"] },
    ],
    evaluations: [
      { key: "tool_least_privilege", name: "Tool least privilege", invariant: "Context and execution expose only configured tools", severity: "high" },
      { key: "run_replay", name: "Run replay", invariant: "The same context and versions reproduce the same decision receipt", severity: "high" },
      { key: "incident_freshness", name: "Incident freshness", invariant: "Stale high-risk policy blocks remediation", severity: "high" },
    ],
  },
};

const ENTERPRISE_GOVERNANCE: TemplateDefinition = {
  id: "enterprise-governance",
  version: "1.0.0",
  name: "Enterprise Governance",
  audience: "Security, risk, compliance, and technology governance teams",
  description: "Connect controls and policies to current evidence, exceptions, owners, and reviews.",
  recordedDemoAvailable: true,
  sampleWorkspaceName: "Meridian Governance",
  configuration: {
    ...baseConfiguration("enterprise-governance", "Meridian"),
    scopeKinds: [
      { key: "organization", label: "Organization", parentKinds: [], root: true },
      { key: "business_unit", label: "Business Unit", parentKinds: ["organization"], root: false },
      { key: "system", label: "System", parentKinds: ["business_unit"], root: false },
    ],
    entityKinds: [
      { key: "policy", label: "Policy", icon: "book", attributesSchema: objectSchema({ owner: stringSchema(), reviewDate: stringSchema({ format: "date" }) }, ["owner"]) },
      { key: "control", label: "Control", icon: "shield", attributesSchema: objectSchema({ framework: stringSchema(), controlId: stringSchema() }, ["controlId"]) },
      { key: "evidence", label: "Evidence", icon: "paperclip", attributesSchema: objectSchema({ expiresAt: stringSchema({ format: "date-time" }) }) },
      { key: "vendor", label: "Vendor", icon: "building", attributesSchema: objectSchema({ criticality: stringSchema() }) },
      { key: "exception", label: "Exception", icon: "alert", attributesSchema: objectSchema({ expiresAt: stringSchema({ format: "date-time" }), owner: stringSchema() }) },
      { key: "review", label: "Review", icon: "check", attributesSchema: objectSchema({ dueAt: stringSchema({ format: "date-time" }) }) },
    ],
    predicates: [
      { key: "control.status", label: "Control status", subjectKinds: ["control"], valueSchema: stringSchema({ enum: ["effective", "partial", "ineffective"] }), freshnessSeconds: 604800, conflictRisk: "high", classification: "private" },
      { key: "evidence.valid_until", label: "Evidence valid until", subjectKinds: ["evidence"], valueSchema: stringSchema({ format: "date-time" }), freshnessSeconds: 604800, conflictRisk: "high", classification: "private" },
      { key: "exception.approved_until", label: "Exception approved until", subjectKinds: ["exception"], valueSchema: stringSchema({ format: "date-time" }), freshnessSeconds: 86400, conflictRisk: "high", classification: "private" },
      { key: "vendor.risk_rating", label: "Vendor risk rating", subjectKinds: ["vendor"], valueSchema: stringSchema({ enum: ["low", "medium", "high", "critical"] }), freshnessSeconds: 2592000, conflictRisk: "medium", classification: "private" },
    ],
    agents: [
      { key: "control_review_agent", name: "Control Review Agent", purpose: "Assemble current control evidence and escalate gaps", allowedTools: ["get_context_pack", "get_evidence", "request_claim_approval"], writeBudget: 10, allowedScopeKinds: ["business_unit", "system"] },
    ],
    metrics: [
      { key: "control_coverage", label: "Control coverage", unit: "percent", direction: "higher" },
      { key: "expired_evidence", label: "Expired evidence", unit: "count", direction: "lower" },
      { key: "open_exceptions", label: "Open exceptions", unit: "count", direction: "lower" },
    ],
    workflows: [
      { key: "control_review", name: "Control review", summary: "Compile current evidence and close or escalate a control review", steps: ["Ingest evidence", "Check ACL and validity", "Detect conflicts", "Request owner decision", "Publish review", "Record outcome"] },
    ],
    evaluations: [
      { key: "expired_evidence", name: "Expired evidence", invariant: "Expired evidence never supports an effective control", severity: "high" },
      { key: "exception_approval", name: "Exception approval", invariant: "Unapproved exceptions block closure", severity: "high" },
      { key: "private_evidence", name: "Evidence ACL", invariant: "Private evidence is visible only to granted scopes", severity: "critical" },
    ],
  },
};

const AGENCY_OPERATIONS: TemplateDefinition = {
  id: "agency-operations",
  version: "1.0.0",
  name: "Agency Operations",
  audience: "Agencies coordinating clients, engagements, approvals, and delivery",
  description: "Keep briefs, rights, deliverables, vendors, decisions, and campaign outcomes in one governed state.",
  recordedDemoAvailable: true,
  sampleWorkspaceName: "Beacon Agency",
  configuration: {
    ...baseConfiguration("agency-operations", "Beacon Agency"),
    scopeKinds: [
      { key: "agency", label: "Agency", parentKinds: [], root: true },
      { key: "client", label: "Client", parentKinds: ["agency"], root: false },
      { key: "engagement", label: "Engagement", parentKinds: ["client"], root: false },
    ],
    entityKinds: [
      { key: "brief", label: "Brief", icon: "file", attributesSchema: objectSchema({ owner: stringSchema(), dueAt: stringSchema({ format: "date-time" }) }) },
      { key: "asset", label: "Asset", icon: "image", attributesSchema: objectSchema({ rightsValidUntil: stringSchema({ format: "date-time" }) }) },
      { key: "deliverable", label: "Deliverable", icon: "package", attributesSchema: objectSchema({ status: stringSchema(), dueAt: stringSchema({ format: "date-time" }) }) },
      { key: "approval", label: "Approval", icon: "check", attributesSchema: objectSchema({ decision: stringSchema() }) },
      { key: "vendor", label: "Vendor", icon: "users", attributesSchema: objectSchema({ fee: { type: "number", minimum: 0 } }) },
      { key: "campaign", label: "Campaign", icon: "megaphone", attributesSchema: objectSchema({ channel: stringSchema(), budget: { type: "number", minimum: 0 } }) },
    ],
    predicates: [
      { key: "asset.rights_valid_until", label: "Rights valid until", subjectKinds: ["asset"], valueSchema: stringSchema({ format: "date-time" }), freshnessSeconds: 86400, conflictRisk: "high", classification: "private" },
      { key: "deliverable.status", label: "Deliverable status", subjectKinds: ["deliverable"], valueSchema: stringSchema(), freshnessSeconds: 86400, conflictRisk: "medium", classification: "private" },
      { key: "campaign.budget", label: "Campaign budget", subjectKinds: ["campaign"], valueSchema: { type: "number", minimum: 0 }, freshnessSeconds: 86400, conflictRisk: "high", classification: "private" },
      { key: "brief.current_version", label: "Current brief version", subjectKinds: ["brief"], valueSchema: stringSchema(), freshnessSeconds: 86400, conflictRisk: "medium", classification: "private" },
    ],
    agents: [
      { key: "delivery_agent", name: "Delivery Agent", purpose: "Coordinate approved work while failing closed on rights and delivery conflicts", allowedTools: ["get_context_pack", "propose_action", "record_outcome"], writeBudget: 20, allowedScopeKinds: ["client", "engagement"] },
    ],
    metrics: [
      { key: "on_time_delivery", label: "On-time delivery", unit: "percent", direction: "higher" },
      { key: "approval_cycle_time", label: "Approval cycle time", unit: "milliseconds", direction: "lower" },
      { key: "campaign_roas", label: "Campaign ROAS", unit: "score", direction: "higher" },
    ],
    workflows: [
      { key: "campaign_launch", name: "Campaign launch", summary: "Compile a current, approved launch queue", steps: ["Ingest brief", "Verify rights", "Resolve deliverables", "Approve changes", "Propose launch actions", "Record outcomes"] },
    ],
    evaluations: [
      { key: "rights_validity", name: "Rights validity", invariant: "Expired or conflicted rights block action", severity: "critical" },
      { key: "budget_precedence", name: "Budget precedence", invariant: "Engagement budget overrides client and agency defaults", severity: "high" },
      { key: "deliverable_conflict", name: "Deliverable conflict", invariant: "Unresolved delivery conflicts block launch", severity: "high" },
    ],
  },
};

const BLANK: TemplateDefinition = {
  id: "blank",
  version: "1.0.0",
  name: "Blank workspace",
  audience: "Teams with a custom operating model",
  description: "Start with Commonstate's safety defaults and define the company ontology explicitly.",
  recordedDemoAvailable: false,
  sampleWorkspaceName: "New workspace",
  configuration: {
    ...baseConfiguration("blank", "New company"),
    scopeKinds: [{ key: "company", label: "Company", parentKinds: [], root: true }],
    entityKinds: [],
    predicates: [],
    agents: [
      {
        key: "starter_context_agent",
        name: "Starter Context Agent",
        purpose: "Read current scoped context and complete deterministic dry runs while the workspace is tailored",
        allowedTools: ["get_context_pack", "get_evidence", "record_outcome"],
        writeBudget: 0,
        allowedScopeKinds: ["company"],
      },
    ],
    metrics: [],
    workflows: [],
    evaluations: [],
  },
};

export const SOLUTION_PACKS: Readonly<Record<SolutionPackId, TemplateDefinition>> = Object.freeze({
  "ai-operations": AI_OPERATIONS,
  "enterprise-governance": ENTERPRISE_GOVERNANCE,
  "agency-operations": AGENCY_OPERATIONS,
  blank: BLANK,
});

export function getSolutionPack(id: SolutionPackId): TemplateDefinition {
  return structuredClone(SOLUTION_PACKS[id]);
}

export type ConfigurationValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

function uniqueKeys<T extends { key: string }>(
  items: readonly T[],
  path: string,
  issues: ConfigurationValidationIssue[],
  keyPattern: RegExp = /^[a-z][a-z0-9_]*$/,
): void {
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (!keyPattern.test(item.key)) {
      issues.push({ path: `${path}.${index}.key`, code: "INVALID_KEY", message: "Keys must be lower snake_case." });
    }
    if (seen.has(item.key)) {
      issues.push({ path: `${path}.${index}.key`, code: "DUPLICATE_KEY", message: `Duplicate key: ${item.key}` });
    }
    seen.add(item.key);
  }
}

export function validateWorkspaceConfiguration(
  configuration: WorkspaceConfiguration,
): readonly ConfigurationValidationIssue[] {
  const issues: ConfigurationValidationIssue[] = [];
  if (configuration.schemaVersion !== CONFIGURATION_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", code: "UNSUPPORTED_SCHEMA_VERSION", message: `Expected schema version ${CONFIGURATION_SCHEMA_VERSION}.` });
  }
  if (!configuration.branding.companyName.trim()) {
    issues.push({ path: "branding.companyName", code: "REQUIRED", message: "Company name is required." });
  }
  if (!/^#[0-9a-f]{6}$/i.test(configuration.branding.accent)) {
    issues.push({ path: "branding.accent", code: "INVALID_COLOUR", message: "Accent must be a six-digit hex colour." });
  }
  if (configuration.enabledSurfaces.length === 0) {
    issues.push({ path: "enabledSurfaces", code: "REQUIRED", message: "At least one product surface must be enabled." });
  }

  uniqueKeys(configuration.scopeKinds, "scopeKinds", issues);
  uniqueKeys(configuration.entityKinds, "entityKinds", issues);
  uniqueKeys(configuration.predicates, "predicates", issues, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
  uniqueKeys(configuration.agents, "agents", issues);
  uniqueKeys(configuration.metrics, "metrics", issues);
  uniqueKeys(configuration.workflows, "workflows", issues);
  uniqueKeys(configuration.evaluations, "evaluations", issues);

  const scopeKeys = new Set(configuration.scopeKinds.map((item) => item.key));
  const roots = configuration.scopeKinds.filter((scope) => scope.root);
  if (roots.length !== 1) {
    issues.push({ path: "scopeKinds", code: "ROOT_SCOPE_COUNT", message: "Exactly one root scope kind is required." });
  }
  for (const [index, scope] of configuration.scopeKinds.entries()) {
    for (const parent of scope.parentKinds) {
      if (!scopeKeys.has(parent)) {
        issues.push({ path: `scopeKinds.${index}.parentKinds`, code: "UNKNOWN_SCOPE_KIND", message: `Unknown parent scope kind: ${parent}` });
      }
      if (parent === scope.key) {
        issues.push({ path: `scopeKinds.${index}.parentKinds`, code: "SCOPE_CYCLE", message: "A scope kind cannot parent itself." });
      }
    }
  }

  const entityKeys = new Set(configuration.entityKinds.map((item) => item.key));
  for (const [index, predicate] of configuration.predicates.entries()) {
    if (!predicate.key.includes(".")) {
      issues.push({ path: `predicates.${index}.key`, code: "INVALID_PREDICATE_KEY", message: "Predicate keys must be namespace-qualified." });
    }
    for (const subjectKind of predicate.subjectKinds) {
      if (!entityKeys.has(subjectKind)) {
        issues.push({ path: `predicates.${index}.subjectKinds`, code: "UNKNOWN_ENTITY_KIND", message: `Unknown entity kind: ${subjectKind}` });
      }
    }
  }

  const policyRisks = new Set(configuration.approvalPolicies.map((item) => item.risk));
  for (const risk of ["low", "medium", "high", "critical"] as const) {
    if (!policyRisks.has(risk)) {
      issues.push({ path: "approvalPolicies", code: "MISSING_RISK_POLICY", message: `Missing ${risk} action policy.` });
    }
  }
  const critical = configuration.approvalPolicies.find((item) => item.risk === "critical");
  if (critical?.executable !== false) {
    issues.push({ path: "approvalPolicies", code: "CRITICAL_ACTION_ENABLED", message: "Critical actions must remain disabled in private beta." });
  }

  return issues;
}

export function assertValidWorkspaceConfiguration(configuration: WorkspaceConfiguration): void {
  const issues = validateWorkspaceConfiguration(configuration);
  if (issues.length > 0) {
    throw new WorkspaceConfigurationError(issues);
  }
}

export class WorkspaceConfigurationError extends Error {
  readonly code = "INVALID_WORKSPACE_CONFIGURATION";
  readonly issues: readonly ConfigurationValidationIssue[];

  constructor(issues: readonly ConfigurationValidationIssue[]) {
    super(`Workspace configuration is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}).`);
    this.name = "WorkspaceConfigurationError";
    this.issues = issues;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createConfigurationDraft(input: {
  id: string;
  workspaceId: string;
  version: number;
  basedOnVersionId: string | null;
  configuration: WorkspaceConfiguration;
  createdByActorId: string;
  createdAt: string;
  contentHash: string;
}): ConfigurationVersion {
  assertValidWorkspaceConfiguration(input.configuration);
  if (input.version < 1 || !Number.isInteger(input.version)) {
    throw new WorkspaceConfigurationError([{ path: "version", code: "INVALID_VERSION", message: "Version must be a positive integer." }]);
  }
  return Object.freeze({ ...input, configuration: deepFreeze(structuredClone(input.configuration)), status: "draft", publishedAt: null });
}

export function publishConfigurationVersion(
  draft: ConfigurationVersion,
  publishedAt: string,
): ConfigurationVersion {
  if (draft.status !== "draft") {
    throw new WorkspaceConfigurationError([{ path: "status", code: "NOT_A_DRAFT", message: "Only a draft can be published." }]);
  }
  assertValidWorkspaceConfiguration(draft.configuration);
  return Object.freeze({
    ...structuredClone(draft),
    configuration: deepFreeze(structuredClone(draft.configuration)),
    status: "published",
    publishedAt,
  });
}
