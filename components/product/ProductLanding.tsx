"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ProductBrand } from "./ProductBrand";
import { templatePacks } from "@/lib/product/templates";
import styles from "./product.module.css";

const publicTemplateIds = ["ai-operations", "enterprise-governance", "agency-operations"] as const;

const primitives = [
  { number: "01", title: "Evidence ledger", copy: "Every operational claim stays bound to its source span, author, scope, authority, and valid time.", tone: "#7357ff" },
  { number: "02", title: "Truth workflow", copy: "Company activity becomes reviewable state before people or agents can act on it.", tone: "#ff7a66" },
  { number: "03", title: "Context compiler", copy: "Each task receives the smallest current, permissioned set of facts it needs.", tone: "#a7e3f1" },
  { number: "04", title: "Blast radius", copy: "Every approved change shows which agents, tasks, and prior context packs it invalidates.", tone: "#ffb8d1" },
  { number: "05", title: "Action policy", copy: "Deterministic risk tiers decide what executes, waits for approval, or remains blocked.", tone: "#ffd66b" },
  { number: "06", title: "Agent receipts", copy: "Inspect the context, tools, policy, approvals, cost, and outcome behind every action.", tone: "#9be7c4" },
  { number: "07", title: "Temporal replay", copy: "Reconstruct what an agent knew then and compare it with what the company knows now.", tone: "#ffb8d1" },
] as const;

export function ProductLanding() {
  const [templateId, setTemplateId] = useState<(typeof publicTemplateIds)[number]>("ai-operations");
  const pack = templatePacks[templateId];
  const style = {
    "--workspace-accent": pack.accent,
    "--workspace-accent-soft": pack.accentSoft,
    "--workspace-accent-foreground": pack.id === "agency-operations" ? "#0A0A0A" : "#FFFFFF",
  } as CSSProperties;

  return (
    <main className={styles.productLanding} style={style}>
      <a className={styles.skipLink} href="#landing-main">Skip to content</a>
      <header className={styles.productLandingHeader}>
        <ProductBrand />
        <nav aria-label="Primary navigation"><a href="#solutions">Solutions</a><a href="#platform">Platform</a><a href="#trust">Trust</a></nav>
        <div><Link href="/login">Sign in</Link><Link className={styles.primaryAction} href="/setup">Tailor Commonstate →</Link></div>
      </header>

      <div id="landing-main">
        <section className={styles.productHero}>
          <div className={styles.productHeroCopy}>
            <div><span className={styles.heroStatus}><i />Production private beta</span><span>Hosted SaaS · dedicated deployments</span></div>
            <h1>One operational state.<br /><em>Shaped around your company.</em></h1>
            <p><strong>One living, permissioned operational truth.</strong> Commonstate turns changing company activity into governed state—so every person and every agent acts from the same current context.</p>
            <p className={styles.heroThesis}>Your company does not have a knowledge problem. It has a state problem.</p>
            <div className={styles.productHeroActions}><Link className={styles.landingPrimary} href="/setup">Build your workspace <span>→</span></Link><a className={styles.landingSecondary} href="#solutions">Explore solution packs <span>↓</span></a></div>
            <dl><div><dt>Evidence coverage</dt><dd>100%</dd></div><div><dt>Uncited actions</dt><dd>0</dd></div><div><dt>Release evals</dt><dd>24 / 24</dd></div></dl>
          </div>
          <div className={styles.productHeroVisual}>
            <div className={styles.heroVisualTop}><span>Commonstate control plane</span><span>Current · permissioned</span></div>
            <div className={styles.heroVisualBody}>
              <div className={styles.heroSignal}><span>01</span><p><small>Source event</small><strong>Operational truth changed</strong></p><i style={{ background: pack.accent }} /></div>
              <div className={styles.heroFlow}><i /><i /><i /><i /><i /></div>
              <div className={styles.heroContextCard}><header><span style={{ background: pack.accent }}>{pack.shortName.slice(0, 2).toUpperCase()}</span><p><small>Context pack · {pack.shortName}</small><strong>Only valid facts enter</strong></p><em>✓ scoped</em></header><div>{["Identity", "Scope", "Validity", "Conflict", "Evidence"].map((item) => <span key={item}>✓ {item}</span>)}</div><footer><code>ctx_{pack.id.slice(0, 8)}_v1</code><strong>Ready for agent</strong></footer></div>
              <div className={styles.heroReceipt}><span>Immutable receipt</span><strong>Every action explained.</strong><div><i /><i /><i /></div></div>
            </div>
            <div className={styles.heroVisualShadow} />
          </div>
        </section>

        <section id="solutions" className={styles.solutionsSection}>
          <header><p className={styles.monoEyebrow}>01 · Start from your operating model</p><div><h2>Three complete products.<br />One governed core.</h2><p>Choose a solution pack, then tailor its vocabulary, policies, agents, sources, and outcomes without forking the product.</p></div></header>
          <div className={styles.solutionTabs} role="tablist" aria-label="Solution packs">{publicTemplateIds.map((id, index) => { const template = templatePacks[id]; return <button key={id} role="tab" aria-selected={templateId === id} className={templateId === id ? styles.solutionTabActive : styles.solutionTab} onClick={() => setTemplateId(id)}><span>0{index + 1}</span><i style={{ background: template.accent }} /><div><strong>{template.name}</strong><small>{template.audience}</small></div><em>{templateId === id ? "Selected" : "Explore"} →</em></button>; })}</div>
          <div className={styles.solutionStage} role="tabpanel">
            <div className={styles.solutionStory}>
              <p className={styles.monoEyebrow}>{pack.eyebrow}</p><h3>{pack.description}</h3>
              <dl><div><dt>Scope model</dt><dd>{pack.scopeKinds.join(" → ")}</dd></div><div><dt>Core entities</dt><dd>{pack.entityTypes.slice(0,5).join(" · ")}</dd></div><div><dt>Configured agents</dt><dd>{pack.agents.length} production identities</dd></div></dl>
              <blockquote>“{pack.guidedQuestion}”</blockquote>
              <div><Link className={styles.landingPrimary} href={`/demo/${pack.id}`}>Open recorded demo <span>↗</span></Link><Link className={styles.landingTextLink} href={`/setup?template=${pack.id}`}>Tailor this pack →</Link></div>
            </div>
            <div className={styles.solutionPreview}>
              <div className={styles.previewRail}><span style={{ background: pack.accent }}>{pack.shortName.slice(0,2).toUpperCase()}</span>{["⌁","⇄","?","◇","↺"].map((icon,index) => <i key={icon} className={index === 0 ? styles.previewRailActive : ""}>{icon}</i>)}</div>
              <div className={styles.previewWorkspace}><header><span>{pack.shortName} · all permitted scopes</span><i>Recorded deterministic</i></header><main><p>Operational overview</p><div className={styles.previewMetrics}>{pack.metrics.map((metric) => <article key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.delta}</span></article>)}</div><div className={styles.previewLower}><article><header>Decision candidates <span>Current</span></header>{pack.candidates.map((candidate) => <div key={candidate.entityId}><i className={candidate.status === "eligible" ? styles.candidateGood : candidate.status === "blocked" ? styles.candidateBad : styles.candidateReview} /><p><strong>{candidate.name}</strong><small>{candidate.subtitle}</small></p><span>{candidate.score}%</span></div>)}</article><article style={{ background: pack.accentSoft }}><small>ACTIVE PACK</small><strong>{pack.name}</strong><p>{pack.scopeKinds.join(" → ")}</p><span style={{ background: pack.accent }}>Configuration v1</span></article></div></main></div>
            </div>
          </div>
        </section>

        <section id="platform" className={styles.platformSection}>
          <header><p className={styles.monoEyebrow}>02 · Operational context control plane</p><h2>Search finds information.<br /><span>Commonstate governs what is true now.</span></h2></header>
          <div className={styles.primitiveGrid}>{primitives.map((primitive) => <article key={primitive.number}><span>{primitive.number}</span><i style={{ background: primitive.tone }} /><h3>{primitive.title}</h3><p>{primitive.copy}</p><strong>Inspect primitive →</strong></article>)}</div>
        </section>

        <section id="trust" className={styles.trustSection}>
          <div className={styles.trustCopy}><p className={styles.monoEyebrow}>03 · Built for consequential work</p><h2>Trust is an eval result, not a brand claim.</h2><p>Identity, permissions, source provenance, and policy decisions are enforced outside the model. When truth is unresolved, high-risk work stops visibly.</p><div><span>24 deterministic scenarios</span><span>0 uncited actions allowed</span><span>Supabase Auth + RLS</span><span>Immutable audit ledger</span></div></div>
          <div className={styles.trustMatrix}><header><span>Action risk</span><span>Required control</span><span>Result</span></header>{[["Low","Reversible + compensation","May execute"],["Medium","1 authorized approval","Waits"],["High","2 approvals + re-auth","Waits"],["Critical","Private-beta boundary","Blocked"]].map((row,index) => <div key={row[0]}><span><i className={styles[`trustTone${index}`]} />{row[0]}</span><span>{row[1]}</span><strong>{row[2]}</strong></div>)}<footer><span>◈</span><p><strong>Every path ends in a receipt.</strong><small>Context · policy · approvals · action · outcome</small></p></footer></div>
        </section>

        <section className={styles.deploymentSection}><div><p className={styles.monoEyebrow}>04 · Deploy your way</p><h2>Shared product.<br />Isolated when it matters.</h2></div><article><span>01</span><h3>Hosted SaaS</h3><p>Fastest path to a governed multi-company workspace on Commonstate-managed infrastructure.</p><strong>Vercel · Supabase · Fly.io</strong></article><article><span>02</span><h3>Dedicated deployment</h3><p>A vendor-managed, isolated stack with separate projects, keys, monitoring, and custom domain.</p><strong>No customer-specific forks</strong></article></section>

        <section className={styles.landingCta}><p className={styles.monoEyebrow}>Every human. Every agent. Same state.</p><h2>Shape Commonstate around<br />how your company works.</h2><div><Link className={styles.landingPrimary} href="/setup">Tailor your workspace <span>→</span></Link><Link className={styles.landingSecondary} href="/demo/ai-operations">Try a recorded demo <span>↗</span></Link></div></section>
      </div>

      <footer className={styles.productLandingFooter}><ProductBrand inverse /><p>Independent operational context infrastructure.<br />Built for people and agents acting together.</p><nav><Link href="/demo/ai-operations">AI Operations</Link><Link href="/demo/enterprise-governance">Governance</Link><Link href="/demo/agency-operations">Agency Operations</Link></nav><span>© 2026 Commonstate</span></footer>
    </main>
  );
}
