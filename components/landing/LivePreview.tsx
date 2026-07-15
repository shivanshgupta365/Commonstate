"use client";

import { useState } from "react";
import styles from "./landing.module.css";

type PreviewTab = "ask" | "change" | "replay";

const tabs: Array<{ id: PreviewTab; label: string }> = [
  { id: "ask", label: "Ask" },
  { id: "change", label: "Change" },
  { id: "replay", label: "Replay" },
];

function AskPanel() {
  return (
    <div className={styles.askPanel} role="tabpanel" id="panel-ask" aria-labelledby="tab-ask">
      <div className={styles.queryBubble}>
        <span className={styles.queryAvatar} aria-hidden="true">LP</span>
        <p>Who can launch whitelisted TikTok ads this week under £15k?</p>
      </div>
      <div className={styles.answerBlock}>
        <div className={styles.answerHeading}>
          <div>
            <span className={styles.answerSpark} aria-hidden="true">✦</span>
            <strong>2 creators are action-ready</strong>
          </div>
          <span className={styles.citedBadge}>5 claims cited</span>
        </div>
        <p className={styles.answerSummary}>
          Rights, budget, deliverables, and unresolved conflicts checked as of
          <strong> 14:32 BST.</strong>
        </p>
        <div className={styles.creatorList}>
          <article>
            <div className={`${styles.creatorAvatar} ${styles.avatarCoral}`}>MA</div>
            <div><strong>Maya A.</strong><span>£12.4k · rights to 19 Jul</span></div>
            <span className={styles.eligibleBadge}>Eligible</span>
          </article>
          <article>
            <div className={`${styles.creatorAvatar} ${styles.avatarBlue}`}>NS</div>
            <div><strong>Noor S.</strong><span>£9.8k · rights to 22 Jul</span></div>
            <span className={styles.eligibleBadge}>Eligible</span>
          </article>
        </div>
        <button className={styles.evidenceButton} type="button">
          View exact evidence <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}

function ChangePanel() {
  const [approved, setApproved] = useState(false);

  return (
    <div className={styles.changePanel} role="tabpanel" id="panel-change" aria-labelledby="tab-change">
      <div className={styles.changeSource}>
        <div className={styles.sourceHeader}>
          <span className={styles.slackMark} aria-hidden="true">S</span>
          <div><strong>#bloom-campaign</strong><span>Leah · 14:32</span></div>
          <span className={styles.syntheticBadge}>synthetic</span>
        </div>
        <blockquote>
          Heads up: paid usage for Maya now ends Friday at 18:00. Please hold
          anything after that until legal confirms the extension.
        </blockquote>
      </div>
      <div className={styles.extractionLine}>
        <span aria-hidden="true">↓</span>
        Truth engine extracted 2 claims
      </div>
      <div className={styles.claimDiff}>
        <div className={styles.claimTopline}>
          <span className={styles.conflictBadge}>Conflict · high risk</span>
          <span>claim_9C1</span>
        </div>
        <span className={styles.claimLabel}>CREATOR.USAGE_RIGHTS.ENDS_AT</span>
        <div className={styles.diffValues}>
          <del>19 Jul · 23:59</del><span aria-hidden="true">→</span><ins>18 Jul · 18:00</ins>
        </div>
        <div className={styles.blastRadiusMini}>
          <span>Blast radius</span>
          <strong>1 context pack + 1 action</strong>
        </div>
      </div>
      <button
        className={approved ? styles.approvedButton : styles.approveButton}
        type="button"
        onClick={() => setApproved(true)}
      >
        {approved ? "Approved · dependencies updated" : "Approve and propagate"}
        <span aria-hidden="true">{approved ? "✓" : "→"}</span>
      </button>
    </div>
  );
}

function ReplayPanel() {
  return (
    <div className={styles.replayPanel} role="tabpanel" id="panel-replay" aria-labelledby="tab-replay">
      <div className={styles.replayHeader}>
        <div><span>RUN_8F2A</span><strong>Re-evaluate creator activation</strong></div>
        <span className={styles.replayBadge}>Replay complete</span>
      </div>
      <div className={styles.replayCompare}>
        <article>
          <div className={styles.replayColumnHeader}><span>Then</span><time>14:24</time></div>
          <div className={styles.stateIconGood} aria-hidden="true">✓</div>
          <strong>Action allowed</strong>
          <p>Usage rights valid through the scheduled flight.</p>
          <span className={styles.hash}>ctx_b27f…9c0a</span>
        </article>
        <div className={styles.replayArrow} aria-hidden="true">→</div>
        <article>
          <div className={styles.replayColumnHeader}><span>Now</span><time>14:33</time></div>
          <div className={styles.stateIconHold} aria-hidden="true">Ⅱ</div>
          <strong>Action held</strong>
          <p>Rights expire before completion. Human approval required.</p>
          <span className={styles.hash}>ctx_d901…2bb4</span>
        </article>
      </div>
      <div className={styles.replayFooter}>
        <span><i className={styles.diffDot} />1 material claim changed</span>
        <button type="button">Open full receipt <span aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}

export function LivePreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>("ask");

  return (
    <div className={styles.previewWindow}>
      <div className={styles.previewTopbar}>
        <div className={styles.windowDots} aria-hidden="true"><span /><span /><span /></div>
        <button type="button" className={styles.scopeButton}>
          <span className={styles.scopeMark} aria-hidden="true">B</span>
          Bloom &amp; Wild · UK <span aria-hidden="true">⌄</span>
        </button>
        <div className={styles.topbarStatus}><span aria-hidden="true" />State current</div>
      </div>

      <div className={styles.previewTabs} role="tablist" aria-label="System preview modes">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-controls={`panel-${tab.id}`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? styles.activePreviewTab : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            {tab.id === "change" && <span className={styles.tabAlert}>1</span>}
          </button>
        ))}
        <div className={styles.contextVersion}>CTX · v2.18</div>
      </div>

      <div className={styles.previewContent}>
        {activeTab === "ask" && <AskPanel />}
        {activeTab === "change" && <ChangePanel />}
        {activeTab === "replay" && <ReplayPanel />}
      </div>

      <div className={styles.previewStatusbar}>
        <span><i />5 sources synced</span>
        <span>247 claims</span>
        <span>2 conflicts</span>
        <span className={styles.previewLatency}>compiled in 312ms</span>
      </div>
    </div>
  );
}
