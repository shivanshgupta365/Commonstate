import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";

import {
  baselineChanges,
  creators,
  evalCases,
  evidence,
  slackProposal,
} from "../components/console/demoData.ts";
import { createSeedState } from "../lib/commonstate/domain.ts";

const projectRoot = new URL("../", import.meta.url);
const workerUrl = new URL("../dist/server/index.js", import.meta.url);
const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;
const starterCopy =
  /Codex is working|Your site is taking shape|Codex is building the first version|react-loading-skeleton/i;

const acceptanceGroups = [
  {
    label: "Freshness",
    scenarios: [
      ["freshness", "expired claims excluded"],
      ["freshness", "stale claims flagged"],
      ["freshness", "stale high-risk claims fail closed"],
    ],
  },
  {
    label: "Precedence / conflicts",
    scenarios: [
      ["precedence", "campaign beats client"],
      ["precedence", "approved beats operator note"],
      ["precedence", "supersession is deterministic"],
      ["conflicts", "rights conflict fails closed"],
      ["conflicts", "payment conflict fails closed"],
      ["conflicts", "dismissed conflict unblocks"],
    ],
  },
  {
    label: "Permissions",
    scenarios: [
      ["permissions", "workspace rows isolated"],
      ["permissions", "agent write budget enforced"],
      ["permissions", "revoked actor denied"],
    ],
  },
  {
    label: "Provenance",
    scenarios: [
      ["provenance", "answers cite every fact"],
      ["provenance", "source spans are contained"],
      ["provenance", "source hashes match exact content"],
    ],
  },
  {
    label: "Prompt injection",
    scenarios: [
      ["injection", "retrieved instructions ignored"],
      ["injection", "malicious URL rejected"],
      ["injection", "agent summary cannot self-attest"],
    ],
  },
  {
    label: "Agent writes / replay",
    scenarios: [
      ["writes", "ingest idempotent"],
      ["writes", "approval append-only"],
      ["writes", "outcome receipt immutable"],
      ["replay", "same context hash reproduces receipt"],
      ["replay", "changed fact creates new context hash"],
      ["replay", "blocked action surfaced"],
    ],
  },
];

let workerPromise;
let primaryRoutesPromise;
const seededStatePromise = createSeedState("rendered-validation");

function createD1Stub() {
  const statement = {
    bind() {
      return this;
    },
    async first() {
      return null;
    },
    async all() {
      return { success: true, results: [], meta: {} };
    },
    async raw() {
      return [];
    },
    async run() {
      return { success: true, results: [], meta: { changes: 1 } };
    },
  };

  return {
    prepare() {
      return statement;
    },
    async batch(statements) {
      return statements.map(() => ({ success: true, results: [], meta: {} }));
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  };
}

async function getWorker() {
  workerPromise ??= import(`${workerUrl.href}?validation=${process.pid}-${Date.now()}`).then(
    ({ default: worker }) => worker,
  );
  return workerPromise;
}

function workerEnv({ d1 = false } = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
    ...(d1 ? { DB: createD1Stub() } : {}),
  };
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

async function workerFetch(path, { d1 = false, headers, ...requestInit } = {}) {
  const worker = await getWorker();
  const request = new Request(new URL(path, "http://commonstate.test"), {
    headers: { accept: "text/html", ...headers },
    ...requestInit,
  });
  return worker.fetch(request, workerEnv({ d1 }), executionContext);
}

function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, codePoint) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function visibleText(html) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

async function renderRoute(path, options) {
  const response = await workerFetch(path, options);
  const html = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    html,
    text: visibleText(html),
  };
}

function primaryRoutes() {
  primaryRoutesPromise ??= Promise.all([
    renderRoute("/"),
    renderRoute("/tano", { d1: true }),
  ]).then(([root, tano]) => ({ root, tano }));
  return primaryRoutesPromise;
}

function assertHtmlResponse(rendered) {
  assert.equal(rendered.status, 200);
  assert.match(rendered.contentType, /^text\/html\b/i);
  assert.match(rendered.html, /^<!DOCTYPE html>/i);
  assert.match(rendered.html, /<html[^>]*\blang="en"/i);
}

function assertVisibleCopy(text, expected) {
  for (const copy of expected) {
    assert.ok(text.includes(copy), `Expected server-rendered copy: ${copy}`);
  }
}

test("server-renders the Commonstate landing page and product thesis", async () => {
  const { root } = await primaryRoutes();
  assertHtmlResponse(root);
  assert.match(
    root.html,
    /<title>Commonstate — Every human\. Every agent\. Same state\. · Commonstate<\/title>/,
  );
  assert.match(root.html, /<main\b/i);
  assert.match(root.html, /href="\/tano"/);

  assertVisibleCopy(root.text, [
    "Operational context control plane",
    "Every human. Every agent. Same state.",
    "One living, permissioned operational truth",
    "Your company does not have a knowledge problem. It has a state problem.",
    "Evidence ledger",
    "Truth workflow",
    "Context compiler",
    "Blast radius",
    "Agent receipts",
    "Temporal replay",
    "The context layer behind the autonomous CMO.",
    "Trust is an eval result, not a brand claim.",
    "24 deterministic scenarios",
    "0 uncited actions allowed",
    "Independent, unofficial Tano concept",
  ]);
});

test("server-renders the Tano operating console with its proof workflow", async () => {
  const { tano } = await primaryRoutes();
  assertHtmlResponse(tano);
  assert.match(tano.html, /<title>Tano Edition · Commonstate<\/title>/);
  assert.match(tano.html, /id="workspace-main"/);
  assert.match(tano.html, /role="tablist"/);

  assertVisibleCopy(tano.text, [
    "Overview",
    "Change inbox",
    "Memory map",
    "Ask Commonstate",
    "Agent console",
    "Replay",
    "Evals",
    "90-second proof",
    "Every human. Every agent. Same state.",
    "The context layer behind the autonomous CMO.",
    "Version every decision, compile only what each agent needs, and explain every action.",
    "Truth propagation",
    "Context pack",
    "Truth health",
    "Open conflicts",
    "Relationship agent",
    "Public source",
    "Independent concept",
    "No private Tano data",
  ]);
});

test("built routes contain no active starter preview metadata or copy", async () => {
  const [{ root, tano }, page, layout, packageJson] = await Promise.all([
    primaryRoutes(),
    readFile(new URL("app/page.tsx", projectRoot), "utf8"),
    readFile(new URL("app/layout.tsx", projectRoot), "utf8"),
    readFile(new URL("package.json", projectRoot), "utf8"),
  ]);

  for (const rendered of [root, tano]) {
    assert.doesNotMatch(rendered.html, developmentPreviewMeta);
    assert.doesNotMatch(rendered.html, starterCopy);
  }
  assert.doesNotMatch(page, /codex-preview|SkeletonPreview|_sites-preview/i);
  assert.doesNotMatch(layout, /codex-preview|SkeletonPreview|_sites-preview|Starter Project/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});

test("demo state remains deterministic with a D1 stub or no DB binding", async () => {
  for (const d1 of [false, true]) {
    const workspace = `rendered-api-${d1 ? "stub" : "memory"}-${process.pid}`;
    const response = await workerFetch(
      `/api/demo/state?workspace=${workspace}`,
      { d1, headers: { accept: "application/json" } },
    );
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.state.meta.deterministic, true);
    assert.equal(body.state.meta.workspaceId, workspace);
    assert.ok(["d1", "memory-fallback"].includes(body.state.meta.mode));
    assert.equal(body.state.evals.passed, 24);
    assert.equal(body.state.evals.total, 24);
  }
});

test("visible evidence fixtures separate public material from synthetic operations", () => {
  assert.equal(evidence.length, 7);
  assert.deepEqual(
    Object.fromEntries(
      ["public", "synthetic"].map((classification) => [
        classification,
        evidence.filter((item) => item.sourceType === classification).length,
      ]),
    ),
    { public: 1, synthetic: 6 },
  );

  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  assert.equal(evidenceById.get("ev-case-study")?.sourceType, "public");
  assert.equal(evidenceById.get("ev-slack-update")?.sourceType, "synthetic");

  for (const item of evidence) {
    assert.ok(item.excerpt.trim().length > 20, `${item.id} needs an exact source excerpt`);
    assert.ok(item.author.trim().length > 0, `${item.id} needs an author`);
    assert.match(item.hash, /^sha256:/, `${item.id} needs a visible source hash`);
    assert.ok(item.confidence > 0 && item.confidence <= 1);
  }

  for (const creator of creators) {
    assert.ok(creator.evidenceIds.length > 0, `${creator.name} needs a citation`);
    for (const evidenceId of creator.evidenceIds) {
      assert.ok(evidenceById.has(evidenceId), `${creator.name} cites missing evidence ${evidenceId}`);
    }
  }

  for (const change of [...baselineChanges, slackProposal]) {
    assert.ok(evidenceById.has(change.evidenceId), `${change.id} cites missing evidence`);
    assert.ok(["public", "synthetic"].includes(change.sourceType));
  }
});

test("seeded facts retain claim-level source classifications and citations", async () => {
  const state = await seededStatePromise;
  const sourceById = new Map(state.sources.map((source) => [source.id, source]));
  const claimById = new Map(state.claims.map((claim) => [claim.id, claim]));

  assert.deepEqual(
    Object.fromEntries(
      ["public", "synthetic"].map((classification) => [
        classification,
        state.sources.filter((source) => source.classification === classification).length,
      ]),
    ),
    { public: 1, synthetic: 4 },
  );

  for (const source of state.sources) {
    assert.equal(source.immutable, true);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(["public", "synthetic"].includes(source.classification));
    if (source.classification === "public") {
      assert.match(source.uri ?? "", /^https:\/\/www\.tano\.ai\//);
    } else {
      assert.equal(source.uri, null);
    }
  }

  for (const claim of state.claims) {
    const source = sourceById.get(claim.sourceId);
    assert.ok(source, `${claim.id} references a missing source`);
    assert.equal(claim.classification, source.classification);
    assert.ok(claim.sourceSpan.trim().length > 0, `${claim.id} needs an exact source span`);
    assert.ok(claim.acl.length > 0, `${claim.id} needs scoped access rules`);
  }

  for (const pack of state.contextPacks) {
    assert.equal(pack.facts.length, pack.citations.length);
    const citedClaimIds = pack.citations.map((citation) => citation.claimId);
    assert.deepEqual(citedClaimIds, pack.facts.map((fact) => fact.claimId));
    for (const citation of pack.citations) {
      const claim = claimById.get(citation.claimId);
      const source = sourceById.get(citation.sourceId);
      assert.ok(claim, `${pack.id} cites a missing claim`);
      assert.ok(source, `${pack.id} cites a missing source`);
      assert.equal(citation.sourceId, claim.sourceId);
      assert.equal(citation.sourceSpan, claim.sourceSpan);
      assert.equal(citation.classification, source.classification);
    }
  }

  assert.equal(state.contextPackEvidence.length, state.contextPacks[0].citations.length);
  for (const link of state.contextPackEvidence) {
    assert.ok(claimById.has(link.claimId));
    assert.ok(sourceById.has(link.sourceId));
    assert.equal(link.sourceSpan, claimById.get(link.claimId).sourceSpan);
  }
});

test("the UI and domain expose an exact, deterministic 24-scenario contract", async () => {
  const [first, second] = await Promise.all([
    seededStatePromise,
    createSeedState("rendered-validation"),
  ]);
  const expectedDomainCases = acceptanceGroups.flatMap(({ scenarios }) => scenarios);
  const actualDomainCases = first.evaluationResults.map(({ category, caseName }) => [
    category,
    caseName,
  ]);

  assert.equal(expectedDomainCases.length, 24);
  assert.deepEqual(actualDomainCases, expectedDomainCases);
  assert.deepEqual(first.evaluationResults, second.evaluationResults);
  assert.equal(new Set(first.evaluationResults.map((result) => result.id)).size, 24);
  assert.ok(first.evaluationResults.every((result) => result.passed));

  assert.equal(evalCases.length, 24);
  assert.equal(new Set(evalCases.map((item) => item.id)).size, 24);
  assert.equal(new Set(evalCases.map((item) => item.category)).size, 8);
  assert.ok(evalCases.every((item) => item.title.trim().length > 5));
});

for (const group of acceptanceGroups) {
  describe(`Acceptance evals — ${group.label}`, () => {
    for (const [category, caseName] of group.scenarios) {
      test(caseName, async () => {
        const state = await seededStatePromise;
        const result = state.evaluationResults.find(
          (item) => item.category === category && item.caseName === caseName,
        );
        assert.ok(result, `Missing deterministic eval: ${category}/${caseName}`);
        assert.equal(result.passed, true);
        assert.equal(result.suite, "commonstate-domain-v2");
        assert.equal(result.details.executed, true);
        assert.equal(typeof result.details.invariant, "string");
        assert.ok(result.details.invariant.length > 10);
        assert.equal(typeof result.details.observed, "string");
        assert.match(result.id, /:eval:\d{2}$/);
        assert.ok(Number.isInteger(result.durationMs) && result.durationMs >= 0);
      });
    }
  });
}
