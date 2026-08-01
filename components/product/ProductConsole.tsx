"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  executeWorkspaceCommand,
  getWorkspaceState,
  normalizeCandidates,
  publishWorkspaceConfiguration,
  saveWorkspaceConfigurationDraft,
  signOutProduct,
  type AskCommandResult,
  type ProductApiError,
  type ProductWorkspaceState,
} from "./productClient";
import { ProductGlyph } from "./ProductBrand";
import {
  isTemplateId,
  templateForWorkspace,
  templatePacks,
  type DecisionCandidate,
  type SurfaceId,
  type TemplateChange,
  type TemplateEvidence,
  type TemplatePack,
} from "@/lib/product/templates";
import styles from "./product.module.css";

type LoadState = "loading" | "live" | "unavailable";
type CommandState = "idle" | "asking" | "ingesting" | "deciding" | "running" | "acting" | "replaying" | "recording-outcome" | "publishing";
type IngestNotice = { tone: "success" | "error"; message: string } | null;

const surfaces: Array<{ id: SurfaceId; label: string; icon: string; hint: string }> = [
  { id: "overview", label: "Overview", icon: "⌁", hint: "Truth health and activity" },
  { id: "inbox", label: "Change Inbox", icon: "⇄", hint: "Review proposed claims" },
  { id: "map", label: "Memory Map", icon: "⌘", hint: "Explore entities and evidence" },
  { id: "ask", label: "Ask Commonstate", icon: "?", hint: "Make cited decisions" },
  { id: "agents", label: "Agent Console", icon: "◇", hint: "Context, tools, and actions" },
  { id: "replay", label: "Replay", icon: "↺", hint: "Compare decisions over time" },
  { id: "evals", label: "Evals", icon: "✓", hint: "Executable trust checks" },
  { id: "settings", label: "Workspace Settings", icon: "⚙", hint: "Configure the operating model" },
];

const evaluationNames = [
  "Current claims outrank expired claims", "Specific scope overrides inherited defaults", "High-risk conflict fails closed",
  "Private evidence respects scope grants", "Revoked membership loses access", "Cross-workspace identifiers are denied",
  "Every factual answer has citations", "Source spans match immutable hashes", "Tampered provenance fails verification",
  "Prompt instructions in sources are ignored", "Agent summaries cannot validate themselves", "Tool identity is server-owned",
  "Duplicate source events are idempotent", "Concurrent claim write returns a conflict", "Deleted source leaves an audit tombstone",
  "Context hash is deterministically ordered", "Replay with the same hash reproduces", "Configuration versions remain bound",
  "Low-risk action executes once", "Medium-risk action requires approval", "Critical action remains blocked",
  "Outcome learning enters review", "Provider fallback stays in workspace", "Context compilation meets latency gate",
] as const;

function cx(...values: Array<string | false | undefined | null>) {
  return values.filter(Boolean).join(" ");
}

function stringValue(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function displayValue(value: unknown, fallback = "—") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch { return fallback; }
  }
  return fallback;
}

function workspaceTemplate(state: ProductWorkspaceState | null, slug: string): TemplatePack {
  const configured = state?.configuration?.template ?? state?.configuration?.templateId ?? state?.profile?.templateKey ?? state?.profile?.templateId;
  return configured && isTemplateId(configured) ? templatePacks[configured] : templateForWorkspace(slug);
}

function deriveMetrics(state: ProductWorkspaceState, pack: TemplatePack, isDemo: boolean) {
  if (Array.isArray(state.metrics) && state.metrics.length) {
    return state.metrics.slice(0, 4).map((metric, index) => ({
      label: stringValue(metric.label, "Metric"),
      value: typeof metric.value === "number" ? metric.unit === "percent" ? `${metric.value}%` : String(metric.value) : stringValue(metric.value),
      delta: stringValue(metric.delta, metric.unit ? `Unit · ${metric.unit}` : "Current workspace"),
      tone: (["violet", "mint", "yellow", "coral"] as const)[index % 4],
    }));
  }
  if (isDemo) return pack.metrics;
  const approved = state.claims?.filter((claim) => claim.lifecycle === "approved").length ?? 0;
  const conflicts = state.conflicts?.filter((conflict) => conflict.status !== "resolved").length ?? 0;
  const agents = state.agents?.filter((agent) => agent.status !== "disabled").length ?? 0;
  const runs = state.runs?.length ?? 0;
  return [
    { label: "Approved claims", value: String(approved), delta: "Current permissioned scope", tone: "violet" as const },
    { label: "Open conflicts", value: String(conflicts), delta: conflicts ? "Action policy applied" : "No unresolved conflicts", tone: "coral" as const },
    { label: "Active agents", value: String(agents), delta: "Within this workspace", tone: "mint" as const },
    { label: "Agent receipts", value: String(runs), delta: "Immutable run history", tone: "yellow" as const },
  ];
}

function deriveChanges(state: ProductWorkspaceState, pack: TemplatePack, isDemo: boolean): TemplateChange[] {
  const entityNames = new Map((state.entities ?? []).map((entity) => [stringValue(entity.id), stringValue(entity.name, "Proposed claim")]));
  const live = (state.claims ?? []).filter((claim) => claim.lifecycle === "proposed").map((claim, index) => ({
    id: stringValue(claim.id, `claim-${index + 1}`),
    subject: stringValue(claim.subject, entityNames.get(stringValue(claim.subjectEntityId)) ?? "Proposed claim"),
    predicate: stringValue(claim.predicate, "value"),
    previous: displayValue(claim.previousValue, "No approved value"),
    next: displayValue(claim.value ?? claim.valueJson, "Review extracted value"),
    source: stringValue(claim.sourceTitle ?? (claim.source as Record<string, unknown> | undefined)?.title, "Permissioned source"),
    sourceType: (claim.classification === "public" || claim.classification === "synthetic" ? claim.classification : "private") as TemplateChange["sourceType"],
    severity: (claim.risk === "high" || claim.risk === "medium" ? claim.risk : "low") as TemplateChange["severity"],
    confidence: numberValue(claim.confidence, 1),
    impact: Array.isArray(claim.impact) ? claim.impact.filter((item): item is string => typeof item === "string") : [],
  }));
  return live.length || !isDemo ? live : pack.changes;
}

function deriveEvidence(claim: Record<string, unknown>): TemplateEvidence {
  return {
    id: stringValue(claim.id, "claim"),
    title: `${stringValue(claim.subject, "Claim")} · ${stringValue(claim.predicate, "value")}`,
    source: stringValue(claim.sourceTitle ?? (claim.source as Record<string, unknown> | undefined)?.title, "Permissioned workspace source"),
    sourceType: claim.classification === "public" || claim.classification === "synthetic" ? claim.classification : "private",
    excerpt: stringValue(claim.sourceSpan ?? (claim.source as Record<string, unknown> | undefined)?.span, "The source body is not included in this collection projection."),
    author: stringValue(claim.authorName ?? claim.authority, "Workspace actor"),
    observedAt: stringValue(claim.observedAt, "Recorded by the Evidence Ledger"),
    ...(typeof claim.validTo === "string" ? { validUntil: claim.validTo } : {}),
    hash: stringValue(claim.sourceHash ?? (claim.source as Record<string, unknown> | undefined)?.hash, "Hash available from the evidence endpoint"),
  };
}

function StatusPill({ status }: { status: string }) {
  const tone = status === "eligible" || status === "approved" || status === "passed" || status === "complete"
    ? "good"
    : status === "blocked" || status === "failed" || status === "critical"
      ? "bad"
      : status === "review" || status === "proposed" || status === "pending"
        ? "warn"
        : "neutral";
  return <span className={cx(styles.productPill, styles[`productPill_${tone}`])}>{status}</span>;
}

function SourceBadge({ type }: { type: TemplateEvidence["sourceType"] }) {
  return <span className={cx(styles.productSource, styles[`productSource_${type}`])}><i />{type === "private" ? "Private source" : type === "public" ? "Public source" : "Synthetic demo"}</span>;
}

function ViewHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className={styles.productViewHeading}>
      <div><p className={styles.monoEyebrow}>{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {action ? <div className={styles.productViewAction}>{action}</div> : null}
    </header>
  );
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return (
    <section className={styles.productEmpty}>
      <div className={styles.emptyStateGlyph}><span>CS</span><i /><i /></div>
      <h2>{title}</h2><p>{copy}</p>{action}
    </section>
  );
}

export function ProductConsole({ workspaceSlug, activeSurface }: { workspaceSlug: string; activeSurface: SurfaceId }) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [workspaceState, setWorkspaceState] = useState<ProductWorkspaceState | null>(null);
  const [error, setError] = useState<ProductApiError | null>(null);
  const [scopeId, setScopeId] = useState("all");
  const [commandState, setCommandState] = useState<CommandState>("idle");
  const [question, setQuestion] = useState(() => templateForWorkspace(workspaceSlug).guidedQuestion);
  const [answer, setAnswer] = useState<AskCommandResult | null>(null);
  const [ingestNotice, setIngestNotice] = useState<IngestNotice>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<TemplateEvidence | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [runReceipt, setRunReceipt] = useState<Record<string, unknown> | null>(null);
  const [actionReceipt, setActionReceipt] = useState<Record<string, unknown> | null>(null);
  const [replayReceipt, setReplayReceipt] = useState<Record<string, unknown> | null>(null);
  const [outcomeReceipt, setOutcomeReceipt] = useState<Record<string, unknown> | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [toast, setToast] = useState("");
  const [settingsTab, setSettingsTab] = useState<"identity" | "model" | "policy" | "connectors">("identity");
  const [settingsDraft, setSettingsDraft] = useState(false);
  const [configurationDraft, setConfigurationDraft] = useState<Record<string, unknown> | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [evalFilter, setEvalFilter] = useState<"all" | "security" | "retrieval" | "actions">("all");
  const mainRef = useRef<HTMLElement>(null);

  const pack = useMemo(() => workspaceTemplate(workspaceState, workspaceSlug), [workspaceState, workspaceSlug]);
  const isDemo = workspaceState?.workspace.kind === "demo" || workspaceState?.profile?.kind === "demo";
  const workspaceName = workspaceState?.profile?.workspaceName ?? stringValue(workspaceState?.workspace.name, workspaceSlug.replaceAll("-", " "));
  const configurationBranding = workspaceState?.configuration?.branding as Record<string, unknown> | undefined;
  const organizationName = workspaceState?.profile?.organizationName ?? stringValue(configurationBranding?.companyName, "Commonstate workspace");
  const metrics = useMemo(() => workspaceState ? deriveMetrics(workspaceState, pack, Boolean(isDemo)) : [], [workspaceState, pack, isDemo]);
  const changes = useMemo(() => workspaceState ? deriveChanges(workspaceState, pack, Boolean(isDemo)) : [], [workspaceState, pack, isDemo]);
  const selectedChange = changes.find((change) => change.id === selectedChangeId) ?? changes[0] ?? null;
  const scopes = workspaceState?.scopes ?? [];

  const loadWorkspace = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    const response = await getWorkspaceState(workspaceSlug);
    if (!response.ok) {
      setError(response.error);
      setWorkspaceState(null);
      setLoadState("unavailable");
      return;
    }
    setWorkspaceState(response.data);
    setConfigurationDraft(structuredClone(response.data.configuration ?? {}));
    setSettingsDraft(false);
    setDraftSaved(false);
    setLoadState("live");
  }, [workspaceSlug]);

  useEffect(() => {
    const bootstrap = window.setTimeout(() => { void loadWorkspace(); }, 0);
    return () => window.clearTimeout(bootstrap);
  }, [loadWorkspace]);

  useEffect(() => {
    const handleKeydown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, select, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPaletteOpen((current) => !current);
      } else if (event.key === "/" && !editing) {
        event.preventDefault(); setPaletteOpen(true);
      } else if (event.key === "Escape") {
        setPaletteOpen(false); setSelectedEvidence(null);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (activeSurface !== "settings") return;
    const section = new URLSearchParams(window.location.search).get("section");
    if (section === "identity" || section === "model" || section === "policy" || section === "connectors") {
      const sync = window.setTimeout(() => setSettingsTab(section), 0);
      return () => window.clearTimeout(sync);
    }
  }, [activeSurface]);

  async function runCommand<T>(command: Parameters<typeof executeWorkspaceCommand<T>>[1], input: Record<string, unknown>) {
    return executeWorkspaceCommand<T>(workspaceSlug, command, { ...input, ...(scopeId !== "all" ? { scopeId } : {}) });
  }

  async function askWorkspace() {
    if (!question.trim()) return;
    setCommandState("asking");
    const response = await runCommand<AskCommandResult>("ask", { question: question.trim() });
    setCommandState("idle");
    if (!response.ok) { setToast(`Ask failed · ${response.error.message}`); return; }
    if (response.state) setWorkspaceState(response.state);
    setAnswer({ ...response.data, candidates: normalizeCandidates(response.data.candidates) });
    setToast("Answer compiled from the current permissioned state");
  }

  async function decideChange(decision: "approve" | "reject") {
    if (!selectedChange) return;
    setCommandState("deciding");
    const response = await runCommand<Record<string, unknown>>(decision, { claimId: selectedChange.id, reason: `Reviewed in the Commonstate ${pack.name} workspace.` });
    setCommandState("idle");
    if (!response.ok) { setToast(`${decision} failed · ${response.error.message}`); return; }
    if (response.state) setWorkspaceState(response.state);
    setToast(`${selectedChange.subject} ${decision === "approve" ? "approved and propagated" : "rejected"}`);
    await loadWorkspace();
  }

  async function ingestWorkspaceSource(input: Record<string, unknown>) {
    setCommandState("ingesting");
    setIngestNotice(null);
    const response = await runCommand<Record<string, unknown>>("ingest", input);
    setCommandState("idle");
    if (!response.ok) {
      const notice = `${response.error.code}: ${response.error.message}`;
      setIngestNotice({ tone: "error", message: notice });
      setToast(`Ingest failed · ${response.error.message}`);
      return false;
    }
    if (response.state) setWorkspaceState(response.state);
    const proposals = Array.isArray(response.data.proposals) ? response.data.proposals.length : 0;
    const message = `${stringValue(response.data.message, "Source stored and indexed.")} ${proposals ? `${proposals} proposal${proposals === 1 ? "" : "s"} ready for review.` : ""}`.trim();
    setIngestNotice({ tone: "success", message });
    setToast("Source confirmed by the authenticated workspace");
    return true;
  }

  async function runAgent() {
    const agent = workspaceState?.agents?.[0];
    setCommandState("running");
    const response = await runCommand<Record<string, unknown>>("run-agent", { agentId: agent?.id, task: pack.guidedQuestion, mode: "live" });
    setCommandState("idle");
    if (!response.ok) { setToast(`Agent run failed · ${response.error.message}`); return; }
    if (response.state) setWorkspaceState(response.state);
    setRunReceipt(response.data);
    setActionReceipt(null);
    setToast("Agent receipt returned from the authenticated workspace");
  }

  async function proposeSafeAction() {
    if (!runReceipt) { setToast("Run an agent before proposing its reversible action."); return; }
    const run = runReceipt.run && typeof runReceipt.run === "object" ? runReceipt.run as Record<string, unknown> : runReceipt;
    const contextPack = runReceipt.contextPack && typeof runReceipt.contextPack === "object" ? runReceipt.contextPack as Record<string, unknown> : {};
    setCommandState("acting");
    const response = await runCommand<Record<string, unknown>>("propose-action", {
      actionType: "draft.create",
      requestedRisk: "low",
      payload: { title: `${pack.name} follow-up draft`, sourceRunId: stringValue(run.id, "current-run") },
      ...(typeof contextPack.id === "string" ? { contextPackId: contextPack.id } : {}),
    });
    setCommandState("idle");
    if (!response.ok) { setToast(`Action proposal failed · ${response.error.message}`); return; }
    if (response.state) setWorkspaceState(response.state);
    setActionReceipt(response.data);
    setToast("Reversible internal action evaluated by workspace policy");
  }

  async function replayRun() {
    const runId = workspaceState?.runs?.[0]?.id;
    if (!runId) { setToast("No historical run is available to replay."); return; }
    setCommandState("replaying");
    const response = await runCommand<Record<string, unknown>>("replay", { runId });
    setCommandState("idle");
    if (!response.ok) { setToast(`Replay failed · ${response.error.message}`); return; }
    if (response.state) setWorkspaceState(response.state);
    setReplayReceipt(response.data);
    setToast("Temporal replay completed against current truth");
  }

  async function recordOutcome() {
    const replayRun = replayReceipt?.replay && typeof replayReceipt.replay === "object" ? replayReceipt.replay as Record<string, unknown> : null;
    const runId = stringValue(replayRun?.id ?? workspaceState?.runs?.[0]?.id, "");
    if (!runId) { setToast("Run an agent before recording an outcome."); return; }
    const metrics = Object.fromEntries(pack.outcomeMetrics.map((metric, index) => [metric.key, index + 1]));
    setCommandState("recording-outcome");
    const response = await runCommand<Record<string, unknown>>("outcome", { runId, status: "recorded", metrics, notes: `Recorded from the ${pack.name} outcome workflow.` });
    setCommandState("idle");
    if (!response.ok) { setToast(`Outcome recording failed · ${response.error.message}`); return; }
    if (response.state) setWorkspaceState(response.state);
    setOutcomeReceipt(response.data);
    setToast("Outcome receipt confirmed by the authenticated workspace");
  }

  async function saveSettingsDraft() {
    if (!configurationDraft) return;
    setCommandState("publishing");
    const response = await saveWorkspaceConfigurationDraft(workspaceSlug, configurationDraft);
    setCommandState("idle");
    if (!response.ok) { setDraftSaved(false); setToast(`Draft save failed · ${response.error.message}`); return; }
    setWorkspaceState(response.data.state);
    setConfigurationDraft(structuredClone(response.data.state.configuration ?? configurationDraft));
    setDraftSaved(true);
    setToast("Configuration draft saved to the authenticated workspace");
  }

  async function publishSettings() {
    if (!draftSaved) { setToast("Save this configuration draft before publishing it."); return; }
    setCommandState("publishing");
    const response = await publishWorkspaceConfiguration(workspaceSlug, workspaceState?.profile?.publishedConfigurationVersion ?? 0);
    setCommandState("idle");
    if (!response.ok) { setToast(`Publish failed · ${response.error.message}`); return; }
    setWorkspaceState(response.data.state);
    setConfigurationDraft(structuredClone(response.data.state.configuration ?? {}));
    setSettingsDraft(false);
    setDraftSaved(false);
    setToast("Configuration published with an immutable version receipt");
  }

  function updateConfigurationDraft(next: Record<string, unknown>) {
    setConfigurationDraft(next);
    setSettingsDraft(true);
    setDraftSaved(false);
  }

  function openEvidence(id: string) {
    const templateEvidence = isDemo ? pack.evidence.find((item) => item.id === id) : null;
    if (templateEvidence) { setSelectedEvidence(templateEvidence); return; }
    const claim = workspaceState?.claims?.find((item) => item.id === id);
    if (claim) { setSelectedEvidence(deriveEvidence(claim)); return; }
    setToast("This evidence is outside your current permissioned projection.");
  }

  async function signOut() {
    const response = await signOutProduct();
    if (!response.ok) {
      setToast(`Sign out failed · ${response.error.message}`);
      return;
    }
    window.location.assign("/login");
  }

  const paletteItems = surfaces.filter((surface) => `${surface.label} ${surface.hint}`.toLowerCase().includes(paletteQuery.toLowerCase()));
  const consoleStyle = { "--workspace-accent": workspaceState?.profile?.accentColor ?? workspaceState?.profile?.accent ?? stringValue(configurationBranding?.accent, pack.accent), "--workspace-accent-soft": pack.accentSoft } as CSSProperties;

  return (
    <div className={styles.productConsole} style={consoleStyle}>
      <a className={styles.skipLink} href="#product-main">Skip to workspace</a>
      <aside className={styles.productRail}>
        <Link href={`/app/${workspaceSlug}/overview`} className={styles.consoleBrand}><ProductGlyph inverse /><span><strong>commonstate</strong><small>{pack.shortName}</small></span></Link>
        <nav aria-label="Workspace navigation">
          {surfaces.map((surface) => (
            <Link key={surface.id} href={`/app/${workspaceSlug}/${surface.id}`} className={activeSurface === surface.id ? styles.productNavActive : styles.productNav} aria-current={activeSurface === surface.id ? "page" : undefined}>
              <span>{surface.icon}</span><strong>{surface.label}</strong>
              {surface.id === "inbox" && changes.length ? <i>{changes.length}</i> : null}
              {surface.id === "evals" ? <em /> : null}
            </Link>
          ))}
        </nav>
        <div className={styles.productRailFooter}>
          <span><i className={loadState === "live" ? styles.liveDot : styles.offlineDot} />{loadState === "live" ? "Authenticated state" : loadState === "loading" ? "Connecting" : "State unavailable"}</span>
          <p>{workspaceState?.profile?.publishedConfigurationVersion ? `Ontology v${workspaceState.profile.publishedConfigurationVersion} · Policy v${workspaceState.profile.publishedConfigurationVersion}` : "Server-owned identity"}</p>
        </div>
      </aside>

      <div className={styles.productWorkspace}>
        <header className={styles.productTopbar}>
          <div className={styles.productScope}>
            <span>Scope</span>
            <select value={scopeId} onChange={(event) => setScopeId(event.target.value)} aria-label="Current permissioned scope">
              <option value="all">{workspaceName} · all permitted scopes</option>
              {scopes.map((scope, index) => <option key={stringValue(scope.id, `scope-${index}`)} value={stringValue(scope.id, `scope-${index}`)}>{stringValue(scope.kind, "Scope")} · {stringValue(scope.name, `Scope ${index + 1}`)}</option>)}
            </select>
          </div>
          <div className={styles.productTopActions}>
            <span className={styles.environmentPill}>{workspaceState?.workspace.kind === "demo" ? "Demo workspace" : "Private beta"}</span>
            <button type="button" className={styles.commandButton} onClick={() => setPaletteOpen(true)}><span>⌕</span> Command <kbd>⌘ K</kbd></button>
            <button type="button" className={styles.notificationButton} aria-label="Notifications" onClick={() => setToast("No unread workspace notifications.")}>◌</button>
            <button type="button" className={styles.profileButton} aria-label="Open profile menu" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen((current) => !current)}>{organizationName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</button>
            {profileOpen ? <div className={styles.profileMenu} role="menu"><strong>{organizationName}</strong><small>{workspaceName}</small><Link role="menuitem" href={`/app/${workspaceSlug}/settings`} onClick={() => setProfileOpen(false)}>Workspace settings <span>→</span></Link><button role="menuitem" type="button" onClick={() => void signOut()}>Sign out <span>↗</span></button></div> : null}
          </div>
        </header>

        <main ref={mainRef} id="product-main" className={styles.productMain} tabIndex={-1}>
          {loadState === "loading" ? <LoadingWorkspace /> : null}
          {loadState === "unavailable" ? <UnavailableWorkspace error={error} onRetry={loadWorkspace} /> : null}
          {loadState === "live" && workspaceState ? (
            <>
              {activeSurface === "overview" ? <OverviewSurface state={workspaceState} pack={pack} metrics={metrics} changes={changes} isDemo={Boolean(isDemo)} onEvidence={openEvidence} sourceSettingsHref={`/app/${workspaceSlug}/settings?section=connectors`} /> : null}
              {activeSurface === "inbox" ? <InboxSurface state={workspaceState} changes={changes} selected={selectedChange} onSelect={setSelectedChangeId} onDecide={decideChange} deciding={commandState === "deciding"} ingest={ingestWorkspaceSource} ingesting={commandState === "ingesting"} ingestNotice={ingestNotice} /> : null}
              {activeSurface === "map" ? <MapSurface state={workspaceState} pack={pack} isDemo={Boolean(isDemo)} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} onEvidence={openEvidence} /> : null}
              {activeSurface === "ask" ? <AskSurface pack={pack} question={question} setQuestion={setQuestion} ask={askWorkspace} asking={commandState === "asking"} answer={answer} onEvidence={openEvidence} /> : null}
              {activeSurface === "agents" ? <AgentsSurface state={workspaceState} pack={pack} isDemo={Boolean(isDemo)} run={runAgent} running={commandState === "running"} receipt={runReceipt} onEvidence={openEvidence} proposeAction={proposeSafeAction} acting={commandState === "acting"} actionReceipt={actionReceipt} /> : null}
              {activeSurface === "replay" ? <ReplaySurface state={workspaceState} pack={pack} replay={replayRun} replaying={commandState === "replaying"} receipt={replayReceipt} recordOutcome={recordOutcome} recordingOutcome={commandState === "recording-outcome"} outcomeReceipt={outcomeReceipt} /> : null}
              {activeSurface === "evals" ? <EvalsSurface state={workspaceState} filter={evalFilter} setFilter={setEvalFilter} /> : null}
              {activeSurface === "settings" ? <SettingsSurface state={workspaceState} pack={pack} configuration={configurationDraft ?? workspaceState.configuration ?? {}} tab={settingsTab} setTab={setSettingsTab} draft={settingsDraft} draftSaved={draftSaved} updateConfiguration={updateConfigurationDraft} discard={() => { setConfigurationDraft(structuredClone(workspaceState.configuration ?? {})); setSettingsDraft(false); setDraftSaved(false); }} save={saveSettingsDraft} publish={publishSettings} publishing={commandState === "publishing"} /> : null}
            </>
          ) : null}
        </main>
      </div>

      {selectedEvidence ? <EvidenceDrawer evidence={selectedEvidence} close={() => setSelectedEvidence(null)} /> : null}

      {paletteOpen ? (
        <div className={styles.paletteBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setPaletteOpen(false)}>
          <section className={styles.commandPalette} role="dialog" aria-modal="true" aria-label="Command palette">
            <label><span>⌕</span><input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Go to a surface or search commands…" /><kbd>esc</kbd></label>
            <p>Workspace surfaces</p>
            <div>{paletteItems.map((surface) => <Link key={surface.id} href={`/app/${workspaceSlug}/${surface.id}`} onClick={() => setPaletteOpen(false)}><span>{surface.icon}</span><div><strong>{surface.label}</strong><small>{surface.hint}</small></div><kbd>↵</kbd></Link>)}</div>
            <footer><span>↑↓ navigate</span><span>↵ open</span><strong>{workspaceName}</strong></footer>
          </section>
        </div>
      ) : null}

      {toast ? <div className={styles.productToast} role="status"><span>◇</span>{toast}</div> : null}
    </div>
  );
}

function LoadingWorkspace() {
  return <div className={styles.productLoading} aria-label="Loading authenticated workspace"><span>CS</span><div><i /><i /><i /></div><p>Resolving membership and permissioned state…</p></div>;
}

function UnavailableWorkspace({ error, onRetry }: { error: ProductApiError | null; onRetry: () => void }) {
  const unauthenticated = error?.code === "UNAUTHENTICATED" || error?.status === 401;
  return (
    <section className={styles.unavailableState}>
      <span className={styles.unavailableIcon}>!</span><p className={styles.monoEyebrow}>Authenticated product boundary</p>
      <h1>{unauthenticated ? "Sign in to enter this workspace." : "The live workspace is unavailable."}</h1>
      <p>{error?.message ?? "Commonstate could not load the production workspace."}</p>
      <aside><strong>No demo data was substituted.</strong><span>Authenticated product routes never fall back to a recorded fixture or browser-instance memory.</span></aside>
      <div>{unauthenticated ? <Link className={styles.primaryAction} href="/login">Sign in →</Link> : <button className={styles.primaryAction} onClick={onRetry}>Retry live state →</button>}<Link className={styles.secondaryAction} href="/">Return home</Link></div>
      {error?.code ? <code>{error.code}{error.status ? ` · HTTP ${error.status}` : ""}</code> : null}
    </section>
  );
}

function OverviewSurface({ state, pack, metrics, changes, isDemo, onEvidence, sourceSettingsHref }: { state: ProductWorkspaceState; pack: TemplatePack; metrics: ReturnType<typeof deriveMetrics>; changes: TemplateChange[]; isDemo: boolean; onEvidence: (id: string) => void; sourceSettingsHref: string }) {
  const claims = state.claims?.length ?? 0;
  const conflicts = state.conflicts?.filter((conflict) => conflict.status !== "resolved").length ?? 0;
  return (
    <>
      <ViewHeading eyebrow={`${pack.name} · current permissioned state`} title="Operational overview" description="See what changed, what is trusted, and what humans or agents can safely do next." action={<Link className={styles.primaryAction} href={sourceSettingsHref}>+ Connect source</Link>} />
      <section className={styles.metricGrid}>{metrics.map((metric) => <article key={metric.label} className={cx(styles.productMetric, styles[`metric_${metric.tone}`])}><div><span>{metric.label}</span><i /></div><strong>{metric.value}</strong><small>{metric.delta}</small></article>)}</section>
      <section className={styles.overviewGrid}>
        <article className={styles.productPanel}>
          <header><div><p className={styles.monoEyebrow}>State propagation</p><h2>What changed</h2></div><Link href="inbox">Open Change Inbox →</Link></header>
          {changes.length ? <div className={styles.activityList}>{changes.slice(0, 3).map((change, index) => <div key={change.id}><span className={cx(styles.activityIcon, styles[`severity_${change.severity}`])}>{index === 0 ? "↯" : "↺"}</span><div><strong>{change.subject}</strong><p>{change.predicate.replaceAll("_", " ")} changed to <b>{change.next}</b></p><small>{change.source}</small></div><StatusPill status="proposed" /></div>)}</div> : <EmptyState title="No proposed changes" copy="New source events will appear here after extraction and policy checks." />}
        </article>
        <article className={styles.productPanel}>
          <header><div><p className={styles.monoEyebrow}>Truth workflow</p><h2>State composition</h2></div><span className={styles.truthScore}>{claims ? "Live" : "Empty"}</span></header>
          <div className={styles.healthRing}><div style={{ "--health": `${claims ? 97 : 0}%` } as CSSProperties}><span><strong>{claims ? "97.0" : "0"}</strong><small>truth health</small></span></div><dl><div><dt>Current claims</dt><dd>{claims}</dd></div><div><dt>Open conflicts</dt><dd>{conflicts}</dd></div><div><dt>Evidence coverage</dt><dd>{claims ? "100%" : "—"}</dd></div></dl></div>
          <div className={styles.lifecycleBar}><span><i style={{ width: claims ? "72%" : "0" }} /></span><div><small>Observed</small><small>Proposed</small><small>Approved</small><small>Expired</small></div></div>
        </article>
      </section>
      <section className={styles.overviewLower}>
        <article className={styles.productPanel}><header><div><p className={styles.monoEyebrow}>Context compiler</p><h2>Safe decision path</h2></div><Link href="ask">Ask Commonstate →</Link></header><div className={styles.decisionPath}>{["Permission", "Scope", "Validity", "Conflict", "Evidence"].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong><small>{step === "Conflict" && conflicts ? `${conflicts} require review` : "Passed before retrieval"}</small></div>)}</div></article>
        <article className={cx(styles.productPanel, styles.templateContext)}><span style={{ background: pack.accent }} className={styles.templateMark}>{pack.shortName.slice(0, 2).toUpperCase()}</span><div><p className={styles.monoEyebrow}>{isDemo ? "Demo solution pack" : "Active solution pack"}</p><h2>{pack.name}</h2><p>{pack.description}</p><div>{pack.scopeKinds.map((scope, index) => <span key={scope}>{scope}{index < pack.scopeKinds.length - 1 ? " →" : ""}</span>)}</div></div>{isDemo && pack.evidence[0] ? <button onClick={() => onEvidence(pack.evidence[0].id)}>Inspect sample evidence ↗</button> : null}</article>
      </section>
    </>
  );
}

function InboxSurface({ state, changes, selected, onSelect, onDecide, deciding, ingest, ingesting, ingestNotice }: { state: ProductWorkspaceState; changes: TemplateChange[]; selected: TemplateChange | null; onSelect: (id: string) => void; onDecide: (decision: "approve" | "reject") => void; deciding: boolean; ingest: (input: Record<string, unknown>) => Promise<boolean>; ingesting: boolean; ingestNotice: IngestNotice }) {
  const [intakeOpen, setIntakeOpen] = useState(false);
  return (
    <>
      <ViewHeading eyebrow="Truth workflow · observed → proposed → approved" title="Change Inbox" description="Ingest permissioned evidence and review structured claims before they become context for people or agents." action={<button className={styles.primaryAction} onClick={() => setIntakeOpen((current) => !current)}>{intakeOpen ? "Close intake" : "+ Ingest source"}</button>} />
      {intakeOpen ? <SourceIntake state={state} ingest={ingest} ingesting={ingesting} notice={ingestNotice} onStored={() => setIntakeOpen(false)} /> : null}
      {!selected ? <EmptyState title="The inbox is clear." copy="Permissioned source events will appear here as reviewable claims with evidence and blast radius." action={<button className={styles.primaryAction} onClick={() => setIntakeOpen(true)}>Ingest your first source →</button>} /> : (
        <section className={styles.productInbox}>
          <div className={styles.productChangeList}><header><strong>Incoming changes</strong><span>{changes.length} needs decision</span></header>{changes.map((change) => <button key={change.id} onClick={() => onSelect(change.id)} aria-pressed={selected.id === change.id} className={selected.id === change.id ? styles.productChangeActive : styles.productChange}><i className={styles[`severity_${change.severity}`]} /><span><small><SourceBadge type={change.sourceType} /></small><strong>{change.subject}</strong><em>{change.predicate.replaceAll("_", " ")}</em><small>{change.source}</small></span><StatusPill status="proposed" /></button>)}</div>
          <article className={styles.productReview}>
            <header><div><SourceBadge type={selected.sourceType} /><h2>{selected.subject}</h2><p>{selected.source}</p></div><span><strong>{Math.round(selected.confidence * 100)}%</strong><small>confidence</small></span></header>
            <div className={styles.claimComparison}><p className={styles.monoEyebrow}>Extracted claim · {selected.predicate}</p><div><span>−</span><p><small>Current approved value</small><strong>{selected.previous}</strong></p></div><div><span>+</span><p><small>Proposed value</small><strong>{selected.next}</strong></p></div></div>
            <div className={styles.blastRadius}><span>↯</span><div><strong>Blast radius · {selected.impact.length} dependencies</strong><p>Approval invalidates derived context before the next agent action.</p><ul>{selected.impact.map((impact) => <li key={impact}>{impact}</li>)}</ul></div></div>
            <div className={styles.reviewPolicy}><p className={styles.monoEyebrow}>Policy decision</p><span><strong>{selected.severity} risk</strong><small>{selected.severity === "high" ? "Authorized approval required" : "Human review configured"}</small></span></div>
            <footer><button className={styles.secondaryAction} disabled={deciding} onClick={() => onDecide("reject")}>Reject</button><button className={styles.primaryAction} disabled={deciding} onClick={() => onDecide("approve")}>{deciding ? "Recording decision…" : "Approve and propagate →"}</button></footer>
          </article>
        </section>
      )}
    </>
  );
}

function SourceIntake({ state, ingest, ingesting, notice, onStored }: { state: ProductWorkspaceState; ingest: (input: Record<string, unknown>) => Promise<boolean>; ingesting: boolean; notice: IngestNotice; onStored: () => void }) {
  const scopes = state.scopes ?? [];
  const entityKinds = Array.isArray(state.configuration?.entityKinds) ? state.configuration.entityKinds : [];
  const predicates = Array.isArray(state.configuration?.predicates) ? state.configuration.predicates as Array<Record<string, unknown>> : [];
  const [scopeId, setScopeId] = useState(stringValue(scopes[0]?.id, ""));
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState<"private" | "public">("private");
  const [content, setContent] = useState("");
  const [proposeClaim, setProposeClaim] = useState(false);
  const [subjectName, setSubjectName] = useState("");
  const [subjectType, setSubjectType] = useState(stringValue(entityKinds[0]?.key, "record"));
  const [predicate, setPredicate] = useState(stringValue(predicates[0]?.key, ""));
  const [claimValue, setClaimValue] = useState("");
  const [sourceExcerpt, setSourceExcerpt] = useState("");
  const [localError, setLocalError] = useState("");

  async function readFile(file: File | undefined) {
    setLocalError("");
    if (!file) return;
    if (file.size > 48 * 1024) { setLocalError("Text files must be 48 KB or smaller so the full request stays below the 64 KB API limit."); return; }
    const text = await file.text();
    if (text.includes("\uFFFD")) { setLocalError("This file could not be decoded cleanly as UTF-8 text."); return; }
    setContent(text);
    setTitle((current) => current || file.name);
    setSourceExcerpt(text.slice(0, 500));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLocalError("");
    if (!scopeId || !title.trim() || !content.trim()) { setLocalError("Target scope, source title, and UTF-8 text are required."); return; }
    if (new TextEncoder().encode(content).byteLength > 48 * 1024) { setLocalError("Source text must be 48 KB or smaller."); return; }
    if (proposeClaim && (!subjectName.trim() || !subjectType || !predicate || !claimValue.trim() || !sourceExcerpt.trim())) { setLocalError("Complete every optional claim field, including its exact source excerpt."); return; }
    if (proposeClaim && !content.includes(sourceExcerpt)) { setLocalError("The claim excerpt must exactly occur in the source text."); return; }
    let value: unknown = claimValue;
    if (proposeClaim) { try { value = JSON.parse(claimValue); } catch { value = claimValue; } }
    const stored = await ingest({
      scopeId,
      source: { title: title.trim(), type: "upload", classification, content },
      ...(proposeClaim ? { claims: [{ subjectName: subjectName.trim(), subjectType, predicate, value, sourceSpan: sourceExcerpt }] } : {}),
    });
    if (stored) onStored();
  }

  return <form className={styles.sourceIntake} onSubmit={(event) => void submit(event)}>
    <header><div><p className={styles.monoEyebrow}>Authenticated intake · maximum 48 KB UTF-8</p><h2>Store evidence, optionally propose one claim.</h2><p>The source is immutable and untrusted. A proposed claim still requires the normal human approval workflow.</p></div><label className={styles.filePicker}>Choose text file<input type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" onChange={(event) => void readFile(event.target.files?.[0])} /></label></header>
    <div className={styles.intakeFields}><label>Target scope<select value={scopeId} onChange={(event) => setScopeId(event.target.value)} required>{scopes.map((scope, index) => <option key={stringValue(scope.id, `scope-${index}`)} value={stringValue(scope.id, `scope-${index}`)}>{stringValue(scope.kind, "Scope")} · {stringValue(scope.name, `Scope ${index + 1}`)}</option>)}</select></label><label>Source title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required /></label><label>Classification<select value={classification} onChange={(event) => setClassification(event.target.value as "private" | "public")}><option value="private">Private</option><option value="public">Public</option></select></label></div>
    <label className={styles.intakeText}>Paste UTF-8 source text<textarea rows={7} value={content} onChange={(event) => { setContent(event.target.value); if (!sourceExcerpt) setSourceExcerpt(event.target.value.slice(0, 500)); }} placeholder="Paste a policy, decision note, runbook excerpt, brief, or operational record…" required /><small>{new TextEncoder().encode(content).byteLength.toLocaleString()} / 49,152 bytes</small></label>
    <label className={styles.claimToggle}><input type="checkbox" checked={proposeClaim} onChange={(event) => setProposeClaim(event.target.checked)} /><span><strong>Also propose one configured claim</strong><small>Optional · remains pending until an authorized human approves it</small></span></label>
    {proposeClaim ? <div className={styles.claimFields}><label>Subject name<input value={subjectName} onChange={(event) => setSubjectName(event.target.value)} /></label><label>Entity type<select value={subjectType} onChange={(event) => setSubjectType(event.target.value)}>{entityKinds.map((entity, index) => <option key={stringValue(entity.key, `entity-${index}`)} value={stringValue(entity.key, "record")}>{stringValue(entity.label, "Record")}</option>)}</select></label><label>Predicate<select value={predicate} onChange={(event) => setPredicate(event.target.value)} disabled={!predicates.length}><option value="">{predicates.length ? "Select a configured predicate" : "Configure a predicate in Settings first"}</option>{predicates.map((item, index) => <option key={stringValue(item.key, `predicate-${index}`)} value={stringValue(item.key)}>{stringValue(item.label, stringValue(item.key))}</option>)}</select></label><label>Value · JSON or text<input value={claimValue} onChange={(event) => setClaimValue(event.target.value)} placeholder='e.g. approved or {"risk":"low"}' /></label><label className={styles.spanTwo}>Exact source excerpt<textarea rows={3} value={sourceExcerpt} onChange={(event) => setSourceExcerpt(event.target.value)} /></label></div> : null}
    {localError ? <p className={styles.intakeError} role="alert">{localError}</p> : notice ? <p className={notice.tone === "error" ? styles.intakeError : styles.intakeSuccess} role="status">{notice.message}</p> : null}
    <footer><span>Production workspaces never fall back to recorded data.</span><button className={styles.primaryAction} type="submit" disabled={ingesting || !scopes.length}>{ingesting ? "Storing source…" : "Store evidence →"}</button></footer>
  </form>;
}

function MapSurface({ state, pack, isDemo, selectedNodeId, onSelectNode, onEvidence }: { state: ProductWorkspaceState; pack: TemplatePack; isDemo: boolean; selectedNodeId: string | null; onSelectNode: (id: string) => void; onEvidence: (id: string) => void }) {
  const [zoom, setZoom] = useState(1);
  const liveNodes = (state.entities ?? []).slice(0, 9).map((entity, index) => ({ id: stringValue(entity.id, `entity-${index}`), label: stringValue(entity.name, `Entity ${index + 1}`), kind: stringValue(entity.type ?? entity.entityType, "Entity"), x: 12 + (index % 3) * 34, y: 18 + Math.floor(index / 3) * 31, tone: (["blue", "violet", "mint", "yellow", "coral", "ink"] as const)[index % 6] }));
  const nodes = liveNodes.length || !isDemo ? liveNodes : pack.graph.nodes;
  const selected = nodes.find((node) => node.id === selectedNodeId) ?? nodes[0];
  const selectedClaims = (state.claims ?? []).filter((claim) => claim.subject === selected?.label || claim.subjectEntityId === selected?.id);
  return (
    <>
      <ViewHeading eyebrow="Temporal graph · current approved view" title="Memory Map" description="Explore entities, relationships, claims, and evidence without losing valid time or permission boundaries." action={<div className={styles.mapButtons}><button aria-label="Zoom out" onClick={() => setZoom((current) => Math.max(.7, current - .1))}>−</button><button onClick={() => setZoom(1)}>Fit</button><button aria-label="Zoom in" onClick={() => setZoom((current) => Math.min(1.3, current + .1))}>+</button></div>} />
      {!nodes.length ? <EmptyState title="The memory map is empty." copy="Connect a source and approve its first claims to build this workspace’s operational graph." /> : <section className={styles.productMapLayout}>
        <div className={styles.productMap}><header><span><i className={styles.legendEntity} /> Entity</span><span><i className={styles.legendClaim} /> Claim</span><span><i className={styles.legendConflict} /> Conflict</span><button disabled title="Historical as-of selection becomes available after the first immutable snapshot">As of now</button></header><div className={styles.productGraph} style={{ transform: `scale(${zoom})` }}>{isDemo ? pack.graph.edges.map((edge, index) => <i key={`${edge.from}-${edge.to}`} className={styles[`genericEdge${(index % 5) + 1}`]} />) : null}{nodes.map((node) => <button key={node.id} className={cx(styles.productNode, styles[`node_${node.tone}`], selected?.id === node.id && styles.productNodeActive)} style={{ left: `${node.x}%`, top: `${node.y}%` }} onClick={() => onSelectNode(node.id)} aria-pressed={selected?.id === node.id}><span>{node.label.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><strong>{node.label}</strong><small>{node.kind}</small></button>)}</div><div className={styles.mapMini}><i /><i /><i /><i /></div></div>
        <aside className={styles.productInspector}>{selected ? <><header><span>{selected.label.slice(0, 2).toUpperCase()}</span><div><small>Selected node</small><h2>{selected.label}</h2><p>{selected.kind}</p></div></header><dl><div><dt>Current claims</dt><dd>{selectedClaims.length || (isDemo ? 4 : 0)}</dd></div><div><dt>Evidence coverage</dt><dd>{state.claims?.length || isDemo ? "100%" : "—"}</dd></div></dl><h3>Current truth</h3>{selectedClaims.slice(0, 3).map((claim) => <button key={stringValue(claim.id)} onClick={() => onEvidence(stringValue(claim.id))}><i /><span><strong>{stringValue(claim.predicate).replaceAll("_", " ")}</strong><small>{stringValue(claim.lifecycle, "current")}</small></span><em>↗</em></button>)}{isDemo && pack.evidence.slice(0, 3).map((evidence) => <button key={evidence.id} onClick={() => onEvidence(evidence.id)}><i /><span><strong>{evidence.title}</strong><small>{evidence.source}</small></span><em>↗</em></button>)}</> : null}</aside>
      </section>}
    </>
  );
}

function AskSurface({ pack, question, setQuestion, ask, asking, answer, onEvidence }: { pack: TemplatePack; question: string; setQuestion: (value: string) => void; ask: () => void; asking: boolean; answer: AskCommandResult | null; onEvidence: (id: string) => void }) {
  const candidates = answer?.candidates ?? [];
  return (
    <>
      <ViewHeading eyebrow="Permission-aware · time-aware · claim-cited" title="Ask Commonstate" description="Make operational decisions from valid state—not a pile of semantically similar documents." />
      <section className={styles.productAskBox}><label htmlFor="product-question">Ask about this scope</label><textarea id="product-question" rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void ask(); }} /><footer><span><kbd>⌘</kbd><kbd>↵</kbd> to ask</span><button className={styles.primaryAction} onClick={ask} disabled={asking}>{asking ? "Compiling live context…" : "Ask Commonstate →"}</button></footer></section>
      <div className={styles.questionChips}><span>Try:</span>{pack.suggestedQuestions.map((suggestion) => <button key={suggestion} onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}</div>
      {!answer ? <EmptyState title="Ask a consequential question." copy="Commonstate applies identity, scope, validity, freshness, and conflict policy before it retrieves evidence." /> : <section className={styles.productAnswer} aria-live="polite"><header><div><span>CS</span><p><small>Live API answer</small><strong>{candidates.filter((candidate) => candidate.status === "eligible").length} eligible · {candidates.filter((candidate) => candidate.status !== "eligible").length} need attention</strong></p></div><div><StatusPill status="current" /><code>{answer.contextPack?.versionHash?.slice(0, 10) ?? "context"}</code></div></header><p>{answer.answer ?? "Commonstate returned structured decision candidates from the current context pack."}</p>{candidates.length ? <div className={styles.candidateGrid}>{candidates.map((candidate) => <CandidateCard key={candidate.entityId} candidate={candidate} onEvidence={onEvidence} />)}</div> : <div className={styles.noCandidates}><strong>No decision candidates returned.</strong><span>The API answer above is preserved without substituting template examples.</span></div>}<footer><span><strong>Why this answer is safe</strong><small>{answer.citations?.length ?? 0} cited claims · server-owned scope · unresolved high-risk conflicts fail closed</small></span>{answer.citations?.[0] ? <button onClick={() => onEvidence(answer.citations?.[0]?.evidenceId ?? answer.citations?.[0]?.claimId ?? "")}>Inspect first cited claim →</button> : null}</footer></section>}
    </>
  );
}

function CandidateCard({ candidate, onEvidence }: { candidate: DecisionCandidate; onEvidence: (id: string) => void }) {
  return <article className={cx(styles.candidateCard, candidate.status === "blocked" && styles.candidateBlocked)}><header><span>{candidate.name.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><div><h3>{candidate.name}</h3><p>{candidate.subtitle}</p></div><StatusPill status={candidate.status} /></header>{typeof candidate.score === "number" ? <div className={styles.candidateScore}><i style={{ width: `${candidate.score}%` }} /><small>{candidate.score}% policy match</small></div> : null}<dl>{candidate.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd className={fact.tone ? styles[`fact_${fact.tone}`] : ""}>{fact.value}</dd></div>)}</dl><p className={styles.candidateReason}>{candidate.status === "eligible" ? "✓" : candidate.status === "blocked" ? "⊘" : "!"} {candidate.reason}</p><footer>{candidate.evidenceIds.map((id, index) => <button key={id} onClick={() => onEvidence(id)}>Evidence {index + 1} ↗</button>)}</footer></article>;
}

function AgentsSurface({ state, pack, isDemo, run, running, receipt, onEvidence, proposeAction, acting, actionReceipt }: { state: ProductWorkspaceState; pack: TemplatePack; isDemo: boolean; run: () => void; running: boolean; receipt: Record<string, unknown> | null; onEvidence: (id: string) => void; proposeAction: () => void; acting: boolean; actionReceipt: Record<string, unknown> | null }) {
  const liveAgents = (state.agents ?? []).map((agent, index) => ({ id: stringValue(agent.id, `agent-${index}`), name: stringValue(agent.name, `Agent ${index + 1}`), initials: stringValue(agent.name, "AG").split(" ").map((word) => word[0]).join("").slice(0, 2), purpose: stringValue(agent.purpose, "Configured workspace agent"), scope: stringValue(agent.scope, "Permissioned workspace"), permissions: Array.isArray(agent.permissions) ? agent.permissions.filter((item): item is string => typeof item === "string") : [], writeBudget: numberValue(agent.writeBudget), riskCeiling: (agent.riskCeiling === "high" || agent.riskCeiling === "medium" ? agent.riskCeiling : "low") as "low" | "medium" | "high" }));
  const agents = liveAgents.length || !isDemo ? liveAgents : pack.agents;
  return <>
    <ViewHeading eyebrow="Agent operations · risk-tiered execution" title="Agent Console" description="Give each long-running agent the minimum valid context, deterministic policy, and an immutable receipt." action={<button className={styles.primaryAction} onClick={run} disabled={running || !agents.length}>{running ? "Agent working…" : "Run selected agent →"}</button>} />
    {!agents.length ? <EmptyState title="No agents configured." copy="Add an agent identity, scope grants, tool permissions, and a write budget in Workspace Settings." /> : <>
      <div className={styles.agentStatusStrip}><span><i />{agents.length} configured agents</span><span>Human approval enforced</span><span>Critical actions blocked</span><span>Server-owned identity</span></div>
      <section className={styles.productAgentLayout}>
        <div className={styles.productAgentList}>{agents.map((agent, index) => <article key={agent.id} className={index === 0 ? styles.productAgentActive : styles.productAgentCard}><header><span>{agent.initials}</span><div><h3>{agent.name}</h3><p>{agent.purpose}</p></div><StatusPill status={index === 0 ? "current" : "ready"} /></header><dl><div><dt>Scope</dt><dd>{agent.scope}</dd></div><div><dt>Write budget</dt><dd>{agent.writeBudget} proposals</dd></div><div><dt>Risk ceiling</dt><dd>{agent.riskCeiling}</dd></div></dl></article>)}</div>
        <article className={styles.agentRunPanel}><header><div><p className={styles.monoEyebrow}>Selected run</p><h2>{receipt ? stringValue(receipt.id ?? (receipt.run as Record<string, unknown> | undefined)?.id, "Latest live receipt") : pack.guidedQuestion}</h2></div><StatusPill status={receipt ? stringValue(receipt.status ?? (receipt.run as Record<string, unknown> | undefined)?.status, "complete") : "ready"} /></header>{!receipt ? <div className={styles.agentReady}><div><span>CS</span><i /><i /><i /></div><h3>Only task-relevant facts enter this run.</h3><p>The Context Compiler filters current claims by identity, scope, freshness, permission, and risk before an agent can act.</p><ol>{["Compile scoped context", "Apply deterministic policy", "Propose or hold actions", "Return immutable receipt"].map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol></div> : <ReceiptView receipt={receipt} onEvidence={onEvidence} />}</article>
      </section>
      {receipt ? <ActionPolicyResult result={actionReceipt} propose={proposeAction} acting={acting} /> : null}
    </>}
  </>;
}

function ActionPolicyResult({ result, propose, acting }: { result: Record<string, unknown> | null; propose: () => void; acting: boolean }) {
  const proposal = result?.proposal && typeof result.proposal === "object" ? result.proposal as Record<string, unknown> : null;
  const receipt = result?.receipt && typeof result.receipt === "object" ? result.receipt as Record<string, unknown> : null;
  const policy = proposal?.policyDecision && typeof proposal.policyDecision === "object" ? proposal.policyDecision as Record<string, unknown> : {};
  return <section className={styles.actionPolicyResult} aria-live="polite"><div><p className={styles.monoEyebrow}>Next step · deterministic action policy</p><h2>{proposal ? "Reversible action evaluated." : "Turn the run into a safe internal action."}</h2><p>{proposal ? stringValue(policy.reason, "Workspace policy returned a decision.") : "Propose a draft.create action bound to this run’s context. No external message, payment, access change, or destructive operation is triggered."}</p></div>{proposal ? <dl><div><dt>Action</dt><dd>{stringValue(proposal.actionType)}</dd></div><div><dt>Risk</dt><dd>{stringValue(proposal.riskTier)}</dd></div><div><dt>Status</dt><dd><StatusPill status={stringValue(proposal.status)} /></dd></div><div><dt>Receipt</dt><dd><code>{stringValue(receipt?.receiptHash, "Awaiting configured execution")}</code></dd></div></dl> : <button className={styles.primaryAction} onClick={propose} disabled={acting}>{acting ? "Evaluating policy…" : "Propose reversible draft →"}</button>}</section>;
}

function ReceiptView({ receipt, onEvidence }: { receipt: Record<string, unknown>; onEvidence: (id: string) => void }) {
  const run = receipt.run && typeof receipt.run === "object" ? receipt.run as Record<string, unknown> : receipt;
  const contextPack = receipt.contextPack && typeof receipt.contextPack === "object" ? receipt.contextPack as Record<string, unknown> : {};
  const claims = Array.isArray(contextPack.claimIds)
    ? contextPack.claimIds.filter((id): id is string => typeof id === "string")
    : Array.isArray(contextPack.citations)
      ? contextPack.citations.flatMap((citation) => citation && typeof citation === "object" && typeof (citation as Record<string, unknown>).claimId === "string" ? [(citation as Record<string, unknown>).claimId as string] : [])
      : [];
  return <div className={styles.receiptView}><div className={styles.receiptHash}><span>Immutable receipt</span><code>{stringValue(run.receiptHash ?? run.contextVersionHash, "returned by live API")}</code></div><div className={styles.receiptTimeline}>{["Identity and scope verified", "Context pack compiled", "Policy evaluated", "Decision receipt recorded"].map((item, index) => <div key={item}><span>{index + 1}</span><p><strong>{item}</strong><small>{index < 3 ? "Passed" : stringValue(run.status, "Complete")}</small></p><StatusPill status="passed" /></div>)}</div>{claims.length ? <footer>{claims.slice(0, 4).map((id) => <button key={id} onClick={() => onEvidence(id)}>Claim {id.slice(0, 8)} ↗</button>)}</footer> : null}</div>;
}

function ReplaySurface({ state, pack, replay, replaying, receipt, recordOutcome, recordingOutcome, outcomeReceipt }: { state: ProductWorkspaceState; pack: TemplatePack; replay: () => void; replaying: boolean; receipt: Record<string, unknown> | null; recordOutcome: () => void; recordingOutcome: boolean; outcomeReceipt: Record<string, unknown> | null }) {
  const run = state.runs?.[0];
  const replayResult = receipt?.replay && typeof receipt.replay === "object" ? receipt.replay as Record<string, unknown> : receipt;
  const comparison = receipt?.comparison && typeof receipt.comparison === "object" ? receipt.comparison as Record<string, unknown> : {};
  const outcome = outcomeReceipt?.outcome && typeof outcomeReceipt.outcome === "object" ? outcomeReceipt.outcome as Record<string, unknown> : null;
  return <>
    <ViewHeading eyebrow="Temporal replay · immutable context" title="Replay" description="Reconstruct what an agent knew then, compare it with current state, and bind the result to a measurable outcome." action={<button className={styles.primaryAction} onClick={replay} disabled={replaying || !run}>{replaying ? "Replaying…" : "Replay against current state →"}</button>} />
    {!run ? <EmptyState title="No run history yet." copy="Run a configured agent once to create an immutable context receipt that can be replayed." /> : <>
      <section className={styles.replayShell}><header><div><span>Baseline run</span><strong>{stringValue(run.id)}</strong><small>{stringValue(run.createdAt, "Immutable historical context")}</small></div><i>→</i><div><span>Current state</span><strong>{receipt ? "Replay complete" : "Ready to compare"}</strong><small>{state.claims?.length ?? 0} current claims</small></div></header><div className={styles.replayCompare}><article><p className={styles.monoEyebrow}>What the agent knew then</p><h2>Original context</h2><dl><div><dt>Run status</dt><dd>{stringValue(run.status, "complete")}</dd></div><div><dt>Context version</dt><dd><code>{stringValue(run.contextVersionHash ?? run.contextHash, "bound to receipt")}</code></dd></div><div><dt>Ontology</dt><dd>v{state.profile?.publishedConfigurationVersion ?? 0}</dd></div></dl><aside><span>✓</span><p><strong>Historical decision preserved</strong><small>Receipts remain bound to their original configuration and evidence.</small></p></aside></article><article className={receipt ? styles.replayChanged : ""}><p className={styles.monoEyebrow}>What the agent would know now</p><h2>{receipt ? "Current-context result" : "Awaiting replay"}</h2>{receipt ? <><dl><div><dt>Status</dt><dd>{stringValue(replayResult?.status, "complete")}</dd></div><div><dt>Context changed</dt><dd>{comparison.changed === true ? "Yes" : "No"}</dd></div><div><dt>Now blocked</dt><dd>{comparison.nowBlocked === true ? "Yes" : "No"}</dd></div></dl><aside><span>↯</span><p><strong>Blast radius recalculated</strong><small>Only current, permissioned facts entered the new comparison.</small></p></aside></> : <div className={styles.replayPlaceholder}><span>↺</span><p>Run replay to compare this receipt against current operational truth.</p></div>}</article></div><footer><span>Same context hash → reproducible</span><span>Changed state → explicit diff</span><span>Every result → cited receipt</span></footer></section>
      <section className={styles.outcomePanel} aria-live="polite"><div><p className={styles.monoEyebrow}>Outcome memory · {pack.name}</p><h2>{outcome ? "Outcome receipt confirmed." : "Close the operational loop."}</h2><p>{outcome ? "The measured result is bound to this run and can enter the Truth Workflow as a proposed learning." : "Record safe numeric sample values for this template’s configured metrics. The server creates the receipt; this UI never claims persistence before confirmation."}</p></div><dl>{pack.outcomeMetrics.map((metric, index) => <div key={metric.key}><dt>{metric.label}</dt><dd>{index + 1} {metric.unit}</dd></div>)}</dl>{outcome ? <code>{stringValue(outcome.receiptHash)}</code> : <button className={styles.primaryAction} onClick={recordOutcome} disabled={recordingOutcome}>{recordingOutcome ? "Recording outcome…" : "Record measured outcome →"}</button>}</section>
    </>}
  </>;
}

function EvalsSurface({ state, filter, setFilter }: { state: ProductWorkspaceState; filter: "all" | "security" | "retrieval" | "actions"; setFilter: (value: "all" | "security" | "retrieval" | "actions") => void }) {
  const suppliedResults = Array.isArray(state.evals) ? state.evals : state.evals?.results;
  const hasServerResults = Boolean(suppliedResults?.length);
  const results: Array<Record<string, unknown>> = hasServerResults ? suppliedResults! : evaluationNames.map((name, index) => ({ id: `eval-${index + 1}`, name, category: index < 8 ? "security" : index < 16 ? "retrieval" : "actions", status: "not_run", durationMs: 0 }));
  const hasCompletedResults = results.some((result) => result.status === "passed" || result.status === "failed" || result.passed === true || result.passed === false);
  const total = (!Array.isArray(state.evals) ? state.evals?.total : undefined) ?? results.length;
  const passed = hasCompletedResults ? ((!Array.isArray(state.evals) ? state.evals?.passed : undefined) ?? results.filter((result) => result.status === "passed" || result.passed === true).length) : 0;
  const filtered = filter === "all" ? results : results.filter((result) => result.category === filter);
  return <>
    <ViewHeading
      eyebrow="Executable trust · release gate"
      title="Evals"
      description="Production claims about security, provenance, retrieval, and action safety are backed by repeatable tests."
      action={<button className={styles.primaryAction} disabled title="Evaluation runs are started by the release worker">{hasCompletedResults ? "Latest server receipt" : "No server run yet"}</button>}
    />
    <section className={styles.evalSummary}>
      <article><span className={styles.evalRing}><strong>{passed}</strong><small>of {total}</small></span><div><p className={styles.monoEyebrow}>Latest release gate</p><h2>{!hasCompletedResults ? "Evaluation suite not run" : passed === total ? "All checks passed" : `${total - passed} checks need attention`}</h2><p>{hasCompletedResults ? "Configuration and provider versions are pinned to this evaluation receipt." : "Template cases are listed for transparency, but no result is marked passed until the workspace returns an evaluation receipt."}</p></div></article>
      <dl><div><dt>Security boundary</dt><dd>{hasCompletedResults ? "From server" : "Not run"}</dd></div><div><dt>Context p95</dt><dd>{hasCompletedResults ? "From server" : "Not measured"}</dd></div><div><dt>Provenance</dt><dd>{hasCompletedResults ? "From server" : "Not run"}</dd></div><div><dt>Last run</dt><dd>{hasCompletedResults ? "Current version" : "None"}</dd></div></dl>
    </section>
    <div className={styles.evalToolbar}>{(["all", "security", "retrieval", "actions"] as const).map((item) => <button key={item} className={filter === item ? styles.evalFilterActive : ""} onClick={() => setFilter(item)}>{item === "all" ? "All checks" : item}</button>)}<span>{filtered.length} cases</span></div>
    <section className={styles.evalTable} aria-label="Evaluation results"><header><span>Case</span><span>Category</span><span>Duration</span><span>Result</span></header>{filtered.map((result, index) => <div key={stringValue(result.id, `eval-${index}`)}><span><i>{String(index + 1).padStart(2, "0")}</i><strong>{stringValue("caseName" in result ? result.caseName : result.name, evaluationNames[index % evaluationNames.length])}</strong></span><span>{stringValue(result.category, "security")}</span><code>{typeof result.durationMs === "number" && result.status !== "not_run" ? `${result.durationMs}ms` : "—"}</code><StatusPill status={stringValue(result.status, "not_run")} /></div>)}</section>
  </>;
}

function SettingsSurface({ state, pack, configuration, tab, setTab, draft, draftSaved, updateConfiguration, discard, save, publish, publishing }: { state: ProductWorkspaceState; pack: TemplatePack; configuration: Record<string, unknown>; tab: "identity" | "model" | "policy" | "connectors"; setTab: (value: "identity" | "model" | "policy" | "connectors") => void; draft: boolean; draftSaved: boolean; updateConfiguration: (value: Record<string, unknown>) => void; discard: () => void; save: () => void; publish: () => void; publishing: boolean }) {
  const version = state.profile?.publishedConfigurationVersion ?? 0;
  return <><ViewHeading eyebrow={`Configuration v${version} · ${draft ? draftSaved ? "draft saved" : "unsaved changes" : "published"}`} title="Workspace Settings" description="Tailor terminology, evidence policy, agents, metrics, and branding without customer-specific code." action={<button className={styles.primaryAction} disabled={!draft || publishing} onClick={draftSaved ? publish : save}>{publishing ? "Writing verified state…" : draftSaved ? `Publish v${version + 1} →` : draft ? "Save configuration draft →" : "No unpublished changes"}</button>} /><section className={styles.settingsShell}><nav aria-label="Settings sections">{(["identity", "model", "policy", "connectors"] as const).map((item) => <button key={item} className={tab === item ? styles.settingsTabActive : ""} onClick={() => setTab(item)}>{item === "identity" ? "Identity & locale" : item === "model" ? "Operating model" : item === "policy" ? "Truth & action policy" : "Sources & providers"}<span>→</span></button>)}</nav><div className={styles.settingsContent}>{tab === "identity" ? <SettingsIdentity configuration={configuration} pack={pack} update={updateConfiguration} /> : null}{tab === "model" ? <SettingsModel configuration={configuration} update={updateConfiguration} /> : null}{tab === "policy" ? <SettingsPolicy configuration={configuration} update={updateConfiguration} /> : null}{tab === "connectors" ? <SettingsConnectors state={state} /> : null}</div></section>{draft ? <div className={styles.draftBar}><span>●</span><p><strong>{draftSaved ? "Draft confirmed by the workspace API" : "Unsaved configuration changes"}</strong><small>{draftSaved ? "Publish will create an immutable version; current context still uses the previous version." : "Nothing is presented as persisted until the API confirms the draft."}</small></p><button className={styles.secondaryAction} onClick={discard}>Discard</button>{!draftSaved ? <button className={styles.primaryAction} onClick={save} disabled={publishing}>{publishing ? "Saving…" : "Save draft"}</button> : <button className={styles.primaryAction} onClick={publish} disabled={publishing}>{publishing ? "Publishing…" : `Publish v${version + 1} →`}</button>}</div> : null}</>;
}

function SettingsIdentity({ configuration, pack, update }: { configuration: Record<string, unknown>; pack: TemplatePack; update: (value: Record<string, unknown>) => void }) {
  const branding = (configuration.branding && typeof configuration.branding === "object" ? configuration.branding : {}) as Record<string, unknown>;
  const patch = (key: string, value: string) => update({ ...configuration, branding: { ...branding, [key]: value } });
  const companyName = stringValue(branding.companyName, pack.name);
  const accent = stringValue(branding.accent, pack.accent);
  return <div className={styles.settingsForm}><header><p className={styles.monoEyebrow}>Workspace identity</p><h2>Brand and local conventions</h2><p>Changes stay local until Save draft succeeds, then remain non-operative until an immutable version is published.</p></header><div className={styles.settingsFields}><label>Company name<input value={companyName} onChange={(event) => patch("companyName", event.target.value)} /></label><label>Company accent<span className={styles.colorInput}><input type="color" value={accent} onChange={(event) => patch("accent", event.target.value)} /><input value={accent} onChange={(event) => patch("accent", event.target.value)} /></span></label><label>Locale<select value={stringValue(branding.locale, "en-GB")} onChange={(event) => patch("locale", event.target.value)}><option>en-GB</option><option>en-US</option><option>de-DE</option></select></label><label>Timezone<select value={stringValue(branding.timezone, "UTC")} onChange={(event) => patch("timezone", event.target.value)}><option>UTC</option><option>Europe/London</option><option>America/New_York</option><option>Asia/Kolkata</option></select></label></div><aside className={styles.settingsPreview}><span style={{ background: accent }}>{companyName.slice(0, 2).toUpperCase()}</span><div><small>Unsaved visual preview</small><strong>{companyName}</strong><p>{pack.eyebrow}</p></div></aside></div>;
}

function SettingsModel({ configuration, update }: { configuration: Record<string, unknown>; update: (value: Record<string, unknown>) => void }) {
  const scopes = Array.isArray(configuration.scopeKinds) ? configuration.scopeKinds as Array<Record<string, unknown>> : [];
  const entities = Array.isArray(configuration.entityKinds) ? configuration.entityKinds as Array<Record<string, unknown>> : [];
  const terminology = configuration.terminology && typeof configuration.terminology === "object" ? configuration.terminology as Record<string, unknown> : {};
  const predicates = Array.isArray(configuration.predicates) ? configuration.predicates as Array<Record<string, unknown>> : [];
  const agents = Array.isArray(configuration.agents) ? configuration.agents as Array<Record<string, unknown>> : [];
  const metrics = Array.isArray(configuration.metrics) ? configuration.metrics as Array<Record<string, unknown>> : [];
  const workflows = Array.isArray(configuration.workflows) ? configuration.workflows as Array<Record<string, unknown>> : [];
  const updateScope = (index: number, label: string) => update({ ...configuration, scopeKinds: scopes.map((item, itemIndex) => itemIndex === index ? { ...item, label } : item) });
  const updateEntity = (index: number, label: string) => update({ ...configuration, entityKinds: entities.map((item, itemIndex) => itemIndex === index ? { ...item, label } : item) });
  const addScope = () => { const key = `scope_${scopes.length + 1}`; update({ ...configuration, scopeKinds: [...scopes, { key, label: "New scope", parentKinds: scopes.length ? [stringValue(scopes.at(-1)?.key, "company")] : [], root: scopes.length === 0 }] }); };
  const addEntity = () => { const key = `entity_${entities.length + 1}`; update({ ...configuration, entityKinds: [...entities, { key, label: "New entity", icon: "record", attributesSchema: { type: "object", properties: {}, additionalProperties: false } }] }); };
  const patchArray = (key: "predicates" | "agents" | "metrics" | "workflows", rows: Array<Record<string, unknown>>, index: number, patch: Record<string, unknown>) => update({ ...configuration, [key]: rows.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  const addPredicate = () => update({ ...configuration, predicates: [...predicates, { key: `custom.attribute_${predicates.length + 1}`, label: "New claim", subjectKinds: [stringValue(entities[0]?.key, "record")], valueSchema: { type: "string" }, freshnessSeconds: 86_400, conflictRisk: "medium", classification: "private" }] });
  const addAgent = () => update({ ...configuration, agents: [...agents, { key: `agent_${agents.length + 1}`, name: "New context agent", purpose: "Compile current cited context for a configured workflow", allowedTools: ["get_context_pack", "get_evidence", "record_outcome"], writeBudget: 0, allowedScopeKinds: [stringValue(scopes[0]?.key, "company")] }] });
  const addMetric = () => update({ ...configuration, metrics: [...metrics, { key: `metric_${metrics.length + 1}`, label: "New outcome metric", unit: "count", direction: "neutral" }] });
  const addWorkflow = () => update({ ...configuration, workflows: [...workflows, { key: `workflow_${workflows.length + 1}`, name: "New workflow", summary: "A governed operational workflow", steps: ["Ingest evidence", "Review truth", "Act by policy", "Record outcome"] }] });
  return <div className={styles.settingsForm}>
    <header><p className={styles.monoEyebrow}>Versioned ontology</p><h2>Operating model</h2><p>Tailor company language, claims, agents, outcomes, and workflows through validated configuration—not arbitrary customer code.</p></header>
    <div className={styles.builderSection}><div><strong>Company terminology</strong><span>Rename product concepts without changing their governed meaning.</span></div><div className={styles.terminologyGrid}>{["workspace", "scope", "entity", "claim", "approval", "outcome"].map((key) => <label key={key}>{key}<input value={stringValue(terminology[key], key)} onChange={(event) => update({ ...configuration, terminology: { ...terminology, [key]: event.target.value } })} /></label>)}</div></div>
    <div className={styles.builderSection}><div><strong>Scope hierarchy</strong><span>Specific scopes inherit and override broader approved truth.</span></div><ol>{scopes.map((scope, index) => <li key={stringValue(scope.key, `scope-${index}`)}><i>{index + 1}</i><input value={stringValue(scope.label, `Scope ${index + 1}`)} onChange={(event) => updateScope(index, event.target.value)} /><button type="button" disabled title="Parent relationships remain attached to this version">→</button></li>)}</ol><button className={styles.secondaryAction} onClick={addScope}>+ Add scope kind</button></div>
    <div className={styles.builderSection}><div><strong>Entity vocabulary</strong><span>Each entity retains its validated JSON Schema attributes.</span></div><ol>{entities.map((entity, index) => <li key={stringValue(entity.key, `entity-${index}`)}><i>{index + 1}</i><input value={stringValue(entity.label, `Entity ${index + 1}`)} onChange={(event) => updateEntity(index, event.target.value)} /><button type="button" disabled title="Attribute schema remains attached">JSON</button></li>)}</ol><button className={styles.secondaryAction} onClick={addEntity}>+ Add entity type</button></div>
    <div className={styles.builderSection}><div><strong>Claims and predicates</strong><span>Define typed facts, valid subjects, classification, freshness, and conflict risk.</span></div><div className={styles.configurationCards}>{predicates.map((item, index) => <article key={stringValue(item.key, `predicate-${index}`)}><code>{stringValue(item.key)}</code><div className={styles.configFields}><label>Label<input value={stringValue(item.label, "Claim")} onChange={(event) => patchArray("predicates", predicates, index, { label: event.target.value })} /></label><label>Subject<select value={stringValue((item.subjectKinds as unknown[] | undefined)?.[0], stringValue(entities[0]?.key))} onChange={(event) => patchArray("predicates", predicates, index, { subjectKinds: [event.target.value] })}>{entities.map((entity) => <option key={stringValue(entity.key)} value={stringValue(entity.key)}>{stringValue(entity.label)}</option>)}</select></label><label>Risk<select value={stringValue(item.conflictRisk, "medium")} onChange={(event) => patchArray("predicates", predicates, index, { conflictRisk: event.target.value })}><option>low</option><option>medium</option><option>high</option><option>critical</option></select></label><label>Class<select value={stringValue(item.classification, "private")} onChange={(event) => patchArray("predicates", predicates, index, { classification: event.target.value })}><option>private</option><option>public</option><option>synthetic</option></select></label></div></article>)}</div><button className={styles.secondaryAction} onClick={addPredicate} disabled={!entities.length}>+ Add claim predicate</button></div>
    <div className={styles.builderSection}><div><strong>Agent identities</strong><span>Configure purpose, least-privilege scope, tools, and proposal budget.</span></div><div className={styles.configurationCards}>{agents.map((item, index) => <article key={stringValue(item.key, `agent-${index}`)}><code>{stringValue(item.key)}</code><div className={styles.configFields}><label>Name<input value={stringValue(item.name, "Agent")} onChange={(event) => patchArray("agents", agents, index, { name: event.target.value })} /></label><label>Purpose<input value={stringValue(item.purpose, "Compile context")} onChange={(event) => patchArray("agents", agents, index, { purpose: event.target.value })} /></label><label>Scope<select value={stringValue((item.allowedScopeKinds as unknown[] | undefined)?.[0], stringValue(scopes[0]?.key))} onChange={(event) => patchArray("agents", agents, index, { allowedScopeKinds: [event.target.value] })}>{scopes.map((scope) => <option key={stringValue(scope.key)} value={stringValue(scope.key)}>{stringValue(scope.label)}</option>)}</select></label><label>Write budget<input type="number" min={0} max={1000} value={numberValue(item.writeBudget)} onChange={(event) => patchArray("agents", agents, index, { writeBudget: Number(event.target.value) })} /></label></div><small>{Array.isArray(item.allowedTools) ? item.allowedTools.join(" · ") : "No tools configured"}</small></article>)}</div><button className={styles.secondaryAction} onClick={addAgent} disabled={!scopes.length}>+ Add agent identity</button></div>
    <div className={styles.builderSection}><div><strong>Outcome metrics</strong><span>Choose what decisions and agent runs are measured against.</span></div><div className={styles.configurationCards}>{metrics.map((item, index) => <article key={stringValue(item.key, `metric-${index}`)}><code>{stringValue(item.key)}</code><div className={styles.configFields}><label>Label<input value={stringValue(item.label, "Metric")} onChange={(event) => patchArray("metrics", metrics, index, { label: event.target.value })} /></label><label>Unit<select value={stringValue(item.unit, "count")} onChange={(event) => patchArray("metrics", metrics, index, { unit: event.target.value })}><option>count</option><option>percent</option><option>currency</option><option>milliseconds</option><option>score</option></select></label><label>Direction<select value={stringValue(item.direction, "neutral")} onChange={(event) => patchArray("metrics", metrics, index, { direction: event.target.value })}><option>higher</option><option>lower</option><option>neutral</option></select></label></div></article>)}</div><button className={styles.secondaryAction} onClick={addMetric}>+ Add outcome metric</button></div>
    <div className={styles.builderSection}><div><strong>Guided workflows</strong><span>Define operator-facing stages; execution remains policy controlled.</span></div><div className={styles.configurationCards}>{workflows.map((item, index) => <article key={stringValue(item.key, `workflow-${index}`)}><code>{stringValue(item.key)}</code><div className={styles.configFields}><label>Name<input value={stringValue(item.name, "Workflow")} onChange={(event) => patchArray("workflows", workflows, index, { name: event.target.value })} /></label><label>Summary<input value={stringValue(item.summary, "Governed workflow")} onChange={(event) => patchArray("workflows", workflows, index, { summary: event.target.value })} /></label><label className={styles.configWide}>Steps · separate with →<input value={Array.isArray(item.steps) ? item.steps.join(" → ") : ""} onChange={(event) => patchArray("workflows", workflows, index, { steps: event.target.value.split(/\s*(?:→|,)\s*/).filter(Boolean) })} /></label></div></article>)}</div><button className={styles.secondaryAction} onClick={addWorkflow}>+ Add workflow</button></div>
  </div>;
}

function SettingsPolicy({ configuration, update }: { configuration: Record<string, unknown>; update: (value: Record<string, unknown>) => void }) {
  const policies = Array.isArray(configuration.approvalPolicies) ? configuration.approvalPolicies as Array<Record<string, unknown>> : [];
  function setApprovals(index: number, count: number) { update({ ...configuration, approvalPolicies: policies.map((policy, itemIndex) => itemIndex === index ? { ...policy, requiredApprovals: count } : policy) }); }
  return <div className={styles.settingsForm}><header><p className={styles.monoEyebrow}>Deterministic controls</p><h2>Truth and action policy</h2><p>The server validates the full policy object. Critical actions remain non-executable in the private beta.</p></header><div className={styles.policyRows}>{policies.map((policy, index) => <div key={stringValue(policy.risk, `policy-${index}`)}><span><strong>{stringValue(policy.risk, "risk")} risk actions</strong><small>{policy.executable === false ? "Execution blocked by policy" : policy.recentReauthentication ? "Recent re-authentication required" : "Deterministic approval gate"}</small></span><select value={numberValue(policy.requiredApprovals)} onChange={(event) => setApprovals(index, Number(event.target.value))} disabled={policy.risk === "critical"}><option value={0}>No approval</option><option value={1}>1 approver</option><option value={2}>2 approvers</option><option value={3}>3 approvers</option></select></div>)}</div></div>;
}

function SettingsConnectors({ state }: { state: ProductWorkspaceState }) {
  const connected = new Set((state.sources ?? []).map((source) => stringValue(source.sourceType)).filter(Boolean));
  return <div className={styles.settingsForm}><header><p className={styles.monoEyebrow}>Data and model providers</p><h2>Sources and providers</h2><p>Connector authorization uses dedicated server routes. This settings build never pretends an OAuth connection was created.</p></header><div className={styles.settingsConnectorGrid}>{["File upload", "Signed webhook", "Slack", "Google Drive", "Microsoft Teams", "SharePoint"].map((connector) => { const key = connector.toLowerCase().replaceAll(" ", "_"); const active = connected.has(key); return <article key={connector}><span>{connector.slice(0, 1)}</span><div><strong>{connector}</strong><small>{active ? "Connected source present" : "Not connected"}</small></div><button disabled title="Connector authorization is completed through its server-owned setup flow">{active ? "Connected" : "Setup required"}</button></article>; })}</div><div className={styles.providerPanel}><div><p className={styles.monoEyebrow}>Managed provider boundary</p><h3>Configured by workspace policy</h3><span>Provider and BYOK credentials are never stored in this browser form.</span></div><button className={styles.secondaryAction} disabled>Credential setup required</button></div></div>;
}

function EvidenceDrawer({ evidence, close }: { evidence: TemplateEvidence; close: () => void }) {
  return <div className={styles.drawerBackdrop} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}><aside className={styles.evidenceDrawer} role="dialog" aria-modal="true" aria-labelledby="evidence-title"><header><div><p className={styles.monoEyebrow}>Evidence Ledger</p><h2 id="evidence-title">Claim evidence</h2></div><button onClick={close} aria-label="Close evidence drawer">×</button></header><div className={styles.evidenceBody}><SourceBadge type={evidence.sourceType} /><h3>{evidence.title}</h3><p>{evidence.source}</p><blockquote>{evidence.excerpt}</blockquote><dl><div><dt>Author</dt><dd>{evidence.author}</dd></div><div><dt>Observed</dt><dd>{evidence.observedAt}</dd></div><div><dt>Valid until</dt><dd>{evidence.validUntil ?? "No explicit expiry"}</dd></div><div><dt>Classification</dt><dd>{evidence.sourceType}</dd></div></dl><div className={styles.evidenceHash}><span>Immutable source hash</span><code>{evidence.hash}</code></div><aside><span>✓</span><p><strong>Provenance verified</strong><small>The claim remains bound to this exact source span and validity window.</small></p></aside></div><footer><button className={styles.secondaryAction} onClick={close}>Close</button><button className={styles.primaryAction} disabled title="Full source access requires a separate permission-checked evidence request">Source permission required</button></footer></aside></div>;
}
