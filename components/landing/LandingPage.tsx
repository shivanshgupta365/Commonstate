import Link from "next/link";
import { LivePreview } from "./LivePreview";
import styles from "./landing.module.css";

const systemLayers = [
  {
    number: "01",
    title: "Evidence ledger",
    copy: "Turn source events into typed claims with provenance, authority, scope, and valid time.",
    meta: "Source span · hash · author",
    tone: "violet",
  },
  {
    number: "02",
    title: "Truth workflow",
    copy: "Approve, reject, merge, or supersede. Contradictions stay visible until a human resolves them.",
    meta: "Observed → approved → expired",
    tone: "coral",
  },
  {
    number: "03",
    title: "Context compiler",
    copy: "Give each agent the smallest permissioned set of current facts it needs for the task.",
    meta: "Scoped · fresh · deterministic",
    tone: "sky",
  },
  {
    number: "04",
    title: "Blast radius",
    copy: "See which scheduled actions and context packs become invalid when operational truth changes.",
    meta: "Dependencies · alerts · holds",
    tone: "yellow",
  },
  {
    number: "05",
    title: "Agent receipts",
    copy: "Inspect the exact claims, tools, prompts, costs, and approvals behind every proposed action.",
    meta: "Cited · audited · explainable",
    tone: "mint",
  },
  {
    number: "06",
    title: "Temporal replay",
    copy: "Reconstruct what an agent knew then—and test the same run against what the company knows now.",
    meta: "As-of state · diffs · outcomes",
    tone: "pink",
  },
] as const;

const comparisonRows = [
  ["Returns", "Documents and summaries", "Current, typed operational claims"],
  ["Understands", "What was written", "What is valid now"],
  ["Permissions", "At the document boundary", "At workspace, claim, and agent scope"],
  ["On conflict", "Picks a plausible answer", "Exposes the conflict and fails closed"],
  ["For agents", "More context", "The minimum safe context"],
  ["After action", "A chat transcript", "An immutable, cited receipt"],
] as const;

const evals = [
  { value: "24", label: "deterministic scenarios", detail: "freshness to prompt injection" },
  { value: "0", label: "uncited actions allowed", detail: "claim-level evidence required" },
  { value: "<750ms", label: "context pack p95 gate", detail: "on the seeded workspace" },
  { value: "100%", label: "replayable run state", detail: "from the same context hash" },
] as const;

function Wordmark() {
  return (
    <span className={styles.wordmark} aria-label="Commonstate">
      <span className={styles.wordmarkMark} aria-hidden="true">
        <span />
        <span />
      </span>
      commonstate
    </span>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

export function LandingPage() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>

      <header className={styles.siteHeader}>
        <div className={styles.headerInner}>
          <Link className={styles.brandLink} href="/" aria-label="Commonstate home">
            <Wordmark />
          </Link>

          <nav className={styles.nav} aria-label="Primary navigation">
            <a href="#system">System</a>
            <a href="#tano-edition">Tano edition</a>
            <a href="#proof">Evals</a>
          </nav>

          <Link className={styles.headerCta} href="/tano">
            Enter workspace <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>

      <div id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <div className={styles.eyebrowRow}>
                <span className={styles.eyebrow}>Operational context control plane</span>
                <span className={styles.editionPill}>Tano edition</span>
              </div>

              <h1 id="hero-title" className={styles.heroTitle}>
                Every human.
                <br />
                Every agent.
                <br />
                <span>Same state.</span>
              </h1>

              <p className={styles.heroLead}>
                One living, permissioned operational truth—compiled for the task,
                cited to the source, and replayable after every action.
              </p>

              <div className={styles.heroActions}>
                <Link className={styles.primaryButton} href="/tano">
                  Explore the Tano edition <Arrow />
                </Link>
                <a className={styles.secondaryButton} href="#system">
                  See how it works <span aria-hidden="true">↓</span>
                </a>
              </div>

              <div className={styles.heroFootnote}>
                <span className={styles.liveDot} aria-hidden="true" />
                <span>Recorded deterministic workspace</span>
                <span className={styles.footnoteDivider} aria-hidden="true" />
                <span>Independent Tano concept</span>
              </div>
            </div>

            <div className={styles.heroPreview}>
              <div className={styles.previewLabel} aria-hidden="true">
                <span>Live system preview</span>
                <span>01 / 03</span>
              </div>
              <LivePreview />
              <div className={styles.previewUnderlay} aria-hidden="true" />
            </div>
          </div>

          <dl className={styles.signalStrip}>
            <div>
              <dt>Truth health</dt>
              <dd><strong>98.4%</strong><span>+2.1 this week</span></dd>
            </div>
            <div>
              <dt>Versioned claims</dt>
              <dd><strong>247</strong><span>14 changed today</span></dd>
            </div>
            <div>
              <dt>Open conflicts</dt>
              <dd><strong>02</strong><span>fail-closed</span></dd>
            </div>
            <div>
              <dt>Active agents</dt>
              <dd><strong>03</strong><span>least privilege</span></dd>
            </div>
          </dl>
        </section>

        <section className={styles.thesis} aria-labelledby="thesis-title">
          <div className={styles.sectionIndex}>01 — The thesis</div>
          <div className={styles.thesisGrid}>
            <h2 id="thesis-title">
              Your company does not have a knowledge problem.
              <span> It has a state problem.</span>
            </h2>
            <div className={styles.thesisBody}>
              <p>
                Search can find the old campaign brief. It cannot tell an agent that a
                rights window changed in Slack six minutes ago—and that a scheduled
                action is no longer safe.
              </p>
              <p>
                Commonstate turns noisy company activity into governed, temporal facts
                that humans and agents can act on together.
              </p>
            </div>
          </div>

          <div className={styles.stateContrast}>
            <article className={styles.beforeCard}>
              <div className={styles.cardKicker}>
                <span className={styles.badStatus} aria-hidden="true">×</span>
                Without shared state
              </div>
              <ol>
                <li><span>01</span>A brief changes in one channel</li>
                <li><span>02</span>The agent retrieves the previous version</li>
                <li><span>03</span>A plausible answer becomes a wrong action</li>
              </ol>
            </article>

            <div className={styles.contrastArrow} aria-hidden="true">→</div>

            <article className={styles.afterCard}>
              <div className={styles.cardKicker}>
                <span className={styles.goodStatus} aria-hidden="true">✓</span>
                With Commonstate
              </div>
              <ol>
                <li><span>01</span>The change becomes a cited claim</li>
                <li><span>02</span>Its blast radius is calculated instantly</li>
                <li><span>03</span>Unsafe actions pause until truth is resolved</li>
              </ol>
            </article>
          </div>
        </section>

        <section id="system" className={styles.systemSection} aria-labelledby="system-title">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIndex}>02 — The system</div>
            <div className={styles.sectionHeadingRow}>
              <h2 id="system-title">From source noise to safe action.</h2>
              <p>
                Commonstate sits between company activity and the humans and agents
                that need to act on it.
              </p>
            </div>
          </div>

          <div className={styles.architecture} aria-label="Commonstate system flow">
            <div className={`${styles.architectureNode} ${styles.sourceNode}`}>
              <span className={styles.architectureNumber}>01 / Sources</span>
              <strong>Company activity</strong>
              <div className={styles.sourceChips} aria-label="Example sources">
                <span>Slack</span><span>Docs</span><span>Tano</span><span>CRM</span>
              </div>
            </div>
            <div className={styles.flowConnector} aria-hidden="true"><span>events</span>→</div>
            <div className={`${styles.architectureNode} ${styles.ledgerNode}`}>
              <span className={styles.architectureNumber}>02 / Govern</span>
              <strong>Evidence ledger</strong>
              <p>Typed claims · valid time · provenance · conflicts</p>
            </div>
            <div className={styles.flowConnector} aria-hidden="true"><span>compile</span>→</div>
            <div className={`${styles.architectureNode} ${styles.contextNode}`}>
              <span className={styles.architectureNumber}>03 / Context</span>
              <strong>Task-sized truth</strong>
              <p>Scope · permissions · freshness · constraints</p>
            </div>
            <div className={styles.flowConnector} aria-hidden="true"><span>act</span>→</div>
            <div className={`${styles.architectureNode} ${styles.actionNode}`}>
              <span className={styles.architectureNumber}>04 / Outcome</span>
              <strong>Humans + agents</strong>
              <p>Receipts · replay · feedback · learned outcomes</p>
            </div>
          </div>

          <div className={styles.layersGrid}>
            {systemLayers.map((layer) => (
              <article
                className={`${styles.layerCard} ${styles[`tone_${layer.tone}`]}`}
                key={layer.number}
              >
                <div className={styles.layerTopline}>
                  <span>{layer.number}</span>
                  <span className={styles.layerGlyph} aria-hidden="true" />
                </div>
                <h3>{layer.title}</h3>
                <p>{layer.copy}</p>
                <div className={styles.layerMeta}>{layer.meta}</div>
              </article>
            ))}
          </div>
        </section>

        <section id="tano-edition" className={styles.tanoSection} aria-labelledby="tano-title">
          <div className={styles.tanoBackdrop} aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <div className={styles.tanoIntro}>
            <span className={styles.darkEyebrow}>Commonstate / Tano edition</span>
            <h2 id="tano-title">The context layer behind the autonomous CMO.</h2>
            <p>
              Tano’s Relationship Agent can keep working for months. Commonstate makes
              sure the company around it never drifts out of sync.
            </p>
            <Link className={styles.lightButton} href="/tano">
              Open the operating console <Arrow />
            </Link>
          </div>

          <div className={styles.propagationPanel}>
            <div className={styles.propagationHeader}>
              <div>
                <span>Change propagation</span>
                <strong>One update. Every dependency.</strong>
              </div>
              <span className={styles.propagatingBadge}>
                <span aria-hidden="true" /> propagated
              </span>
            </div>

            <div className={styles.propagationBody}>
              <div className={styles.eventCard}>
                <div className={styles.eventSource}>S</div>
                <div>
                  <span>Slack · #bloom-campaign</span>
                  <strong>Creator usage rights now end Friday at 18:00.</strong>
                </div>
                <time>14:32</time>
              </div>

              <div className={styles.pulseRail} aria-hidden="true">
                <span /><span /><span />
              </div>

              <div className={styles.impactGrid}>
                <article>
                  <span className={styles.impactIcon}>!</span>
                  <div><strong>Context pack</strong><span>Marked stale</span></div>
                </article>
                <article>
                  <span className={styles.impactIcon}>Ⅱ</span>
                  <div><strong>Scheduled action</strong><span>Held safely</span></div>
                </article>
                <article>
                  <span className={styles.impactIcon}>↻</span>
                  <div><strong>Relationship Agent</strong><span>Recompiled</span></div>
                </article>
              </div>

              <div className={styles.receiptRow}>
                <span>RECEIPT · RUN_8F2A</span>
                <span>3 claims cited</span>
                <span>1 approval required</span>
                <span>£0.014 estimated</span>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.comparisonSection} aria-labelledby="comparison-title">
          <div className={styles.sectionHeader}>
            <div className={styles.sectionIndex}>03 — The boundary</div>
            <div className={styles.sectionHeadingRow}>
              <h2 id="comparison-title">Beyond connected search.</h2>
              <p>
                Retrieval answers questions. Governed state lets a company safely
                delegate work.
              </p>
            </div>
          </div>

          <div className={styles.comparisonTableWrap}>
            <table className={styles.comparisonTable}>
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col">Enterprise search</th>
                  <th scope="col"><span>Commonstate</span></th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map(([label, search, commonstate]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{search}</td>
                    <td><span className={styles.checkmark} aria-hidden="true">✓</span>{commonstate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="proof" className={styles.proofSection} aria-labelledby="proof-title">
          <div className={styles.proofHeading}>
            <span className={styles.sectionIndex}>04 — The proof contract</span>
            <h2 id="proof-title">Trust is an eval result, not a brand claim.</h2>
            <p>
              Security, retrieval, provenance, and replay are tested as product
              behavior—not left as architecture-slide promises.
            </p>
          </div>

          <div className={styles.evalGrid}>
            {evals.map((item, index) => (
              <article key={item.label} className={styles.evalCard}>
                <span className={styles.evalIndex}>0{index + 1}</span>
                <strong>{item.value}</strong>
                <h3>{item.label}</h3>
                <p>{item.detail}</p>
              </article>
            ))}
          </div>

          <div className={styles.testMarquee} aria-label="Evaluation categories">
            <span>Freshness</span><i />
            <span>Precedence</span><i />
            <span>Permissions</span><i />
            <span>Prompt injection</span><i />
            <span>Replay</span><i />
            <span>Cross-workspace isolation</span>
          </div>
        </section>

        <section className={styles.finalCta} aria-labelledby="final-cta-title">
          <div className={styles.finalCtaPattern} aria-hidden="true" />
          <div className={styles.finalCtaCopy}>
            <span className={styles.darkEyebrow}>The company brain, operationalized</span>
            <h2 id="final-cta-title">Your agents deserve more than retrieval.</h2>
            <p>Give every person and every agent the same permissioned, living truth.</p>
          </div>
          <div className={styles.finalCtaActions}>
            <Link className={styles.inverseButton} href="/tano">
              Enter Tano edition <Arrow />
            </Link>
            <a className={styles.textLink} href="#system">
              Inspect the system <span aria-hidden="true">↑</span>
            </a>
          </div>
        </section>
      </div>

      <footer className={styles.footer}>
        <Wordmark />
        <p>Every human. Every agent. Same state.</p>
        <div>
          <span>Independent, unofficial Tano concept</span>
          <span>© 2026 Commonstate</span>
        </div>
      </footer>
    </main>
  );
}
