export type ViewId =
  | "overview"
  | "inbox"
  | "map"
  | "ask"
  | "agents"
  | "replay"
  | "evals";

export type WorkflowState = {
  asked: boolean;
  ingested: boolean;
  approved: boolean;
  agentRun: boolean;
  replayed: boolean;
  outcomeRecorded: boolean;
};

export type Evidence = {
  id: string;
  title: string;
  source: string;
  sourceType: "public" | "synthetic";
  excerpt: string;
  author: string;
  observedAt: string;
  validFrom: string;
  validUntil?: string;
  confidence: number;
  hash: string;
  claim: string;
  status: "approved" | "proposed" | "superseded" | "rejected";
};

export type ChangeProposal = {
  id: string;
  source: string;
  sourceType: "public" | "synthetic";
  sender: string;
  time: string;
  excerpt: string;
  subject: string;
  predicate: string;
  previous: string;
  next: string;
  scope: string;
  confidence: number;
  severity: "high" | "medium" | "low";
  status: "proposed" | "approved" | "rejected" | "superseded";
  evidenceId: string;
  impacts: string[];
};

export type CreatorAnswer = {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  tint: "coral" | "yellow" | "mint";
  budget: string;
  rights: string;
  deliverables: string;
  match: number;
  status: "eligible" | "blocked";
  reason: string;
  evidenceIds: string[];
};

export type EvalCase = {
  id: string;
  category: string;
  title: string;
  duration: string;
};

export type BackendCreator = {
  entityId: string;
  name: string;
  handle: string;
  eligible: boolean;
  feeGbp: number | null;
  rightsValidTo: string | null;
  whitelistingAuthorized: boolean;
  unresolvedDeliverables: boolean;
  blockers: string[];
  claimIds: string[];
};

export type BackendClaim = {
  id: string;
  subject: string;
  subjectEntityId: string;
  predicate: string;
  value: unknown;
  sourceId: string;
  sourceEventId: string | null;
  sourceSpan: string;
  sourceTitle: string;
  classification: "public" | "synthetic" | "private";
  lifecycle: "observed" | "proposed" | "approved" | "superseded" | "expired" | "rejected";
  authority: string;
  confidence: number;
  observedAt: string;
  validFrom: string;
  validTo: string | null;
  updatedAt: string;
};

export type BackendSource = {
  id: string;
  title: string;
  sourceType: string;
  classification: "public" | "synthetic" | "private";
  sha256: string;
  capturedAt: string;
  contentPreview?: string;
};

export type BackendContextPack = {
  id: string;
  versionHash: string;
  facts: Array<{ claimId: string; subject: string; predicate: string; value: unknown }>;
  citations: Array<{
    claimId: string;
    sourceId: string;
    sourceTitle: string;
    sourceSpan: string;
    classification: string;
    capturedAt: string;
  }>;
  blockers: string[];
  freshnessStatus: string;
  asOf: string;
};

export type BackendRun = {
  id: string;
  status: string;
  mode: string;
  task: string;
  contextPackId: string;
  contextVersionHash: string;
  model: string;
  modelVersion: string;
  promptVersion: string;
  tools: string[];
  decision: {
    actions?: Array<{
      entityId?: string;
      creator?: string;
      action?: string;
      reason?: string;
      claimIds?: string[];
      externalMutation?: boolean;
    }>;
    held?: Array<{
      entityId?: string;
      creator?: string;
      action?: string;
      blockers?: string[];
      claimIds?: string[];
      externalMutation?: boolean;
    }>;
    summary?: string;
    consequentialActionsExecuted?: number;
  };
  latencyMs: number;
  tokenUsage: number;
  costMicros: number;
  receiptHash: string;
  startedAt: string;
  completedAt: string | null;
  replayOfRunId: string | null;
};

export type BackendOutcome = {
  id: string;
  runId: string;
  status: string;
  metrics: Record<string, number>;
  notes: string;
  learningClaimId: string;
  receiptHash: string;
};

export type BackendState = {
  meta?: { dataPolicy?: string; demoNow?: string; workspaceId?: string };
  metrics: {
    truthHealth: number;
    approvedClaims: number;
    staleClaims: number;
    unresolvedConflicts: number;
    highRiskConflicts: number;
    activeAgents: number;
    invalidatedContextPacks: number;
    evalsPassed: number;
    evalsTotal: number;
  };
  sources: BackendSource[];
  claims: BackendClaim[];
  proposals: BackendClaim[];
  conflicts: Array<{
    id: string;
    subject: string;
    reason: string;
    risk: string;
    status: string;
    leftClaim?: BackendClaim | null;
    rightClaim?: BackendClaim | null;
  }>;
  contextPacks: BackendContextPack[];
  agentRuns: BackendRun[];
  outcomes: BackendOutcome[];
  eligibleCreators: BackendCreator[];
  blockedCreators: BackendCreator[];
  evals: {
    suite?: string;
    passed: number;
    total: number;
    durationMs?: number;
    results: Array<{
      id: string;
      category: string;
      caseName: string;
      passed: boolean;
      durationMs: number;
    }>;
  };
};

export type AskResult = {
  question: string;
  answer: string;
  asOf: string;
  contextPack: BackendContextPack;
  eligibleCreators: BackendCreator[];
  blockedCreators: BackendCreator[];
  citations: BackendContextPack["citations"];
  permissionScope: string;
};

export type IngestResult = {
  duplicate: boolean;
  quarantined?: boolean;
  sourceEventId: string;
  proposalIds?: string[];
  conflictIds?: string[];
  blastRadius?: {
    invalidatedContextPacks: number;
    scheduledAgentActionsHeld: number;
    affectedEntities: string[];
  };
  message?: string;
};

export type RunResult = {
  duplicate: boolean;
  run: BackendRun;
  contextPack: BackendContextPack;
  receipt?: unknown;
  message?: string;
};

export type ReplayResult = {
  replay: BackendRun;
  originalRun: BackendRun;
  comparison: {
    oldContextHash: string;
    currentContextHash: string;
    contextChanged: boolean;
    changedClaimIds: string[];
    nowBlocked: string[];
    summary: string;
  };
};

export type OutcomeResult = {
  duplicate: boolean;
  outcome: BackendOutcome;
  proposedLearning?: BackendClaim;
};

export const DEFAULT_QUESTION =
  "Which creators can launch whitelisted TikTok ads this week under £15k, with current rights and no unresolved deliverables?";

export const INGEST_TEXT =
  "Synthetic Slack update: Use a supportive, low-pressure rebrief. Amara's paid usage now ends 18 July and her revised hook is still unresolved. Hold paid activation until both are confirmed.";

export const initialWorkflow: WorkflowState = {
  asked: false,
  ingested: false,
  approved: false,
  agentRun: false,
  replayed: false,
  outcomeRecorded: false,
};

export const evidence: Evidence[] = [
  {
    id: "ev-amara-rights",
    title: "Amara Okafor · rights ledger",
    source: "Creator rights ledger · synthetic",
    sourceType: "synthetic",
    excerpt: "Paid usage and Spark Ads authorization valid through 31 Aug 2026.",
    author: "Synthetic contract ledger",
    observedAt: "15 Jul 2026 · seeded fixture",
    validFrom: "Seeded campaign state",
    validUntil: "31 Aug 2026",
    confidence: 1,
    hash: "sha256:fixture-rights-ledger",
    claim: "Amara Okafor has paid-usage rights through 31 Aug 2026.",
    status: "approved",
  },
  {
    id: "ev-amara-fee",
    title: "Amara Okafor · negotiated fee",
    source: "Creator rights ledger · synthetic",
    sourceType: "synthetic",
    excerpt: "Amara Okafor — negotiated creator fee: GBP 8,400. All contracted launch deliverables accepted.",
    author: "Synthetic contract ledger",
    observedAt: "15 Jul 2026 · seeded fixture",
    validFrom: "Seeded campaign state",
    confidence: 1,
    hash: "sha256:fixture-rights-ledger",
    claim: "Amara Okafor costs £8,400 and initially has no unresolved deliverables.",
    status: "approved",
  },
  {
    id: "ev-imani-rights",
    title: "Imani Brooks · creator record",
    source: "Creator rights ledger · synthetic",
    sourceType: "synthetic",
    excerpt: "Imani Brooks — negotiated creator fee: GBP 12,750. Paid usage and Spark Ads authorization valid through 15 Sep 2026.",
    author: "Synthetic contract ledger",
    observedAt: "15 Jul 2026 · seeded fixture",
    validFrom: "Seeded campaign state",
    validUntil: "15 Sep 2026",
    confidence: 1,
    hash: "sha256:fixture-rights-ledger",
    claim: "Imani Brooks is within budget with current rights and no unresolved deliverables.",
    status: "approved",
  },
  {
    id: "ev-jo-rights",
    title: "Jo Park · rights discrepancy",
    source: "Creator rights ledger + operator note · synthetic",
    sourceType: "synthetic",
    excerpt: "The signed ledger records paid usage through 15 Aug 2026; an operator note says the window may end 18 Jul 2026.",
    author: "Synthetic ledger and operator note",
    observedAt: "15 Jul 2026 · seeded fixture",
    validFrom: "Seeded campaign state",
    confidence: 0.78,
    hash: "sha256:fixture-jo-conflict",
    claim: "Jo Park's paid-usage window is unresolved and must fail closed.",
    status: "proposed",
  },
  {
    id: "ev-brief",
    title: "Summer TikTok campaign brief v4",
    source: "Campaign brief · synthetic",
    sourceType: "synthetic",
    excerpt: "TikTok only. Total creator fee below GBP 15,000. Paid usage and whitelisting rights must remain current through launch week.",
    author: "Synthetic campaign fixture",
    observedAt: "15 Jul 2026 · seeded fixture",
    validFrom: "Campaign start",
    confidence: 1,
    hash: "sha256:fixture-campaign-brief",
    claim: "Activation requires a fee below £15k, current rights, whitelisting, and clear deliverables.",
    status: "approved",
  },
  {
    id: "ev-slack-update",
    title: "#bloom-summer · operator update",
    source: "Synthetic Slack update",
    sourceType: "synthetic",
    excerpt: INGEST_TEXT,
    author: "Synthetic campaign operator",
    observedAt: "15 Jul 2026 · deterministic ingest",
    validFrom: "15 Jul 2026",
    confidence: 0.96,
    hash: "sha256:issued-by-api-on-ingest",
    claim: "Use a supportive rebrief; Amara's rights end 18 Jul and her revised hook is unresolved.",
    status: "proposed",
  },
  {
    id: "ev-case-study",
    title: "Tano × Bloom & Wild",
    source: "tano.ai public material",
    sourceType: "public",
    excerpt: "Public Tano material informs the creator-operations setting; all campaign records in this workspace are synthetic.",
    author: "Tano public website",
    observedAt: "15 Jul 2026 · public snapshot",
    validFrom: "15 Jul 2026",
    confidence: 0.95,
    hash: "sha256:public-snapshot",
    claim: "This independent concept uses public Tano context and visibly synthetic operational records.",
    status: "approved",
  },
];

export const baselineChanges: ChangeProposal[] = [
  {
    id: "change-brief",
    source: "Summer TikTok campaign brief v4",
    sourceType: "synthetic",
    sender: "Campaign fixture",
    time: "Seeded state",
    excerpt: "TikTok only. Total creator fee below GBP 15,000. Paid usage and whitelisting rights must remain current through launch week.",
    subject: "Summer TikTok Whitelisting",
    predicate: "campaign.creator_fee_cap_gbp",
    previous: "Company defaults",
    next: "Below £15,000 with current launch-week rights",
    scope: "Bloom & Wild / Summer TikTok",
    confidence: 1,
    severity: "medium",
    status: "approved",
    evidenceId: "ev-brief",
    impacts: ["Creator evaluation", "Relationship Agent"],
  },
];

const sharedSlackProposal = {
  source: "#bloom-summer · operator update",
  sourceType: "synthetic" as const,
  sender: "Synthetic campaign operator",
  time: "15 Jul · deterministic ingest",
  excerpt: INGEST_TEXT,
  scope: "Bloom & Wild / Summer TikTok",
  confidence: 0.96,
  evidenceId: "ev-slack-update",
  impacts: ["1 active context pack", "1 scheduled agent action"],
};

export const slackProposals: ChangeProposal[] = [
  {
    ...sharedSlackProposal,
    id: "change-slack-tone",
    subject: "Summer TikTok Whitelisting",
    predicate: "campaign.outreach_tone",
    previous: "Warm, direct, and no artificial urgency",
    next: "Supportive, low-pressure, with an explicit rebrief reason",
    severity: "medium",
    status: "proposed",
  },
  {
    ...sharedSlackProposal,
    id: "change-slack-amara-rights",
    subject: "Amara Okafor",
    predicate: "creator.paid_usage_valid_to",
    previous: "31 Aug 2026",
    next: "18 Jul 2026",
    severity: "high",
    status: "proposed",
  },
  {
    ...sharedSlackProposal,
    id: "change-slack-amara-delivery",
    subject: "Amara Okafor",
    predicate: "creator.unresolved_deliverables",
    previous: "No unresolved deliverables",
    next: "Revised hook unresolved",
    severity: "high",
    status: "proposed",
  },
];

export const slackProposal = slackProposals[0];

export const creators: CreatorAnswer[] = [
  {
    id: "amara",
    name: "Amara Okafor",
    handle: "@amara.makes",
    avatar: "AO",
    tint: "mint",
    budget: "£8,400",
    rights: "Active · 31 Aug",
    deliverables: "Clear",
    match: 98,
    status: "eligible",
    reason: "Within cap, current Spark Ads rights, and all launch deliverables accepted.",
    evidenceIds: ["ev-amara-rights", "ev-amara-fee"],
  },
  {
    id: "imani",
    name: "Imani Brooks",
    handle: "@imaniathome",
    avatar: "IB",
    tint: "yellow",
    budget: "£12,750",
    rights: "Active · 15 Sep",
    deliverables: "Clear",
    match: 96,
    status: "eligible",
    reason: "Within cap, current Spark Ads rights, and no unresolved launch deliverables.",
    evidenceIds: ["ev-imani-rights"],
  },
  {
    id: "jo",
    name: "Jo Park",
    handle: "@withjopark",
    avatar: "JP",
    tint: "coral",
    budget: "£11,900",
    rights: "Conflicted",
    deliverables: "Clear",
    match: 67,
    status: "blocked",
    reason: "Signed ledger and operator note disagree on launch-week paid usage; Commonstate fails closed.",
    evidenceIds: ["ev-jo-rights"],
  },
];

const evalCategories = ["Freshness", "Precedence", "Conflicts", "Permissions", "Citations", "Injection", "Writes", "Replay"] as const;
const evalTitles: Record<(typeof evalCategories)[number], string[]> = {
  Freshness: ["Expired claims excluded", "Stale claims flagged", "As-of replay stable"],
  Precedence: ["Campaign beats client", "Approved beats operator note", "Supersession is deterministic"],
  Conflicts: ["Rights conflict fails closed", "Payment conflict fails closed", "Dismissed conflict unblocks"],
  Permissions: ["Workspace rows isolated", "Agent write budget enforced", "Revoked actor denied"],
  Citations: ["Answers cite claims", "Receipts retain source spans", "Deleted source remains referenced"],
  Injection: ["Retrieved instructions ignored", "Malicious URL rejected", "Agent summary cannot self-attest"],
  Writes: ["Ingest idempotent", "Approval append-only", "Outcome receipt immutable"],
  Replay: ["Same hash reproduces", "Changed fact creates new hash", "Blocked action surfaced"],
};

export const evalCases: EvalCase[] = evalCategories.flatMap((category, group) =>
  evalTitles[category].map((title, index) => ({
    id: `eval-${group + 1}-${index + 1}`,
    category,
    title,
    duration: `${8 + ((group * 3 + index + 1) * 7) % 31}ms`,
  })),
);

export const navItems: { id: ViewId; label: string; short: string }[] = [
  { id: "overview", label: "Overview", short: "OV" },
  { id: "inbox", label: "Change inbox", short: "CI" },
  { id: "map", label: "Memory map", short: "MM" },
  { id: "ask", label: "Ask Commonstate", short: "AQ" },
  { id: "agents", label: "Agent console", short: "AC" },
  { id: "replay", label: "Replay", short: "RP" },
  { id: "evals", label: "Evals", short: "EV" },
];

export const workflowSteps: { key: keyof WorkflowState; label: string; target: ViewId }[] = [
  { key: "asked", label: "Ask for eligible creators", target: "ask" },
  { key: "ingested", label: "Ingest operator update", target: "inbox" },
  { key: "approved", label: "Approve all new truth", target: "inbox" },
  { key: "agentRun", label: "Run Relationship Agent", target: "agents" },
  { key: "replayed", label: "Replay against new state", target: "replay" },
  { key: "outcomeRecorded", label: "Record campaign outcome", target: "replay" },
];
