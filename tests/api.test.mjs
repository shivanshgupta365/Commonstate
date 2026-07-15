import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSeedState,
  runAcceptanceEvals,
  sha256,
} from "../lib/commonstate/domain.ts";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
let workerPromise;

async function getWorker() {
  workerPromise ??= import(`${workerUrl.href}?api-validation=${process.pid}-${Date.now()}`).then(
    ({ default: worker }) => worker,
  );
  return workerPromise;
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

const workerEnv = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

async function apiFetch(
  path,
  {
    origin = "https://commonstate.example",
    cookie,
    headers = {},
    json,
    method = json === undefined ? "GET" : "POST",
  } = {},
) {
  const worker = await getWorker();
  const requestHeaders = {
    accept: "application/json",
    ...(json === undefined ? {} : { "content-type": "application/json" }),
    ...(cookie ? { cookie } : {}),
    ...headers,
  };
  return worker.fetch(
    new Request(new URL(path, origin), {
      method,
      headers: requestHeaders,
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    }),
    workerEnv,
    executionContext,
  );
}

async function jsonResponse(response, expectedStatus = 200) {
  assert.equal(response.status, expectedStatus);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  return response.json();
}

function cookiePair(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /commonstate_demo_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Secure/i);
  return setCookie.split(";", 1)[0];
}

test("production API sessions ignore caller workspace selectors and isolate mutations", async () => {
  const selectorHeaders = { "x-commonstate-workspace": "header-attacker" };
  const firstResponse = await apiFetch("/api/demo/state?workspace=query-attacker", {
    headers: selectorHeaders,
  });
  const firstCookie = cookiePair(firstResponse);
  const first = await jsonResponse(firstResponse);

  const secondResponse = await apiFetch("/api/demo/state?workspace=query-attacker", {
    headers: selectorHeaders,
  });
  const secondCookie = cookiePair(secondResponse);
  const second = await jsonResponse(secondResponse);

  assert.match(first.state.meta.workspaceId, /^anon-[a-f0-9]{24}$/);
  assert.match(second.state.meta.workspaceId, /^anon-[a-f0-9]{24}$/);
  assert.notEqual(first.state.meta.workspaceId, second.state.meta.workspaceId);
  assert.notEqual(first.state.meta.workspaceId, "header-attacker");
  assert.equal(first.state.sources.length, 5);
  assert.equal(second.state.sources.length, 5);

  const ingestResponse = await apiFetch("/api/demo/ingest?workspace=query-attacker", {
    cookie: firstCookie,
    headers: selectorHeaders,
    json: {
      workspace: "body-attacker",
      idempotencyKey: "production-isolation-ingest",
    },
  });
  const ingested = await jsonResponse(ingestResponse);
  assert.equal(ingested.ok, true);
  assert.equal(ingested.state.meta.workspaceId, first.state.meta.workspaceId);
  assert.equal(ingested.state.sources.length, first.state.sources.length + 1);
  assert.equal(ingested.state.proposals.length, first.state.proposals.length + 3);

  const untouchedResponse = await apiFetch("/api/demo/state?workspace=first-client", {
    cookie: secondCookie,
    headers: { "x-commonstate-workspace": first.state.meta.workspaceId },
  });
  const untouched = await jsonResponse(untouchedResponse);
  assert.equal(untouched.state.meta.workspaceId, second.state.meta.workspaceId);
  assert.equal(untouched.state.sources.length, second.state.sources.length);
  assert.equal(untouched.state.proposals.length, second.state.proposals.length);

  const foreignClaimId = first.state.claims[0].id;
  const evidenceResponse = await apiFetch("/api/demo/mcp", {
    cookie: secondCookie,
    json: {
      jsonrpc: "2.0",
      id: "isolation-check",
      method: "tools/call",
      params: { name: "get_evidence", arguments: { claim_ids: [foreignClaimId] } },
    },
  });
  const evidenceRpc = await jsonResponse(evidenceResponse);
  const evidencePayload = JSON.parse(evidenceRpc.result.content[0].text);
  assert.deepEqual(evidencePayload.result, []);
  assert.equal(evidencePayload.meta.workspaceId, second.state.meta.workspaceId);
  assert.equal(
    evidencePayload.meta.authenticatedIdentitySource,
    "secure HttpOnly browser session",
  );
});

test("API snapshots expose exact provenance and executed acceptance evidence", async () => {
  const response = await apiFetch("/api/demo/state");
  const body = await jsonResponse(response);
  const state = body.state;
  const sourceById = new Map(state.sources.map((source) => [source.id, source]));

  assert.equal(state.sources.filter((source) => source.classification === "public").length, 1);
  assert.equal(state.sources.filter((source) => source.classification === "synthetic").length, 4);
  for (const source of state.sources) {
    assert.equal(source.immutable, true);
    assert.equal(source.sha256, await sha256(source.contentText));
  }

  for (const claim of state.claims) {
    const source = sourceById.get(claim.sourceId);
    assert.ok(source, `${claim.id} references a missing source`);
    assert.equal(claim.classification, source.classification);
    assert.ok(
      source.contentText.includes(claim.sourceSpan),
      `${claim.id} source span is not literal provenance`,
    );
  }

  const publicClaim = state.claims.find((claim) => claim.classification === "public");
  assert.ok(publicClaim);
  assert.equal(sourceById.get(publicClaim.sourceId).uri, "https://www.tano.ai/llms-full.txt");

  for (const pack of state.contextPacks) {
    assert.deepEqual(
      pack.facts.map((fact) => fact.claimId),
      pack.citations.map((citation) => citation.claimId),
    );
    assert.ok(pack.citations.every((citation) => citation.sourceSpan.length > 0));
  }

  assert.equal(state.evals.suite, "commonstate-domain-v2");
  assert.equal(state.evals.passed, 24);
  assert.equal(state.evals.total, 24);
  assert.ok(state.evals.results.every((result) => result.details.executed === true));
  assert.ok(state.evals.results.every((result) => result.details.invariant.length > 10));
  assert.ok(state.evals.results.every((result) => result.details.observed.length > 0));
});

test("acceptance results are recomputed and fail under provenance tampering", async () => {
  const state = await createSeedState("api-eval-tamper");
  const tampered = structuredClone(state);
  tampered.sources[0].sha256 = "0".repeat(64);
  const rerun = await runAcceptanceEvals(tampered);
  const failed = rerun.filter((result) => !result.passed);

  assert.equal(rerun.length, 24);
  assert.ok(rerun.every((result) => result.details.executed === true));
  assert.ok(failed.some((result) => result.caseName === "source hashes match exact content"));

  const domainSource = await readFile(
    new URL("../lib/commonstate/domain.ts", import.meta.url),
    "utf8",
  );
  assert.match(domainSource, /evaluationResults\s*=\s*await runAcceptanceEvals\(state\)/);
  assert.doesNotMatch(domainSource, /passed:\s*true/);
});
