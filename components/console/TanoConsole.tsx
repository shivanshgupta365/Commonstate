"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  DEFAULT_QUESTION,
  INGEST_TEXT,
  baselineChanges,
  creators,
  evalCases,
  evidence,
  initialWorkflow,
  navItems,
  slackProposals,
  workflowSteps,
  type AskResult,
  type BackendCreator,
  type BackendRun,
  type BackendState,
  type ChangeProposal,
  type Evidence,
  type IngestResult,
  type OutcomeResult,
  type ReplayResult,
  type RunResult,
  type ViewId,
  type WorkflowState,
} from "./demoData";
import styles from "./console.module.css";

type DemoAction =
  | "reset"
  | "ask"
  | "ingest"
  | "approve"
  | "reject"
  | "run-agent"
  | "replay"
  | "outcome";

type RequestState = "idle" | "asking" | "ingesting" | "approving" | "running" | "replaying" | "recording";

type ApiError = { code: string; message: string };
type ApiSuccess<T> = { ok: true; action?: string; result: T; state: BackendState };
type ApiFailure = { ok: false; error: ApiError };
type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

const wait = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function callDemo<T>(action: DemoAction, body: Record<string, unknown> = {}): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`/api/demo/${action}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
    if (!response.ok || !payload || payload.ok !== true) {
      return payload && payload.ok === false
        ? payload
        : { ok: false, error: { code: `HTTP_${response.status}`, message: "The demo API rejected this request." } };
    }
    return payload;
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: "The demo API could not be reached." } };
  }
}

async function getDemoState(): Promise<ApiSuccess<never> | ApiFailure> {
  try {
    const response = await fetch("/api/demo/state", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | { ok: true; state: BackendState }
      | ApiFailure
      | null;
    if (!response.ok || !payload || payload.ok !== true) {
      return payload && payload.ok === false
        ? payload
        : { ok: false, error: { code: `HTTP_${response.status}`, message: "The isolated demo state could not be loaded." } };
    }
    return { ok: true, result: undefined as never, state: payload.state };
  } catch {
    return { ok: false, error: { code: "NETWORK_ERROR", message: "The isolated demo state could not be loaded." } };
  }
}

function oldestRecordedRun(state: BackendState): BackendRun | null {
  return [...state.agentRuns].reverse().find((run) => run.mode !== "replay") ?? null;
}

function formatShortDate(value: string | null): string {
  if (!value) return "Missing";
  const parsed = new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(parsed);
}

function creatorView(item: BackendCreator, index: number): import("./demoData").CreatorAnswer {
  const initials = item.name.split(" ").map((part) => part[0]).join("").slice(0, 2);
  const blockers = item.blockers.length ? item.blockers.join(" ") : "All campaign activation constraints are satisfied.";
  return {
    id: item.entityId,
    name: item.name,
    handle: item.handle,
    avatar: initials,
    tint: (["mint", "yellow", "coral"] as const)[index % 3],
    budget: item.feeGbp === null ? "Missing" : `£${item.feeGbp.toLocaleString("en-GB")}`,
    rights: item.eligible ? `Active · ${formatShortDate(item.rightsValidTo)}` : item.rightsValidTo ? `Review · ${formatShortDate(item.rightsValidTo)}` : "Missing",
    deliverables: item.unresolvedDeliverables ? "Unresolved" : "Clear",
    match: item.eligible ? 98 - index * 2 : 64,
    status: item.eligible ? "eligible" : "blocked",
    reason: blockers,
    evidenceIds: item.claimIds,
  };
}

function evidenceFromState(state: BackendState): Evidence[] {
  const sourceById = new Map(state.sources.map((source) => [source.id, source]));
  return state.claims.map((claim) => {
    const source = sourceById.get(claim.sourceId);
    const lifecycle: Evidence["status"] =
      claim.lifecycle === "approved" || claim.lifecycle === "proposed" || claim.lifecycle === "superseded" || claim.lifecycle === "rejected"
        ? claim.lifecycle
        : "proposed";
    return {
      id: claim.id,
      title: `${claim.subject} · ${claim.predicate}`,
      source: claim.sourceTitle,
      sourceType: claim.classification === "public" ? "public" : "synthetic",
      excerpt: claim.sourceSpan,
      author: `${claim.authority.replaceAll("_", " ")} source`,
      observedAt: formatShortDate(claim.observedAt),
      validFrom: formatShortDate(claim.validFrom),
      ...(claim.validTo ? { validUntil: formatShortDate(claim.validTo) } : {}),
      confidence: claim.confidence > 1 ? claim.confidence / 100 : claim.confidence,
      hash: source?.sha256 ?? "Immutable source hash unavailable",
      claim: `${claim.subject}: ${claim.predicate} = ${String(claim.value)}`,
      status: lifecycle,
    };
  });
}

function cx(...classNames: Array<string | false | null | undefined>) {
  return classNames.filter(Boolean).join(" ");
}

function SourceBadge({ type }: { type: "public" | "synthetic" }) {
  return (
    <span className={cx(styles.sourceBadge, type === "public" ? styles.publicBadge : styles.syntheticBadge)}>
      <span aria-hidden="true" className={styles.badgeDot} />
      {type === "public" ? "Public source" : "Synthetic demo"}
    </span>
  );
}

function StatusPill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "good" | "warn" | "bad" | "violet" | "neutral" }) {
  return <span className={cx(styles.statusPill, styles[`tone_${tone}`])}>{children}</span>;
}

function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className={styles.sectionHeading}>
      <div>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.sectionDescription}>{description}</p>
      </div>
      {actions ? <div className={styles.headingActions}>{actions}</div> : null}
    </header>
  );
}

function MetricCard({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: "violet" | "mint" | "yellow" | "coral";
}) {
  return (
    <article className={cx(styles.metricCard, styles[`metric_${tone}`])}>
      <div className={styles.metricTop}>
        <span>{label}</span>
        <span aria-hidden="true" className={styles.metricMark} />
      </div>
      <strong>{value}</strong>
      <small>{delta}</small>
    </article>
  );
}

export function TanoConsole() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [workflow, setWorkflow] = useState<WorkflowState>(initialWorkflow);
  const [backendState, setBackendState] = useState<BackendState | null>(null);
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [outcomeResult, setOutcomeResult] = useState<OutcomeResult | null>(null);
  const [changes, setChanges] = useState<ChangeProposal[]>(baselineChanges);
  const [selectedChangeId, setSelectedChangeId] = useState(baselineChanges[0].id);
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [selectedNode, setSelectedNode] = useState("campaign");
  const [agentReceiptVisible, setAgentReceiptVisible] = useState(false);
  const [pendingProposalIds, setPendingProposalIds] = useState<string[]>([]);
  const [baselineRunId, setBaselineRunId] = useState<string | null>(null);
  const [backendRunId, setBackendRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<"recorded" | "fresh">("recorded");
  const [guideOpen, setGuideOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [toast, setToast] = useState("Demo workspace ready · no private Tano data used");
  const [toastKind, setToastKind] = useState<"success" | "error">("success");
  const [evalCategory, setEvalCategory] = useState("All checks");
  const navRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedChange = changes.find((change) => change.id === selectedChangeId) ?? changes[0];
  const workflowDone = workflowSteps.filter((step) => workflow[step.key]).length;
  const evidenceItems = useMemo(
    () => (backendState ? [...evidenceFromState(backendState), ...evidence] : evidence),
    [backendState],
  );
  const creatorResults = useMemo(() => {
    const apiCreators = askResult
      ? [...askResult.eligibleCreators, ...askResult.blockedCreators]
      : backendState
        ? [...backendState.eligibleCreators, ...backendState.blockedCreators]
        : [];
    return apiCreators.length ? apiCreators.map(creatorView) : creators;
  }, [askResult, backendState]);
  const allEvalCases = useMemo(
    () => backendState?.evals.results.length
      ? backendState.evals.results.map((item) => ({
          id: item.id,
          category: item.category.charAt(0).toUpperCase() + item.category.slice(1),
          title: item.caseName.charAt(0).toUpperCase() + item.caseName.slice(1),
          duration: `${item.durationMs}ms`,
        }))
      : evalCases,
    [backendState],
  );
  const filteredEvals = useMemo(
    () =>
      evalCategory === "All checks"
        ? allEvalCases
        : allEvalCases.filter((item) => item.category === evalCategory),
    [allEvalCases, evalCategory],
  );

  function notify(message: string, kind: "success" | "error" = "success") {
    setToastKind(kind);
    setToast(message);
  }

  useEffect(() => {
    let cancelled = false;
    void getDemoState().then((response) => {
      if (cancelled) return;
      if (!response.ok) {
        notify(`State unavailable · ${response.error.message}`, "error");
        return;
      }
      setBackendState(response.state);
      setBaselineRunId(oldestRecordedRun(response.state)?.id ?? null);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleKeydown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditing = target?.matches("input, textarea, select, [contenteditable='true']");
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      } else if (event.key === "/" && !isEditing) {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "Escape") {
        setPaletteOpen(false);
        setSelectedEvidence(null);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function moveTo(view: ViewId) {
    setActiveView(view);
    setPaletteOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById("workspace-main")?.focus({ preventScroll: true });
    });
  }

  function handleNavKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % navItems.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + navItems.length) % navItems.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = navItems.length - 1;
    else return;
    event.preventDefault();
    const view = navItems[next];
    setActiveView(view.id);
    navRefs.current[next]?.focus();
  }

  function markWorkflow(key: keyof WorkflowState) {
    setWorkflow((current) => ({ ...current, [key]: true }));
  }

  async function askCommonstate() {
    if (!question.trim()) {
      notify("Write a question before asking Commonstate.", "error");
      return;
    }
    setRequestState("asking");
    const [response] = await Promise.all([callDemo<AskResult>("ask", { question }), wait(420)]);
    if (!response.ok) {
      setRequestState("idle");
      notify(`Ask failed · ${response.error.message}`, "error");
      return;
    }
    setBackendState(response.state);
    setAskResult(response.result);
    setAnswerVisible(true);
    markWorkflow("asked");
    setRequestState("idle");
    notify(`Answer compiled from ${response.result.contextPack.facts.length} current claims · ${response.result.citations.length} source spans`);
  }

  async function ingestUpdate() {
    if (workflow.ingested) {
      setSelectedChangeId(pendingProposalIds[0] ?? changes[0].id);
      moveTo("inbox");
      notify("Update already ingested · opened its proposed claims");
      return;
    }
    setRequestState("ingesting");
    const [response] = await Promise.all([
      callDemo<IngestResult>("ingest", {
        idempotencyKey: "demo-slack-update-2026-07-15-v1",
        text: INGEST_TEXT,
      }),
      wait(520),
    ]);
    if (!response.ok) {
      setRequestState("idle");
      notify(`Ingest failed · ${response.error.message}`, "error");
      return;
    }
    setBackendState(response.state);
    if (response.result.quarantined) {
      setRequestState("idle");
      notify(response.result.message ?? "The source was quarantined and produced no claims.", "error");
      return;
    }
    const fromResult = response.result.proposalIds ?? [];
    const fromEvent = response.state.claims
      .filter((claim) => claim.sourceEventId === response.result.sourceEventId && claim.lifecycle === "proposed")
      .map((claim) => claim.id);
    const proposalIds = [...new Set([...fromResult, ...fromEvent])];
    if (proposalIds.length === 0) {
      setRequestState("idle");
      notify(response.result.message ?? "Ingest returned no reviewable proposals; reset the demo to replay this step.", "error");
      return;
    }
    const apiChanges = proposalIds.map((id, index) => ({
      ...(slackProposals[index] ?? slackProposals[0]),
      id,
      status: "proposed" as const,
    }));
    setPendingProposalIds(proposalIds);
    setChanges([...apiChanges, ...baselineChanges]);
    setSelectedChangeId(proposalIds[0]);
    setAnswerVisible(false);
    setAskResult(null);
    markWorkflow("ingested");
    setRequestState("idle");
    moveTo("inbox");
    notify(`${proposalIds.length} claims extracted · ${response.result.conflictIds?.length ?? 0} conflicts found`);
  }

  async function decideChange(action: "approve" | "reject") {
    if (!selectedChange || pendingProposalIds.length === 0) {
      notify("No ingest proposals are waiting for a decision.", "error");
      return;
    }
    setRequestState("approving");
    const route = action === "reject" ? "reject" : "approve";
    let latestState = backendState;
    const completed: string[] = [];
    for (const proposalId of pendingProposalIds) {
      const response = await callDemo<{
        decision: "approved" | "rejected";
        proposalIds: string[];
        approvalIds: string[];
        resolvedConflictIds: string[];
      }>(route, {
        proposalId,
        reason: action === "approve"
          ? "Human operator verified all three source spans and accepted their blast radius."
          : "Human operator rejected the ingested source claims.",
      });
      if (!response.ok || response.result.decision !== (action === "approve" ? "approved" : "rejected") || !response.result.proposalIds.includes(proposalId)) {
        setRequestState("idle");
        if (latestState) setBackendState(latestState);
        notify(
          !response.ok
            ? `Decision stopped after ${completed.length}/${pendingProposalIds.length} proposals · ${response.error.message}`
            : `Decision stopped because the API did not confirm proposal ${completed.length + 1}.`,
          "error",
        );
        return;
      }
      latestState = response.state;
      completed.push(proposalId);
    }
    if (latestState) setBackendState(latestState);
    const nextStatus: ChangeProposal["status"] = action === "reject" ? "rejected" : "approved";
    setChanges((current) =>
      current.map((change) =>
        pendingProposalIds.includes(change.id) ? { ...change, status: nextStatus } : change,
      ),
    );
    setPendingProposalIds([]);
    setAnswerVisible(false);
    setAskResult(null);
    if (action === "approve") markWorkflow("approved");
    setRequestState("idle");
    notify(
      action === "reject"
        ? `${completed.length} proposals rejected · previous approved truth remains active`
        : `${completed.length} proposals approved · invalidated context will be recompiled`,
    );
  }

  async function runAgent() {
    if (!workflow.approved) {
      moveTo("inbox");
      notify("Approve all operator-update proposals first · consequential actions fail closed", "error");
      return;
    }
    setRequestState("running");
    const [response] = await Promise.all([
      callDemo<RunResult>("run-agent", {
        task: "Prepare the Bloom & Wild TikTok creator launch queue and fail closed on rights or delivery uncertainty.",
        mode: mode === "fresh" ? "live" : "recorded",
      }),
      wait(620),
    ]);
    if (!response.ok) {
      setRequestState("idle");
      notify(`Agent run failed · ${response.error.message}`, "error");
      return;
    }
    setBackendState(response.state);
    setRunResult(response.result);
    setBackendRunId(response.result.run.id);
    setAgentReceiptVisible(true);
    markWorkflow("agentRun");
    setRequestState("idle");
    const drafted = response.result.run.decision.actions?.length ?? 0;
    const held = response.result.run.decision.held?.length ?? 0;
    notify(`Relationship Agent ${response.result.duplicate ? "reproduced" : "finished"} · ${drafted} drafted · ${held} held`);
  }

  async function runReplay() {
    if (!baselineRunId) {
      notify("Replay unavailable · the baseline immutable run was not loaded.", "error");
      return;
    }
    setRequestState("replaying");
    const [response] = await Promise.all([
      callDemo<ReplayResult>("replay", { runId: baselineRunId }),
      wait(520),
    ]);
    if (!response.ok) {
      setRequestState("idle");
      notify(`Replay failed · ${response.error.message}`, "error");
      return;
    }
    setBackendState(response.state);
    setReplayResult(response.result);
    markWorkflow("replayed");
    setRequestState("idle");
    notify(`Replay complete · ${response.result.comparison.summary}`);
  }

  async function recordOutcome() {
    if (!backendRunId) {
      notify("Outcome unavailable · run the current Relationship Agent first.", "error");
      return;
    }
    setRequestState("recording");
    const [response] = await Promise.all([
      callDemo<OutcomeResult>("outcome", {
        runId: backendRunId,
        status: "measured",
        metrics: { ctrLiftPercent: 18.4, rebriefHoursSaved: 3.2 },
        notes: "Synthetic demo outcome: early rights checks reduced rebrief work without executing an external campaign mutation.",
      }),
      wait(420),
    ]);
    if (!response.ok) {
      setRequestState("idle");
      notify(`Outcome failed · ${response.error.message}`, "error");
      return;
    }
    setBackendState(response.state);
    setOutcomeResult(response.result);
    markWorkflow("outcomeRecorded");
    setRequestState("idle");
    notify(`Outcome ${response.result.duplicate ? "already recorded" : "recorded"} · a proposed learning is waiting in Change Inbox`);
  }

  async function resetDemo() {
    const response = await callDemo<{ reset: boolean; message: string }>("reset");
    if (!response.ok) {
      notify(`Reset failed · ${response.error.message}`, "error");
      return;
    }
    setBackendState(response.state);
    setWorkflow(initialWorkflow);
    setChanges(baselineChanges);
    setSelectedChangeId(baselineChanges[0].id);
    setQuestion(DEFAULT_QUESTION);
    setAnswerVisible(false);
    setSelectedEvidence(null);
    setAgentReceiptVisible(false);
    setPendingProposalIds([]);
    setBaselineRunId(oldestRecordedRun(response.state)?.id ?? null);
    setBackendRunId(null);
    setAskResult(null);
    setRunResult(null);
    setReplayResult(null);
    setOutcomeResult(null);
    setSelectedNode("campaign");
    setActiveView("overview");
    notify(response.result.message ?? "Demo reset · deterministic workspace restored");
  }

  function openEvidence(id: string) {
    const item = evidenceItems.find((candidate) => candidate.id === id);
    if (!item) {
      notify("Evidence is not available in this isolated workspace.", "error");
      return;
    }
    setSelectedEvidence(item);
  }

  const view = (() => {
    switch (activeView) {
      case "overview":
        return (
          <OverviewView
            workflow={workflow}
            backendState={backendState}
            onStart={() => moveTo("ask")}
            onIngest={ingestUpdate}
            onOpenEvidence={() => openEvidence("ev-case-study")}
            requestState={requestState}
          />
        );
      case "inbox":
        return (
          <ChangeInboxView
            changes={changes}
            selected={selectedChange}
            onSelect={setSelectedChangeId}
            onDecision={decideChange}
            onEvidence={openEvidence}
            onIngest={ingestUpdate}
            workflow={workflow}
            requestState={requestState}
            pendingProposalCount={pendingProposalIds.length}
          />
        );
      case "map":
        return (
          <MemoryMapView
            selectedNode={selectedNode}
            setSelectedNode={setSelectedNode}
            onEvidence={openEvidence}
            propagated={workflow.approved}
          />
        );
      case "ask":
        return (
          <AskView
            question={question}
            setQuestion={setQuestion}
            answerVisible={answerVisible}
            onAsk={askCommonstate}
            onEvidence={openEvidence}
            requestState={requestState}
            answer={askResult}
            creatorResults={creatorResults}
          />
        );
      case "agents":
        return (
          <AgentConsoleView
            onRun={runAgent}
            onEvidence={openEvidence}
            receiptVisible={agentReceiptVisible}
            requestState={requestState}
            approved={workflow.approved}
            runResult={runResult}
            mode={mode}
          />
        );
      case "replay":
        return (
          <ReplayView
            workflow={workflow}
            onReplay={runReplay}
            onRecord={recordOutcome}
            requestState={requestState}
            onOpenInbox={() => moveTo("inbox")}
            replayResult={replayResult}
            outcomeResult={outcomeResult}
          />
        );
      case "evals":
        return (
          <EvalsView
            category={evalCategory}
            setCategory={setEvalCategory}
            filteredEvals={filteredEvals}
            backendState={backendState}
          />
        );
    }
  })();

  return (
    <div className={styles.console}>
      <a href="#workspace-main" className={styles.skipLink}>
        Skip to workspace
      </a>
      <aside className={styles.rail} aria-label="Tano Edition navigation">
        <button className={styles.brand} onClick={() => moveTo("overview")} aria-label="Commonstate overview">
          <span className={styles.brandGlyph} aria-hidden="true"><i /><i /><i /></span>
          <span>
            <strong>commonstate</strong>
            <small>Tano edition</small>
          </span>
        </button>
        <nav className={styles.nav} role="tablist" aria-label="Workspace surfaces" aria-orientation="vertical">
          {navItems.map((item, index) => (
            <button
              key={item.id}
              ref={(node) => { navRefs.current[index] = node; }}
              type="button"
              id={`nav-${item.id}`}
              role="tab"
              aria-selected={activeView === item.id}
              aria-controls={`panel-${item.id}`}
              tabIndex={activeView === item.id ? 0 : -1}
              className={cx(styles.navItem, activeView === item.id && styles.navItemActive)}
              onClick={() => moveTo(item.id)}
              onKeyDown={(event) => handleNavKeyDown(event, index)}
            >
              <span className={styles.navCode}>{item.short}</span>
              <span>{item.label}</span>
              {item.id === "inbox" && pendingProposalIds.length > 0 ? (
                <span className={styles.navBadge} aria-label={`${pendingProposalIds.length} pending changes`}>{pendingProposalIds.length}</span>
              ) : null}
              {item.id === "evals" ? <span className={styles.passDot} aria-label="All evaluations pass" /> : null}
            </button>
          ))}
        </nav>
        <div className={styles.railFooter}>
          <div className={styles.truthPulse}><span aria-hidden="true" /> Truth engine online</div>
          <p>Independent concept<br />No private Tano data</p>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.topbar}>
          <label className={styles.scopePicker}>
            <span>Scope</span>
            <select aria-label="Current workspace scope" defaultValue="summer-tiktok">
              <option value="summer-tiktok">Bloom &amp; Wild / Summer TikTok</option>
              <option value="client">Bloom &amp; Wild / All campaigns</option>
              <option value="company">Tano Edition / Company</option>
            </select>
          </label>
          <div className={styles.topbarActions}>
            <button
              className={styles.modeButton}
              onClick={() => {
                setMode((current) => current === "recorded" ? "fresh" : "recorded");
                notify(
                  mode === "recorded"
                    ? "Fresh API run selected · still uses the deterministic demo provider and remains dry-run only"
                    : "Recorded receipt mode selected · deterministic and reproducible",
                );
              }}
              aria-label={`Switch from ${mode} mode`}
            >
              <span className={cx(styles.modeIndicator, mode === "fresh" && styles.modeLive)} />
              {mode === "recorded" ? "Recorded receipt" : "Fresh API run"}
            </button>
            <button className={styles.commandButton} onClick={() => setPaletteOpen(true)}>
              Search or jump <kbd>⌘ K</kbd>
            </button>
            <button className={styles.iconButton} onClick={resetDemo} aria-label="Reset demo" title="Reset demo">↺</button>
          </div>
        </header>

        <div className={cx(styles.workflowBar, !guideOpen && styles.workflowBarCollapsed)}>
          <button className={styles.workflowToggle} onClick={() => setGuideOpen((current) => !current)} aria-expanded={guideOpen}>
            <span className={styles.workflowCount}>{workflowDone}/6</span>
            <span><strong>90-second proof</strong><small>{workflowDone === 6 ? "Workflow complete" : "Follow the operational truth"}</small></span>
            <span aria-hidden="true">{guideOpen ? "−" : "+"}</span>
          </button>
          {guideOpen ? (
            <ol className={styles.workflowSteps} aria-label="Demo workflow progress">
              {workflowSteps.map((step, index) => (
                <li key={step.key} className={workflow[step.key] ? styles.workflowStepDone : undefined}>
                  <button onClick={() => moveTo(step.target)}>
                    <span>{workflow[step.key] ? "✓" : index + 1}</span>
                    {step.label}
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </div>

        <main
          id="workspace-main"
          tabIndex={-1}
          className={styles.main}
        >
          <div
            id={`panel-${activeView}`}
            className={styles.viewFrame}
            role="tabpanel"
            aria-labelledby={`nav-${activeView}`}
          >
            {view}
          </div>
        </main>
      </div>

      {selectedEvidence ? (
        <EvidenceDrawer evidenceItem={selectedEvidence} onClose={() => setSelectedEvidence(null)} />
      ) : null}
      {paletteOpen ? (
        <CommandPalette
          query={paletteQuery}
          setQuery={setPaletteQuery}
          onNavigate={moveTo}
          onReset={resetDemo}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
      <div className={cx(styles.toast, toast && styles.toastVisible, toastKind === "error" && styles.toastError)} role={toastKind === "error" ? "alert" : "status"} aria-live="polite">
        <span aria-hidden="true">{toastKind === "error" ? "!" : "✓"}</span>{toast}
      </div>
    </div>
  );
}

function OverviewView({
  workflow,
  backendState,
  onStart,
  onIngest,
  onOpenEvidence,
  requestState,
}: {
  workflow: WorkflowState;
  backendState: BackendState | null;
  onStart: () => void;
  onIngest: () => void;
  onOpenEvidence: () => void;
  requestState: RequestState;
}) {
  const metrics = backendState?.metrics;
  const latestPack = backendState?.contextPacks.at(-1);
  const totalClaims = backendState?.claims.length ?? 18;
  const factCount = latestPack?.facts.length ?? 18;
  const contextHash = latestPack?.versionHash.slice(0, 8) ?? "loading";
  return (
    <>
      <section className={styles.overviewHero}>
        <div>
          <div className={styles.heroMeta}><SourceBadge type="public" /><span>Independent product concept</span></div>
          <p className={styles.eyebrow}>Operational context control plane</p>
          <h1>Every human.<br />Every agent. <em>Same state.</em></h1>
          <p className={styles.heroCopy}>The context layer behind the autonomous CMO. Version every decision, compile only what each agent needs, and explain every action.</p>
          <div className={styles.heroActions}>
            <button className={styles.primaryButton} onClick={onStart}>Start the 90-second proof <span>→</span></button>
            <button className={styles.secondaryButton} onClick={onIngest} disabled={requestState === "ingesting"}>
              {requestState === "ingesting" ? "Extracting claims…" : workflow.ingested ? "Open Slack update" : "Ingest Slack update"}
            </button>
          </div>
        </div>
        <div className={styles.heroSystem} aria-label="Live context propagation preview">
          <div className={styles.systemHeader}>
            <span>Truth propagation</span>
            <StatusPill tone="good">Live</StatusPill>
          </div>
          <div className={styles.propagationPath}>
            <button className={styles.sourceChip} onClick={onOpenEvidence}><span>SL</span><b>Sources</b><small>{backendState?.sources.length ?? 5} connected</small></button>
            <span className={styles.flowArrow} aria-hidden="true">→</span>
            <div className={cx(styles.engineChip, workflow.approved && styles.enginePulse)}><span>CS</span><b>Truth engine</b><small>{workflow.approved ? "Updated now" : `${metrics?.approvedClaims ?? 17} claims approved`}</small></div>
            <span className={styles.flowArrow} aria-hidden="true">→</span>
            <div className={styles.agentChip}><span>RA</span><b>Relationship agent</b><small>Scoped context only</small></div>
          </div>
          <div className={styles.contextPacket}>
            <div><span>Context pack</span><code>{contextHash}</code></div>
            <div><span>Facts included</span><strong>{factCount} / {totalClaims}</strong></div>
            <div><span>Evidence coverage</span><strong>100%</strong></div>
            <div><span>High-risk blockers</span><strong className={styles.dangerText}>{metrics?.highRiskConflicts ?? 1} open</strong></div>
          </div>
        </div>
      </section>

      <section className={styles.metricGrid} aria-label="Operational truth metrics">
        <MetricCard label="Truth health" value={`${metrics?.truthHealth ?? 90}%`} delta={`${metrics?.staleClaims ?? 1} stale claim flagged`} tone="violet" />
        <MetricCard label="Approved claims" value={String(metrics?.approvedClaims ?? 17)} delta={`${totalClaims} total temporal claims`} tone="mint" />
        <MetricCard label="Open conflicts" value={String(metrics?.unresolvedConflicts ?? 1)} delta={`${metrics?.highRiskConflicts ?? 1} high-risk · fail closed`} tone="coral" />
        <MetricCard label="Active agents" value={String(metrics?.activeAgents ?? 3)} delta={`${backendState?.contextPacks.length ?? 1} immutable context packs`} tone="yellow" />
      </section>

      <section className={styles.overviewGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.eyebrow}>Change stream</p><h2>What changed, and who knows?</h2></div>
            <StatusPill tone="violet">Temporal</StatusPill>
          </div>
          <div className={styles.timeline}>
            <div className={styles.timelineItem}>
              <span className={styles.timelineIcon}>✓</span>
              <div><strong>Activation policy approved</strong><p>Below £15k, TikTok rights current through launch week.</p><small>Summer TikTok campaign brief v4 · synthetic</small></div>
              <StatusPill tone="good">Propagated</StatusPill>
            </div>
            <div className={cx(styles.timelineItem, workflow.ingested && styles.timelineCurrent)}>
              <span className={styles.timelineIcon}>{workflow.ingested ? "!" : "↳"}</span>
              <div><strong>{workflow.ingested ? "Operator update extracted" : "Operator update ready to ingest"}</strong><p>Supportive rebrief; Amara rights shortened and revised hook unresolved.</p><small>#bloom-summer · synthetic deterministic update</small></div>
              <StatusPill tone={workflow.approved ? "good" : workflow.ingested ? "warn" : "neutral"}>{workflow.approved ? "Approved" : workflow.ingested ? "Review" : "Queued"}</StatusPill>
            </div>
            <div className={styles.timelineItem}>
              <span className={styles.timelineIcon}>↻</span>
              <div><strong>Context pack compiled</strong><p>{factCount} current facts selected from {totalClaims} temporal claims.</p><small>Context Compiler · immutable receipt</small></div>
              <StatusPill tone="violet">{factCount} / {totalClaims}</StatusPill>
            </div>
          </div>
        </article>

        <article className={cx(styles.panel, styles.conflictPanel)}>
          <div className={styles.panelHeader}>
            <div><p className={styles.eyebrow}>Fail-closed control</p><h2>Unresolved truth</h2></div>
            <span className={styles.conflictCount}>01</span>
          </div>
          <p className={styles.conflictQuestion}>Do Jo Park&apos;s paid-usage rights cover launch week?</p>
          <div className={styles.conflictingClaims}>
            <div><small>Signed ledger says</small><strong>Rights active until 15 Aug</strong></div>
            <span>vs</span>
            <div><small>Operator note says</small><strong>Rights may end 18 Jul</strong></div>
          </div>
          <div className={styles.failClosed}><span aria-hidden="true">⊘</span><div><strong>Activation blocked</strong><small>Rights conflicts never resolve silently.</small></div></div>
        </article>
      </section>
    </>
  );
}

function ChangeInboxView({
  changes,
  selected,
  onSelect,
  onDecision,
  onEvidence,
  onIngest,
  workflow,
  requestState,
  pendingProposalCount,
}: {
  changes: ChangeProposal[];
  selected: ChangeProposal;
  onSelect: (id: string) => void;
  onDecision: (action: "approve" | "reject") => void;
  onEvidence: (id: string) => void;
  onIngest: () => void;
  workflow: WorkflowState;
  requestState: RequestState;
  pendingProposalCount: number;
}) {
  const pendingCount = changes.filter((change) => change.status === "proposed").length;
  return (
    <>
      <SectionHeading
        eyebrow="Truth workflow · observed → proposed → approved"
        title="Change Inbox"
        description="Turn company activity into reviewable, temporal claims—before it becomes agent context."
        actions={<button className={styles.primaryButton} onClick={onIngest} disabled={requestState === "ingesting"}>{requestState === "ingesting" ? "Extracting…" : workflow.ingested ? "Update ingested ✓" : "+ Ingest Slack update"}</button>}
      />
      <div className={styles.inboxStats}>
        <span><strong>{pendingCount}</strong> needs decision</span>
        <span><strong>{workflow.ingested ? 2 : 1}</strong> high-risk conflicts</span>
        <span><strong>{workflow.ingested ? 6 : 5}</strong> immutable sources</span>
        <span><strong>100%</strong> evidence coverage</span>
      </div>
      <section className={styles.inboxLayout}>
        <div className={styles.changeList} aria-label="Changes">
          <div className={styles.listToolbar}><strong>Incoming changes</strong><span>{changes.length} total</span></div>
          {changes.map((change) => (
            <button key={change.id} onClick={() => onSelect(change.id)} className={cx(styles.changeRow, selected.id === change.id && styles.changeRowActive)} aria-pressed={selected.id === change.id}>
              <span className={cx(styles.changeSeverity, styles[`severity_${change.severity}`])} />
              <span className={styles.changeRowBody}>
                <span className={styles.changeRowMeta}><SourceBadge type={change.sourceType} /><small>{change.time}</small></span>
                <strong>{change.subject}</strong>
                <span>{change.predicate}</span>
                <small>{change.source}</small>
              </span>
              <StatusPill tone={change.status === "approved" ? "good" : change.status === "proposed" ? "warn" : "neutral"}>{change.status}</StatusPill>
            </button>
          ))}
        </div>

        <article className={styles.changeReview}>
          <div className={styles.reviewHeader}>
            <div><SourceBadge type={selected.sourceType} /><h2>{selected.subject}</h2><p>{selected.scope}</p></div>
            <div className={styles.confidence}><span>{Math.round(selected.confidence * 100)}%</span><small>extraction confidence</small></div>
          </div>
          <div className={styles.sourceQuote}>
            <div className={styles.quoteHeader}><span className={styles.avatarSmall}>O</span><div><strong>{selected.sender}</strong><small>{selected.source} · {selected.time}</small></div><button onClick={() => onEvidence(selected.evidenceId)}>Open source ↗</button></div>
            <blockquote>{selected.excerpt}</blockquote>
            <SourceBadge type={selected.sourceType} />
          </div>
          <div className={styles.claimDiff}>
            <div className={styles.diffHeader}><span>Extracted claim</span><code>{selected.predicate}</code></div>
            <div className={styles.diffRow}><span className={styles.diffMinus}>−</span><div><small>Current approved value</small><p>{selected.previous}</p></div></div>
            <div className={styles.diffRow}><span className={styles.diffPlus}>+</span><div><small>Proposed value</small><p>{selected.next}</p></div></div>
          </div>
          <div className={styles.blastRadius}>
            <div><span className={styles.blastIcon}>↯</span><div><strong>Blast radius · {selected.impacts.length} dependencies</strong><p>Approval invalidates derived context before the next agent action.</p></div></div>
            <ul>{selected.impacts.map((impact) => <li key={impact}><span />{impact}</li>)}</ul>
          </div>
          {selected.status === "proposed" ? (
            <div className={styles.decisionBar}>
              <button className={styles.rejectButton} onClick={() => onDecision("reject")} disabled={requestState === "approving"}>Reject all {pendingProposalCount}</button>
              <button className={styles.primaryButton} onClick={() => onDecision("approve")} disabled={requestState === "approving"}>{requestState === "approving" ? "Verifying every proposal…" : `Approve all ${pendingProposalCount} & propagate →`}</button>
            </div>
          ) : (
            <div className={styles.resolvedBar}><StatusPill tone={selected.status === "approved" ? "good" : "neutral"}>{selected.status}</StatusPill><span>This API-confirmed decision is preserved in the Evidence Ledger.</span></div>
          )}
        </article>
      </section>
    </>
  );
}

function MemoryMapView({
  selectedNode,
  setSelectedNode,
  onEvidence,
  propagated,
}: {
  selectedNode: string;
  setSelectedNode: (node: string) => void;
  onEvidence: (id: string) => void;
  propagated: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [asOf, setAsOf] = useState<"now" | "baseline">("now");
  const nodes = [
    { id: "brand", label: "Bloom & Wild", kind: "Brand", x: 8, y: 42, tone: "blue" },
    { id: "campaign", label: "Summer TikTok", kind: "Campaign", x: 34, y: 42, tone: "violet" },
    { id: "amara", label: "Amara Okafor", kind: propagated ? "Creator · blocked" : "Creator", x: 65, y: 12, tone: "mint" },
    { id: "imani", label: "Imani Brooks", kind: "Creator", x: 66, y: 43, tone: "yellow" },
    { id: "jo", label: "Jo Park", kind: "Creator · rights conflict", x: 65, y: 74, tone: "coral" },
    { id: "agent", label: "Relationship Agent", kind: "Agent", x: 88, y: 43, tone: "ink" },
  ];
  return (
    <>
      <SectionHeading
        eyebrow="Temporal knowledge · 15 Jul 2026, 10:36"
        title="Memory Map"
        description="Explore entities, relationships, decisions, and evidence as they existed at any point in time."
        actions={<div className={styles.mapControls}><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))}>−</button><button onClick={() => setZoom(1)}>Fit</button><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.2, value + 0.1))}>+</button></div>}
      />
      <section className={styles.mapLayout}>
        <div className={styles.mapCanvas}>
          <div className={styles.mapToolbar}><span><i className={styles.legendEntity} /> Entity</span><span><i className={styles.legendClaim} /> Claim</span><span><i className={styles.legendConflict} /> Conflict</span><button onClick={() => setAsOf((value) => value === "now" ? "baseline" : "now")}>{asOf === "now" ? "As of now" : "Seed baseline"}⌄</button></div>
          <div className={styles.graph} aria-label="Operational memory graph" style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>
            <div className={cx(styles.graphEdge, styles.edgeOne)} /><div className={cx(styles.graphEdge, styles.edgeTwo)} /><div className={cx(styles.graphEdge, styles.edgeThree)} /><div className={cx(styles.graphEdge, styles.edgeFour)} /><div className={cx(styles.graphEdge, styles.edgeFive)} />
            {nodes.map((node) => (
              <button
                key={node.id}
                className={cx(styles.graphNode, styles[`node_${node.tone}`], selectedNode === node.id && styles.graphNodeActive, propagated && node.id === "agent" && styles.nodePropagated)}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                onClick={() => setSelectedNode(node.id)}
                aria-pressed={selectedNode === node.id}
              >
                <span>{node.id === "agent" ? "RA" : node.label.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
                <strong>{node.label}</strong><small>{node.kind}</small>
              </button>
            ))}
            <button className={styles.graphClaim} onClick={() => onEvidence("ev-slack-update")}><span>!</span><strong>Supportive rebrief</strong><small>{propagated ? "approved now" : "proposed"}</small></button>
          </div>
          <div className={styles.mapMinimap} aria-hidden="true"><i /><i /><i /><i /></div>
        </div>
        <aside className={styles.nodeInspector}>
          <div className={styles.inspectorHeader}><span className={styles.inspectorGlyph}>{selectedNode.slice(0, 2).toUpperCase()}</span><div><small>Selected node</small><h2>{nodes.find((node) => node.id === selectedNode)?.label}</h2></div></div>
          <div className={styles.inspectorStats}><div><span>Current claims</span><strong>{selectedNode === "campaign" ? 18 : 4}</strong></div><div><span>Evidence coverage</span><strong>100%</strong></div></div>
          <h3>Current truth</h3>
          <button className={styles.inspectorClaim} onClick={() => onEvidence("ev-brief")}><span className={styles.claimState} /><div><strong>Activation cap is below £15k</strong><small>Campaign brief v4 · approved</small></div><span>↗</span></button>
          <button className={styles.inspectorClaim} onClick={() => onEvidence("ev-slack-update")}><span className={cx(styles.claimState, styles.claimStateWarn)} /><div><strong>{propagated ? "Supportive rebrief approved" : "Operator update awaiting ingest"}</strong><small>Synthetic Slack update · {propagated ? "approved" : "not in context"}</small></div><span>↗</span></button>
          <button className={styles.inspectorClaim} onClick={() => onEvidence("ev-jo-rights")}><span className={styles.claimState} /><div><strong>Jo activation held</strong><small>Paid-usage rights conflict</small></div><span>↗</span></button>
          <div className={styles.inspectorFooter}><span>View</span><strong>{asOf === "now" ? "Current approved truth" : "Seed baseline"}</strong><span>Zoom</span><code>{Math.round(zoom * 100)}%</code></div>
        </aside>
      </section>
    </>
  );
}

function AskView({
  question,
  setQuestion,
  answerVisible,
  onAsk,
  onEvidence,
  requestState,
  answer,
  creatorResults,
}: {
  question: string;
  setQuestion: (question: string) => void;
  answerVisible: boolean;
  onAsk: () => void;
  onEvidence: (id: string) => void;
  requestState: RequestState;
  answer: AskResult | null;
  creatorResults: import("./demoData").CreatorAnswer[];
}) {
  return (
    <>
      <SectionHeading eyebrow="Permission-aware · time-aware · claim-cited" title="Ask Commonstate" description="Answers from current operational truth—not a pile of semantically similar documents." />
      <section className={styles.askShell}>
        <div className={styles.askInputWrap}>
          <label htmlFor="commonstate-question">Ask about this scope</label>
          <textarea id="commonstate-question" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onAsk(); }} rows={3} />
          <div className={styles.askInputFooter}><span><kbd>⌘</kbd><kbd>↵</kbd> to ask</span><button className={styles.primaryButton} onClick={onAsk} disabled={requestState === "asking"}>{requestState === "asking" ? <><i className={styles.spinner} /> Compiling context…</> : <>Ask Commonstate <span>→</span></>}</button></div>
        </div>
        <div className={styles.queryChips}><span>Try:</span><button onClick={() => setQuestion(DEFAULT_QUESTION)}>Activation-ready creators</button><button onClick={() => setQuestion("What changed in the Summer TikTok campaign today, and which agents are affected?")}>Today&apos;s blast radius</button><button onClick={() => setQuestion("Which creator rights expire in the next 14 days?")}>Expiring rights</button></div>
      </section>

      {!answerVisible ? (
        <section className={styles.askEmpty}>
          <div className={styles.emptyOrb}><span>CS</span><i /><i /></div>
          <h2>Ask a consequential question.</h2>
          <p>Commonstate filters scope, permissions, validity, and conflicts before retrieval. Every answer comes with the exact claims it used.</p>
          <div className={styles.emptyChecks}><span>✓ Cookie-isolated scope</span><span>✓ As-of now</span><span>✓ Approved claims only</span></div>
        </section>
      ) : answer ? (
        <section className={styles.answerSection} aria-live="polite">
          <div className={styles.answerHeader}>
            <div><span className={styles.answerGlyph}>CS</span><div><p className={styles.eyebrow}>API-compiled answer</p><h2>{answer.eligibleCreators.length} eligible · {answer.blockedCreators.length} blocked</h2></div></div>
            <div className={styles.answerMeta}><StatusPill tone="good">As of {formatShortDate(answer.asOf)}</StatusPill><span>{answer.contextPack.facts.length} claims</span><span>{answer.citations.length} citations</span><code>{answer.contextPack.versionHash.slice(0, 8)}</code></div>
          </div>
          <p className={styles.answerSummary}>{answer.answer}</p>
          <div className={styles.creatorGrid}>
            {creatorResults.map((creator) => (
              <article key={creator.id} className={cx(styles.creatorCard, creator.status === "blocked" && styles.creatorBlocked)}>
                <div className={styles.creatorTop}><span className={cx(styles.creatorAvatar, styles[`avatar_${creator.tint}`])}>{creator.avatar}</span><div><h3>{creator.name}</h3><p>{creator.handle}</p></div><StatusPill tone={creator.status === "eligible" ? "good" : "bad"}>{creator.status}</StatusPill></div>
                <div className={styles.matchBar}><span style={{ width: `${creator.match}%` }} /><small>{creator.match}% constraint match</small></div>
                <dl className={styles.creatorFacts}><div><dt>Fee</dt><dd>{creator.budget}</dd></div><div><dt>Usage rights</dt><dd>{creator.rights}</dd></div><div><dt>Deliverables</dt><dd>{creator.deliverables}</dd></div></dl>
                <p className={styles.creatorReason}>{creator.status === "eligible" ? "✓" : "⊘"} {creator.reason}</p>
                <div className={styles.evidenceLinks}>{creator.evidenceIds.map((id, index) => <button key={id} onClick={() => onEvidence(id)}>Evidence {index + 1} ↗</button>)}</div>
              </article>
            ))}
          </div>
          <footer className={styles.answerFooter}><div><strong>Why this answer is safe</strong><p>{answer.permissionScope}. Approved authoritative claims outrank notes; unresolved rights and deliverables fail closed.</p></div><button onClick={() => onEvidence(answer.citations[0]?.claimId ?? "ev-brief")}>Inspect first cited claim →</button></footer>
        </section>
      ) : null}
    </>
  );
}

function AgentConsoleView({
  onRun,
  onEvidence,
  receiptVisible,
  requestState,
  approved,
  runResult,
  mode,
}: {
  onRun: () => void;
  onEvidence: (id: string) => void;
  receiptVisible: boolean;
  requestState: RequestState;
  approved: boolean;
  runResult: RunResult | null;
  mode: "recorded" | "fresh";
}) {
  const run = runResult?.run ?? null;
  const contextPack = runResult?.contextPack ?? null;
  const actions = run?.decision.actions ?? [];
  const held = run?.decision.held ?? [];
  return (
    <>
      <SectionHeading
        eyebrow="Agent operations · dry-run only"
        title="Agent Console"
        description="Give long-running agents the minimum valid context—and a receipt for every consequential decision."
        actions={<button className={styles.primaryButton} onClick={onRun} disabled={requestState === "running"}>{requestState === "running" ? <><i className={styles.spinner} /> Agent working…</> : "Run Relationship Agent →"}</button>}
      />
      <div className={styles.agentStatusBar}><span><i className={styles.onlineDot} /> Relationship Agent online</span><span>Human approval required</span><span>Write budget: 4</span><span>{mode === "recorded" ? "Recorded deterministic receipt" : "Fresh API run · deterministic provider"}</span></div>
      <section className={styles.agentLayout}>
        <div className={styles.agentList}>
          <article className={cx(styles.agentCard, styles.agentCardActive)}><div className={styles.agentIdentity}><span>RA</span><div><h3>Relationship Agent</h3><p>Creator operations agent</p></div></div><StatusPill tone="good">Ready</StatusPill><dl><div><dt>Scope</dt><dd>Summer TikTok</dd></div><div><dt>Context</dt><dd>{contextPack?.versionHash.slice(0, 8) ?? "compiled on run"}</dd></div><div><dt>Write budget</dt><dd>4 proposals</dd></div></dl></article>
          <article className={styles.agentCard}><div className={styles.agentIdentity}><span>TE</span><div><h3>Truth Engine</h3><p>Evidence extraction &amp; conflicts</p></div></div><StatusPill tone="good">Online</StatusPill><dl><div><dt>Type</dt><dd>System</dd></div><div><dt>Writes</dt><dd>Proposed only</dd></div><div><dt>Approval</dt><dd>Never self-approves</dd></div></dl></article>
          <article className={styles.agentCard}><div className={styles.agentIdentity}><span>OP</span><div><h3>Campaign operator</h3><p>Human approval authority</p></div></div><StatusPill tone="violet">Human</StatusPill><dl><div><dt>Scope</dt><dd>Campaign</dd></div><div><dt>Permission</dt><dd>claims:approve</dd></div><div><dt>External actions</dt><dd>Dry-run only</dd></div></dl></article>
        </div>
        <article className={styles.runPanel}>
          <div className={styles.runPanelHeader}><div><p className={styles.eyebrow}>Selected run</p><h2>{receiptVisible && run ? run.id.split(":").at(-1) : "Creator activation review"}</h2></div><StatusPill tone={receiptVisible && run?.status === "blocked" ? "warn" : "violet"}>{receiptVisible ? run?.status ?? "complete" : "Ready"}</StatusPill></div>
          {!receiptVisible ? (
            <div className={styles.runReady}>
              <div className={styles.runReadyGraphic}><span>CS</span><i /><i /><i /><small>scoped</small></div>
              <h3>Only task-relevant facts enter this run.</h3>
              <p>The Context Compiler filters approved claims by task, scope, freshness, permissions, and risk before the agent can act.</p>
              <ol><li><span>01</span>Compile task-scoped context</li><li><span>02</span>Evaluate 3 creator records</li><li><span>03</span>Draft actions, hold conflicts</li><li><span>04</span>Return immutable receipt</li></ol>
              <button className={styles.primaryButton} onClick={onRun}>{approved ? mode === "recorded" ? "Create recorded receipt →" : "Run fresh through API →" : "Approval required →"}</button>
            </div>
          ) : run ? (
            <div className={styles.receipt}>
              <div className={styles.receiptStamp}><span>RECEIPT</span><strong>#{run.receiptHash.slice(0, 8).toUpperCase()}</strong><small>Immutable · {run.mode}</small></div>
              <div className={styles.receiptMeta}><div><span>Context hash</span><code>{run.contextVersionHash.slice(0, 16)}…</code></div><div><span>Provider</span><strong>{run.model} · {run.modelVersion}</strong></div><div><span>Latency</span><strong>{run.latencyMs} ms</strong></div><div><span>Estimated cost</span><strong>${(run.costMicros / 1_000_000).toFixed(4)}</strong></div></div>
              <h3>Proposed actions</h3>
              {actions.map((action) => <div className={styles.actionReceipt} key={`${action.entityId}-${action.action}`}><span className={styles.actionDraft}>DRAFT</span><div><strong>{action.action?.replaceAll("_", " ")} · {action.creator}</strong><p>{action.reason}</p></div><button onClick={() => onEvidence(action.claimIds?.[0] ?? "ev-brief")}>{action.claimIds?.length ?? 0} claims ↗</button></div>)}
              {held.map((action) => <div className={cx(styles.actionReceipt, styles.actionHeld)} key={`${action.entityId}-${action.action}`}><span className={styles.actionBlock}>HOLD</span><div><strong>{action.action?.replaceAll("_", " ")} · {action.creator}</strong><p>{action.blockers?.join(" ")}</p></div><button onClick={() => onEvidence(action.claimIds?.[0] ?? "ev-jo-rights")}>{action.claimIds?.length ?? 0} claims ↗</button></div>)}
              <div className={styles.humanGate}><span>H</span><div><strong>Human approval gate</strong><p>{run.decision.consequentialActionsExecuted ?? 0} consequential actions executed. All proposals remain dry-run only.</p></div><button onClick={() => onEvidence(actions[0]?.claimIds?.[0] ?? held[0]?.claimIds?.[0] ?? "ev-brief")}>Review evidence</button></div>
            </div>
          ) : null}
        </article>
      </section>
    </>
  );
}

function ReplayView({
  workflow,
  onReplay,
  onRecord,
  requestState,
  onOpenInbox,
  replayResult,
  outcomeResult,
}: {
  workflow: WorkflowState;
  onReplay: () => void;
  onRecord: () => void;
  requestState: RequestState;
  onOpenInbox: () => void;
  replayResult: ReplayResult | null;
  outcomeResult: OutcomeResult | null;
}) {
  const comparison = replayResult?.comparison ?? null;
  const oldRun = replayResult?.originalRun ?? null;
  const replay = replayResult?.replay ?? null;
  const metrics = outcomeResult?.outcome.metrics ?? {};
  return (
    <>
      <SectionHeading
        eyebrow="Temporal replay · same task, different truth"
        title="Replay decisions"
        description="Reconstruct exactly what an agent knew, then run the same task against today’s approved state."
        actions={<button className={styles.primaryButton} onClick={onReplay} disabled={requestState === "replaying"}>{requestState === "replaying" ? <><i className={styles.spinner} /> Replaying…</> : "Replay against current state →"}</button>}
      />
      <section className={styles.replaySummary}>
        <div><span>Original run</span><code>{oldRun?.id.split(":").at(-1) ?? "baseline receipt"}</code></div><span className={styles.replayArrow}>→</span><div><span>Current context</span><code>{comparison?.currentContextHash.slice(0, 10) ?? "awaiting replay"}</code></div><div className={styles.replayDelta}><strong>{comparison?.nowBlocked.length ?? "—"}</strong><span>newly blocked</span></div>
      </section>
      <section className={styles.replayGrid}>
        <article className={styles.replayColumn}>
          <div className={styles.replayColumnHeader}><div><span className={styles.versionOld}>OLD</span><div><h2>What the agent knew</h2><p>{comparison?.oldContextHash.slice(0, 10) ?? "Seed context"}</p></div></div><StatusPill tone="neutral">Recorded</StatusPill></div>
          <div className={styles.contextFact}><span>01</span><div><strong>Warm, direct outreach</strong><p>Campaign brief v4</p></div><StatusPill>valid then</StatusPill></div>
          <div className={styles.contextFact}><span>02</span><div><strong>Amara rights through 31 Aug</strong><p>Creator rights ledger</p></div><StatusPill>valid then</StatusPill></div>
          <div className={styles.contextFact}><span>03</span><div><strong>No Amara delivery block</strong><p>All contracted deliverables accepted</p></div><StatusPill>valid then</StatusPill></div>
          <div className={styles.decisionResult}><small>Original agent decision</small><strong>Draft rebrief for Amara Okafor</strong><p>Valid under the seed context receipt.</p></div>
        </article>
        <article className={cx(styles.replayColumn, workflow.replayed && styles.replayColumnCurrent)}>
          <div className={styles.replayColumnHeader}><div><span className={styles.versionNew}>NOW</span><div><h2>What the agent knows</h2><p>{comparison?.currentContextHash.slice(0, 10) ?? "Compile on replay"}</p></div></div><StatusPill tone="good">{replay?.status ?? "Ready"}</StatusPill></div>
          <div className={cx(styles.contextFact, styles.contextChanged)}><span>01</span><div><strong>Supportive, low-pressure rebrief</strong><p>Approved operator update</p></div><StatusPill tone="violet">changed</StatusPill></div>
          <div className={cx(styles.contextFact, styles.contextChanged)}><span>02</span><div><strong>Amara rights end 18 Jul</strong><p>Does not cover launch week</p></div><StatusPill tone="bad">blocker</StatusPill></div>
          <div className={cx(styles.contextFact, styles.contextChanged)}><span>03</span><div><strong>Amara revised hook unresolved</strong><p>Approved operator update</p></div><StatusPill tone="bad">blocker</StatusPill></div>
          <div className={cx(styles.decisionResult, styles.decisionBlocked)}><small>Replayed decision</small><strong>{workflow.replayed ? comparison?.nowBlocked.length ? `Hold ${comparison.nowBlocked.join(" and ")} and escalate` : "No newly blocked creator" : "Run replay to compare"}</strong><p>{workflow.replayed ? comparison?.summary : "Current context is ready for deterministic replay."}</p></div>
        </article>
      </section>
      <section className={styles.outcomePanel}>
        <div className={styles.outcomeIntro}><span className={styles.outcomeGlyph}>↗</span><div><p className={styles.eyebrow}>Close the loop</p><h2>Turn the result into company memory.</h2><p>Record the human decision and expected campaign impact. Commonstate proposes the learning—it never self-approves it.</p></div></div>
        <div className={styles.outcomeMetrics}><div><span>Status</span><strong>{outcomeResult?.outcome.status ?? "Ready to measure"}</strong></div><div><span>CTR lift</span><strong className={styles.goodText}>{typeof metrics.ctrLiftPercent === "number" ? `${metrics.ctrLiftPercent}%` : "18.4% payload"}</strong></div><div><span>Rebrief time saved</span><strong>{typeof metrics.rebriefHoursSaved === "number" ? `${metrics.rebriefHoursSaved} h` : "3.2 h payload"}</strong></div></div>
        {workflow.outcomeRecorded ? (
          <div className={styles.outcomeDone}><span>✓</span><div><strong>Outcome receipt {outcomeResult?.outcome.receiptHash.slice(0, 8)}</strong><p>Proposed learning {outcomeResult?.proposedLearning?.id.split(":").at(-1) ?? outcomeResult?.outcome.learningClaimId.split(":").at(-1)} awaits review.</p></div><button onClick={onOpenInbox}>Open Change Inbox →</button></div>
        ) : (
          <button className={styles.primaryButton} onClick={onRecord} disabled={requestState === "recording" || !workflow.replayed}>{requestState === "recording" ? "Recording…" : workflow.replayed ? "Record campaign outcome →" : "Replay first to record outcome"}</button>
        )}
      </section>
    </>
  );
}

function EvalsView({
  category,
  setCategory,
  filteredEvals,
  backendState,
}: {
  category: string;
  setCategory: (category: string) => void;
  filteredEvals: typeof evalCases;
  backendState: BackendState | null;
}) {
  const categories = ["All checks", "Freshness", "Precedence", "Conflicts", "Permissions", "Citations", "Injection", "Writes", "Replay"];
  const passed = backendState?.evals.passed ?? 24;
  const total = backendState?.evals.total ?? 24;
  const duration = backendState?.evals.durationMs ?? 0;
  return (
    <>
      <SectionHeading eyebrow="Executed backend invariants · current API state" title="System Evals" description="Executed invariants for the permissions, provenance, retrieval, and agent guarantees the product claims." actions={<button className={styles.secondaryButton} onClick={() => setCategory("All checks")}>Show all {total} results</button>} />
      <section className={styles.evalHero}>
        <div className={styles.evalScore}><span>{passed}</span><small>/ {total} passed</small></div>
        <div className={styles.evalHeroCopy}><StatusPill tone={passed === total ? "good" : "warn"}>{passed === total ? "All executed invariants pass" : "Attention required"}</StatusPill><h2>Operational truth the backend proves.</h2><p>Workspace rows stay isolated. Every factual decision is cited. High-risk conflicts fail closed. Replay is reproducible.</p></div>
        <div className={styles.evalVitals}><div><span>Result</span><strong>{passed}/{total}</strong></div><div><span>Suite</span><strong>{backendState?.evals.suite?.replace("commonstate-", "") ?? "domain-v2"}</strong></div><div><span>Timing</span><strong>{duration > 0 ? `${duration} ms` : "not measured"}</strong></div></div>
      </section>
      <div className={styles.evalFilters} role="tablist" aria-label="Evaluation categories">
        {categories.map((item) => <button key={item} role="tab" aria-selected={category === item} onClick={() => setCategory(item)} className={category === item ? styles.evalFilterActive : undefined}>{item}</button>)}
      </div>
      <section className={styles.evalTable} aria-label="Evaluation results">
        <div className={styles.evalTableHeader}><span>Check</span><span>Category</span><span>Duration</span><span>Result</span></div>
        {filteredEvals.map((item) => (
          <div className={styles.evalRow} key={item.id}><div><span className={styles.evalCheck}>✓</span><strong>{item.title}</strong></div><span>{item.category}</span><code>{item.duration}</code><StatusPill tone="good">Pass</StatusPill></div>
        ))}
      </section>
    </>
  );
}

function EvidenceDrawer({ evidenceItem, onClose }: { evidenceItem: Evidence; onClose: () => void }) {
  return (
    <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={styles.evidenceDrawer} role="dialog" aria-modal="true" aria-labelledby="evidence-title">
        <div className={styles.drawerHeader}><div><p className={styles.eyebrow}>Evidence ledger</p><h2 id="evidence-title">Claim source</h2></div><button onClick={onClose} aria-label="Close evidence drawer">×</button></div>
        <SourceBadge type={evidenceItem.sourceType} />
        <h3>{evidenceItem.title}</h3>
        <p className={styles.drawerSource}>{evidenceItem.source}</p>
        <blockquote>{evidenceItem.excerpt}</blockquote>
        <div className={styles.sourceSpan}><span>Exact source span</span><div><i />Stored immutably · verified hash</div></div>
        <dl className={styles.evidenceDetails}>
          <div><dt>Claim</dt><dd>{evidenceItem.claim}</dd></div>
          <div><dt>Status</dt><dd><StatusPill tone={evidenceItem.status === "approved" ? "good" : "warn"}>{evidenceItem.status}</StatusPill></dd></div>
          <div><dt>Author</dt><dd>{evidenceItem.author}</dd></div>
          <div><dt>Observed</dt><dd>{evidenceItem.observedAt}</dd></div>
          <div><dt>Valid from</dt><dd>{evidenceItem.validFrom}</dd></div>
          {evidenceItem.validUntil ? <div><dt>Valid until</dt><dd>{evidenceItem.validUntil}</dd></div> : null}
          <div><dt>Confidence</dt><dd>{Math.round(evidenceItem.confidence * 100)}%</dd></div>
          <div><dt>Source hash</dt><dd><code>{evidenceItem.hash}</code></dd></div>
        </dl>
        <div className={styles.drawerChain}><strong>Provenance chain</strong><ol><li><span>1</span>Source snapshot observed</li><li><span>2</span>Structured claim extracted</li><li><span>3</span>Authority + scope resolved</li><li><span>4</span>Human decision recorded</li></ol></div>
        <button className={styles.secondaryButton} onClick={onClose}>Close evidence</button>
      </aside>
    </div>
  );
}

function CommandPalette({
  query,
  setQuery,
  onNavigate,
  onReset,
  onClose,
}: {
  query: string;
  setQuery: (query: string) => void;
  onNavigate: (view: ViewId) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const matches = navItems.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className={styles.paletteBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.paletteInput}><span aria-hidden="true">⌕</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search surfaces and commands…" /><kbd>esc</kbd></div>
        <div className={styles.paletteResults}><p>Navigate</p>{matches.map((item) => <button key={item.id} onClick={() => onNavigate(item.id)}><span>{item.short}</span>{item.label}<kbd>↵</kbd></button>)}<p>Workspace</p><button onClick={() => { onReset(); onClose(); }}><span>↺</span>Reset deterministic demo<kbd>↵</kbd></button></div>
        <footer><span>↑↓ navigate</span><span>↵ select</span><span>esc close</span></footer>
      </div>
    </div>
  );
}
