export type TemplateId =
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

export type CandidateStatus = "eligible" | "blocked" | "review";
export type CandidateTone = "neutral" | "good" | "warn" | "bad" | "violet";

export type DecisionCandidate = {
  entityId: string;
  name: string;
  subtitle?: string;
  status: CandidateStatus;
  score?: number;
  facts: Array<{ label: string; value: string; tone?: CandidateTone }>;
  reason: string;
  evidenceIds: string[];
};

export type TemplateAgent = {
  id: string;
  name: string;
  initials: string;
  purpose: string;
  scope: string;
  permissions: string[];
  writeBudget: number;
  riskCeiling: "low" | "medium" | "high";
};

export type TemplateChange = {
  id: string;
  subject: string;
  predicate: string;
  previous: string;
  next: string;
  source: string;
  sourceType: "private" | "public" | "synthetic";
  severity: "low" | "medium" | "high";
  confidence: number;
  impact: string[];
};

export type TemplateEvidence = {
  id: string;
  title: string;
  source: string;
  sourceType: "private" | "public" | "synthetic";
  excerpt: string;
  author: string;
  observedAt: string;
  validUntil?: string;
  hash: string;
};

export type TemplatePack = {
  id: TemplateId;
  name: string;
  shortName: string;
  eyebrow: string;
  description: string;
  audience: string;
  accent: string;
  accentSoft: string;
  scopeKinds: string[];
  entityTypes: string[];
  predicates: string[];
  metrics: Array<{ label: string; value: string; delta: string; tone: "violet" | "mint" | "yellow" | "coral" }>;
  guidedQuestion: string;
  suggestedQuestions: string[];
  candidates: DecisionCandidate[];
  agents: TemplateAgent[];
  changes: TemplateChange[];
  evidence: TemplateEvidence[];
  outcomeMetrics: Array<{ key: string; label: string; unit: string }>;
  graph: {
    nodes: Array<{ id: string; label: string; kind: string; x: number; y: number; tone: "violet" | "mint" | "yellow" | "coral" | "blue" | "ink" }>;
    edges: Array<{ from: string; to: string; label: string }>;
  };
};

const sharedEvidence = {
  author: "Workspace operator",
  observedAt: "15 Jul 2026 · 10:36 UTC",
  hash: "sha256:8f48a2d6c41e...e921",
} as const;

export const templatePacks: Record<TemplateId, TemplatePack> = {
  "ai-operations": {
    id: "ai-operations",
    name: "AI Operations",
    shortName: "AI Ops",
    eyebrow: "Agents that share the same operational truth",
    description: "Govern agent context, tools, incidents, and outcomes across every production workflow.",
    audience: "AI platform and operations teams",
    accent: "#7357ff",
    accentSoft: "#e6e0ff",
    scopeKinds: ["Company", "Team", "Workflow"],
    entityTypes: ["Agent", "Tool", "Workflow", "Policy", "Incident", "Decision", "Outcome"],
    predicates: ["owner", "deployment_status", "risk_tier", "tool_access", "success_rate", "incident_state"],
    metrics: [
      { label: "Context health", value: "98.7%", delta: "+1.8 this week", tone: "violet" },
      { label: "Active agents", value: "14", delta: "6 production workflows", tone: "mint" },
      { label: "Open incidents", value: "02", delta: "1 blocks execution", tone: "coral" },
      { label: "Cited decisions", value: "100%", delta: "4,182 receipts", tone: "yellow" },
    ],
    guidedQuestion: "Which production agents can deploy today, with current policy approval and no unresolved incidents?",
    suggestedQuestions: ["Agents ready to deploy", "Incidents affecting workflows", "Tool access expiring soon"],
    candidates: [
      {
        entityId: "agent-triage",
        name: "Incident Triage Agent",
        subtitle: "Platform · Production",
        status: "eligible",
        score: 98,
        facts: [
          { label: "Policy", value: "Approved v8", tone: "good" },
          { label: "Evaluation", value: "99.2%", tone: "good" },
          { label: "Write budget", value: "12 / hour" },
        ],
        reason: "Deployment policy, tool grants, and rollback owner are current.",
        evidenceIds: ["ai-policy", "ai-eval"],
      },
      {
        entityId: "agent-refund",
        name: "Refund Resolution Agent",
        subtitle: "Support · Canary",
        status: "review",
        score: 82,
        facts: [
          { label: "Policy", value: "Approved v5", tone: "good" },
          { label: "Evaluation", value: "96.4%" },
          { label: "Incident", value: "Under review", tone: "warn" },
        ],
        reason: "A retrieval-latency incident requires an operator review before promotion.",
        evidenceIds: ["ai-incident", "ai-eval"],
      },
      {
        entityId: "agent-renewal",
        name: "Renewal Outreach Agent",
        subtitle: "Revenue · Staging",
        status: "blocked",
        score: 61,
        facts: [
          { label: "Policy", value: "Expired", tone: "bad" },
          { label: "Evaluation", value: "91.8%", tone: "warn" },
          { label: "Tool grant", value: "Revoked", tone: "bad" },
        ],
        reason: "The outbound-message policy expired and the CRM write grant was revoked.",
        evidenceIds: ["ai-policy"],
      },
    ],
    agents: [
      { id: "incident-agent", name: "Incident Triage Agent", initials: "IT", purpose: "Classifies incidents and proposes reversible mitigations", scope: "Platform / Production", permissions: ["claims:read", "incidents:propose", "tools:read"], writeBudget: 12, riskCeiling: "medium" },
      { id: "truth-engine", name: "Truth Engine", initials: "TE", purpose: "Extracts evidence and detects conflicting operational claims", scope: "Company", permissions: ["sources:read", "claims:propose"], writeBudget: 40, riskCeiling: "low" },
      { id: "release-agent", name: "Release Guardian", initials: "RG", purpose: "Preflights releases against current policy and incident state", scope: "Platform / Release", permissions: ["claims:read", "releases:hold"], writeBudget: 8, riskCeiling: "high" },
    ],
    changes: [
      { id: "ai-change-1", subject: "Incident Triage Agent", predicate: "deployment_status", previous: "canary", next: "production eligible", source: "Release review · #ai-operations", sourceType: "private", severity: "medium", confidence: 0.98, impact: ["Production deploy context", "Release Guardian schedule", "Incident response runbook"] },
      { id: "ai-change-2", subject: "Renewal Outreach Agent", predicate: "tool_access", previous: "CRM write allowed", next: "CRM write revoked", source: "Identity provider event", sourceType: "private", severity: "high", confidence: 1, impact: ["3 scheduled outreach runs", "Revenue workflow context", "Outbound action policy"] },
      { id: "ai-change-3", subject: "Refund Resolution Agent", predicate: "incident_state", previous: "clear", next: "retrieval latency under review", source: "Pager event 2841", sourceType: "private", severity: "high", confidence: 0.96, impact: ["Canary promotion", "Support response SLO"] },
    ],
    evidence: [
      { id: "ai-policy", title: "Agent deployment policy v8", source: "Policy registry", sourceType: "private", excerpt: "Production promotion requires a current evaluation above 97%, a named rollback owner, and no unresolved high-risk incident.", ...sharedEvidence },
      { id: "ai-eval", title: "Evaluation run · 14 July", source: "Evaluation pipeline", sourceType: "private", excerpt: "Incident Triage Agent passed 238 of 240 deterministic cases. No permission-boundary failures detected.", ...sharedEvidence },
      { id: "ai-incident", title: "Pager event 2841", source: "Incident stream", sourceType: "private", excerpt: "P95 retrieval latency exceeded the canary threshold for 11 minutes. Root cause remains under review.", ...sharedEvidence },
    ],
    outcomeMetrics: [
      { key: "resolution_minutes", label: "Resolution time", unit: "minutes" },
      { key: "false_positive_rate", label: "False-positive rate", unit: "%" },
      { key: "operator_minutes_saved", label: "Operator time saved", unit: "minutes" },
    ],
    graph: {
      nodes: [
        { id: "company", label: "Northstar AI", kind: "Company", x: 7, y: 44, tone: "blue" },
        { id: "team", label: "Platform", kind: "Team", x: 29, y: 44, tone: "violet" },
        { id: "workflow", label: "Incident response", kind: "Workflow", x: 53, y: 44, tone: "yellow" },
        { id: "triage", label: "Triage Agent", kind: "Agent · eligible", x: 76, y: 18, tone: "mint" },
        { id: "guardian", label: "Release Guardian", kind: "Agent", x: 77, y: 69, tone: "coral" },
        { id: "policy", label: "Deploy policy v8", kind: "Policy", x: 53, y: 77, tone: "ink" },
      ],
      edges: [
        { from: "company", to: "team", label: "contains" },
        { from: "team", to: "workflow", label: "owns" },
        { from: "workflow", to: "triage", label: "runs" },
        { from: "workflow", to: "guardian", label: "checked by" },
        { from: "policy", to: "triage", label: "governs" },
      ],
    },
  },
  "enterprise-governance": {
    id: "enterprise-governance",
    name: "Enterprise Governance",
    shortName: "Governance",
    eyebrow: "Controls with evidence, owners, and valid time",
    description: "Keep policies, controls, systems, vendors, exceptions, and reviews in one audit-ready state.",
    audience: "Risk, security, and compliance teams",
    accent: "#166d4c",
    accentSoft: "#d8f4e7",
    scopeKinds: ["Organization", "Business unit", "System"],
    entityTypes: ["Policy", "Control", "Evidence", "Vendor", "Owner", "Exception", "Review"],
    predicates: ["control_status", "owner", "review_due", "evidence_validity", "vendor_tier", "exception_state"],
    metrics: [
      { label: "Control health", value: "96.2%", delta: "+0.7 this month", tone: "mint" },
      { label: "Evidence current", value: "418", delta: "12 expire this quarter", tone: "violet" },
      { label: "Open exceptions", value: "07", delta: "2 high risk", tone: "coral" },
      { label: "Reviews on time", value: "99.1%", delta: "31 due this month", tone: "yellow" },
    ],
    guidedQuestion: "Which critical systems are audit-ready today, with current evidence and no unresolved high-risk exceptions?",
    suggestedQuestions: ["Systems ready for audit", "Evidence expiring this quarter", "High-risk vendor exceptions"],
    candidates: [
      { entityId: "system-ledger", name: "Customer Ledger", subtitle: "Finance · Critical", status: "eligible", score: 99, facts: [{ label: "Controls", value: "42 / 42", tone: "good" }, { label: "Evidence", value: "Current", tone: "good" }, { label: "Review", value: "30 Sep 2026" }], reason: "All required controls are effective and every cited artifact is current.", evidenceIds: ["gov-control", "gov-audit"] },
      { entityId: "system-identity", name: "Workforce Identity", subtitle: "Security · Critical", status: "review", score: 88, facts: [{ label: "Controls", value: "37 / 38", tone: "warn" }, { label: "Evidence", value: "Current" }, { label: "Exception", value: "1 open", tone: "warn" }], reason: "A medium-risk privileged-access exception awaits owner attestation.", evidenceIds: ["gov-exception", "gov-control"] },
      { entityId: "system-warehouse", name: "Analytics Warehouse", subtitle: "Data · High", status: "blocked", score: 69, facts: [{ label: "Controls", value: "29 / 33", tone: "bad" }, { label: "Evidence", value: "2 expired", tone: "bad" }, { label: "Owner", value: "Unassigned", tone: "warn" }], reason: "Expired recovery evidence and a missing control owner fail the audit-readiness policy.", evidenceIds: ["gov-audit"] },
    ],
    agents: [
      { id: "control-agent", name: "Control Monitor", initials: "CM", purpose: "Checks control evidence and proposes review tasks", scope: "Organization", permissions: ["controls:read", "reviews:propose"], writeBudget: 20, riskCeiling: "medium" },
      { id: "vendor-agent", name: "Vendor Risk Agent", initials: "VR", purpose: "Reconciles vendor evidence, tiers, and exceptions", scope: "Third-party risk", permissions: ["vendors:read", "exceptions:propose"], writeBudget: 10, riskCeiling: "medium" },
      { id: "audit-agent", name: "Audit Readiness Agent", initials: "AR", purpose: "Compiles current evidence packs for scoped reviews", scope: "Critical systems", permissions: ["evidence:read", "packs:create"], writeBudget: 6, riskCeiling: "high" },
    ],
    changes: [
      { id: "gov-change-1", subject: "Analytics Warehouse", predicate: "evidence_validity", previous: "current", next: "recovery evidence expired", source: "GRC evidence scheduler", sourceType: "private", severity: "high", confidence: 1, impact: ["Q3 audit pack", "Recovery control status", "Audit Readiness Agent"] },
      { id: "gov-change-2", subject: "Workforce Identity", predicate: "exception_state", previous: "none", next: "privileged access exception open", source: "Security review notes", sourceType: "private", severity: "medium", confidence: 0.94, impact: ["Control AC-06", "Owner attestation queue"] },
      { id: "gov-change-3", subject: "Beacon Hosting", predicate: "vendor_tier", previous: "tier 2", next: "proposed tier 1", source: "Annual vendor assessment", sourceType: "private", severity: "medium", confidence: 0.91, impact: ["Review cadence", "Evidence requirements", "Vendor Risk Agent"] },
    ],
    evidence: [
      { id: "gov-control", title: "Critical systems control matrix", source: "GRC registry", sourceType: "private", excerpt: "Critical systems require complete access, change, recovery, and monitoring control evidence with named owners.", ...sharedEvidence },
      { id: "gov-audit", title: "Q3 audit readiness snapshot", source: "Audit workspace", sourceType: "private", excerpt: "Customer Ledger has 42 effective controls. Analytics Warehouse has two recovery artifacts beyond their validity window.", ...sharedEvidence },
      { id: "gov-exception", title: "Privileged access exception EX-104", source: "Security review", sourceType: "private", excerpt: "Temporary break-glass group membership is pending the system owner’s attestation.", ...sharedEvidence },
    ],
    outcomeMetrics: [
      { key: "review_days", label: "Review cycle time", unit: "days" },
      { key: "evidence_reuse", label: "Evidence reuse", unit: "%" },
      { key: "exceptions_closed", label: "Exceptions closed", unit: "count" },
    ],
    graph: {
      nodes: [
        { id: "org", label: "Meridian Group", kind: "Organization", x: 7, y: 44, tone: "blue" },
        { id: "unit", label: "Finance", kind: "Business unit", x: 29, y: 44, tone: "violet" },
        { id: "system", label: "Customer Ledger", kind: "System · ready", x: 54, y: 44, tone: "mint" },
        { id: "control", label: "Access control", kind: "Control · effective", x: 77, y: 17, tone: "yellow" },
        { id: "evidence", label: "Q3 evidence pack", kind: "Evidence", x: 77, y: 69, tone: "coral" },
        { id: "owner", label: "Control owner", kind: "Owner", x: 53, y: 78, tone: "ink" },
      ],
      edges: [
        { from: "org", to: "unit", label: "contains" },
        { from: "unit", to: "system", label: "owns" },
        { from: "system", to: "control", label: "requires" },
        { from: "control", to: "evidence", label: "supported by" },
        { from: "owner", to: "control", label: "attests" },
      ],
    },
  },
  "agency-operations": {
    id: "agency-operations",
    name: "Agency Operations",
    shortName: "Agency Ops",
    eyebrow: "Every brief, approval, and delivery in sync",
    description: "Coordinate clients, engagements, assets, approvals, vendors, campaigns, and outcomes.",
    audience: "Agencies and multi-client operator teams",
    accent: "#dd5b48",
    accentSoft: "#ffe0d9",
    scopeKinds: ["Agency", "Client", "Engagement"],
    entityTypes: ["Brief", "Asset", "Deliverable", "Approval", "Vendor", "Campaign", "Outcome"],
    predicates: ["delivery_status", "approval_state", "usage_rights", "budget", "owner", "performance"],
    metrics: [
      { label: "Delivery health", value: "94.8%", delta: "+3.2 this month", tone: "coral" },
      { label: "Active engagements", value: "18", delta: "7 launch this week", tone: "mint" },
      { label: "Blocked approvals", value: "04", delta: "2 need client action", tone: "yellow" },
      { label: "Cited decisions", value: "100%", delta: "1,284 this quarter", tone: "violet" },
    ],
    guidedQuestion: "Which launch assets can go live this week, within budget, with current approval and usage rights?",
    suggestedQuestions: ["Assets ready to launch", "Client approvals blocking work", "Rights expiring this month"],
    candidates: [
      { entityId: "asset-hero", name: "Summer hero film", subtitle: "Morrow & Co · Launch", status: "eligible", score: 98, facts: [{ label: "Budget", value: "£12,400", tone: "good" }, { label: "Approval", value: "Final", tone: "good" }, { label: "Rights", value: "31 Dec 2026" }], reason: "Final client approval, valid usage rights, and delivery checks are complete.", evidenceIds: ["agency-brief", "agency-rights"] },
      { entityId: "asset-cutdowns", name: "Social cutdown set", subtitle: "Morrow & Co · Paid social", status: "review", score: 84, facts: [{ label: "Budget", value: "£8,700" }, { label: "Approval", value: "Copy pending", tone: "warn" }, { label: "Rights", value: "31 Dec 2026" }], reason: "Visuals are approved, but final client copy approval is still pending.", evidenceIds: ["agency-approval", "agency-brief"] },
      { entityId: "asset-audio", name: "Creator audio edit", subtitle: "Morrow & Co · TikTok", status: "blocked", score: 57, facts: [{ label: "Budget", value: "£6,200" }, { label: "Approval", value: "Conditional", tone: "warn" }, { label: "Rights", value: "Expired", tone: "bad" }], reason: "The creator audio license expired and an updated agreement is unresolved.", evidenceIds: ["agency-rights"] },
    ],
    agents: [
      { id: "delivery-agent", name: "Delivery Coordinator", initials: "DC", purpose: "Preflights deliverables and proposes client-ready handoffs", scope: "Active engagements", permissions: ["assets:read", "handoffs:propose"], writeBudget: 16, riskCeiling: "medium" },
      { id: "rights-agent", name: "Rights Monitor", initials: "RM", purpose: "Tracks usage windows and blocks invalid activation", scope: "Agency", permissions: ["rights:read", "actions:hold"], writeBudget: 12, riskCeiling: "high" },
      { id: "performance-agent", name: "Outcome Analyst", initials: "OA", purpose: "Connects approved decisions to campaign performance", scope: "Client / Engagement", permissions: ["claims:read", "outcomes:propose"], writeBudget: 8, riskCeiling: "low" },
    ],
    changes: [
      { id: "agency-change-1", subject: "Social cutdown set", predicate: "approval_state", previous: "visual approval", next: "copy approval pending", source: "Client email · 10:31", sourceType: "private", severity: "medium", confidence: 0.97, impact: ["Paid social launch queue", "Delivery Coordinator context", "Friday client handoff"] },
      { id: "agency-change-2", subject: "Creator audio edit", predicate: "usage_rights", previous: "active until 31 Jul", next: "expired pending renewal", source: "Rights ledger", sourceType: "private", severity: "high", confidence: 1, impact: ["TikTok activation", "Media schedule", "Rights Monitor"] },
      { id: "agency-change-3", subject: "Morrow launch", predicate: "budget", previous: "£64,000", next: "£68,500 approved", source: "Signed change order", sourceType: "private", severity: "low", confidence: 1, impact: ["Engagement forecast", "Asset allocation"] },
    ],
    evidence: [
      { id: "agency-brief", title: "Morrow launch brief v6", source: "Client workspace", sourceType: "private", excerpt: "Hero film and social cutdowns launch this week subject to final copy approval and active paid-usage rights.", ...sharedEvidence },
      { id: "agency-rights", title: "Asset rights ledger", source: "Rights registry", sourceType: "private", excerpt: "Hero film usage is active through 31 December. Creator audio usage ended on 14 July pending renewal.", ...sharedEvidence },
      { id: "agency-approval", title: "Client review thread", source: "Email", sourceType: "private", excerpt: "The visual edit is approved. Please hold paid publishing until the revised product copy is signed off.", ...sharedEvidence },
    ],
    outcomeMetrics: [
      { key: "delivery_days", label: "Delivery time", unit: "days" },
      { key: "rework_hours", label: "Rework avoided", unit: "hours" },
      { key: "roas", label: "Return on ad spend", unit: "x" },
    ],
    graph: {
      nodes: [
        { id: "agency", label: "Threadline", kind: "Agency", x: 7, y: 44, tone: "blue" },
        { id: "client", label: "Morrow & Co", kind: "Client", x: 29, y: 44, tone: "violet" },
        { id: "engagement", label: "Summer launch", kind: "Engagement", x: 53, y: 44, tone: "yellow" },
        { id: "hero", label: "Hero film", kind: "Asset · ready", x: 76, y: 17, tone: "mint" },
        { id: "audio", label: "Creator audio", kind: "Asset · blocked", x: 77, y: 69, tone: "coral" },
        { id: "approval", label: "Client approval", kind: "Approval", x: 53, y: 78, tone: "ink" },
      ],
      edges: [
        { from: "agency", to: "client", label: "serves" },
        { from: "client", to: "engagement", label: "owns" },
        { from: "engagement", to: "hero", label: "delivers" },
        { from: "engagement", to: "audio", label: "delivers" },
        { from: "approval", to: "hero", label: "governs" },
      ],
    },
  },
  blank: {
    id: "blank",
    name: "Blank workspace",
    shortName: "Custom",
    eyebrow: "Build your operational model from first principles",
    description: "Start with Commonstate’s governed primitives and define your own vocabulary, policies, and outcomes.",
    audience: "Teams with a custom operating model",
    accent: "#0a0a0a",
    accentSoft: "#ebe4d4",
    scopeKinds: ["Company", "Area", "Workspace"],
    entityTypes: ["Record", "Decision", "Policy", "Actor", "Outcome"],
    predicates: ["owner", "status", "validity", "risk", "result"],
    metrics: [
      { label: "Truth health", value: "—", delta: "Connect a source", tone: "violet" },
      { label: "Approved claims", value: "0", delta: "Workspace is empty", tone: "mint" },
      { label: "Open conflicts", value: "0", delta: "No evidence ingested", tone: "coral" },
      { label: "Active agents", value: "1", delta: "Read-only starter identity", tone: "yellow" },
    ],
    guidedQuestion: "What can this workspace safely decide from its current approved evidence?",
    suggestedQuestions: ["What changed today?", "Which decisions are blocked?", "What evidence is expiring?"],
    candidates: [],
    agents: [
      { id: "starter_context_agent", name: "Starter Context Agent", initials: "SC", purpose: "Compiles cited context and records outcomes while the custom operating model is being configured", scope: "Company", permissions: ["get_context_pack", "get_evidence", "record_outcome"], writeBudget: 0, riskCeiling: "low" },
    ],
    changes: [],
    evidence: [],
    outcomeMetrics: [{ key: "result", label: "Result", unit: "value" }],
    graph: { nodes: [], edges: [] },
  },
};

export const solutionTemplates = Object.values(templatePacks);

export function isTemplateId(value: string): value is TemplateId {
  return value in templatePacks;
}

export function isSurfaceId(value: string): value is SurfaceId {
  return ["overview", "inbox", "map", "ask", "agents", "replay", "evals", "settings"].includes(value);
}

export function templateForWorkspace(slug: string): TemplatePack {
  const normalized = slug.toLowerCase();
  if (normalized.includes("govern") || normalized.includes("meridian")) return templatePacks["enterprise-governance"];
  if (normalized.includes("agency") || normalized.includes("threadline")) return templatePacks["agency-operations"];
  if (normalized.includes("blank") || normalized.includes("custom")) return templatePacks.blank;
  return templatePacks["ai-operations"];
}
