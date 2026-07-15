import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import {
  createSeedState,
  runAcceptanceEvals,
  sha256,
} from "../lib/commonstate/domain.ts";
import {
  ROUTE_CONTRACTS,
  ROUTE_PAIRS,
  contractForPath,
  requestRouteContract,
  normalizeWorkspacePayload,
} from "./route-contracts.mjs";
import { startNativeNextServer } from "./helpers/native-next-server.mjs";

let nativeServer;

before(async () => {
  // Binding Next to 0.0.0.0 gives route handlers a non-local request URL, so
  // this suite exercises the real Secure-cookie and selector-ignore policy.
  nativeServer = await startNativeNextServer({ hostname: "0.0.0.0" });
});

after(async () => {
  await nativeServer?.stop();
});

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
  const pathname = new URL(path, origin).pathname;
  const contract = contractForPath(pathname);
  assert.ok(contract, `No declarative route contract for ${pathname}`);
  return requestRouteContract(nativeServer.origin, contract, {
    publicOrigin: origin,
    cookie,
    headers,
    body: json,
    method,
    requestPath: path,
  });
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

test("the declarative matrix covers every canonical and demo API route", async () => {
  assert.equal(ROUTE_CONTRACTS.length, 22);
  assert.equal(new Set(ROUTE_CONTRACTS.map((contract) => contract.path)).size, 22);
  assert.deepEqual(
    Object.fromEntries(
      ["canonical", "demo"].map((family) => [
        family,
        ROUTE_CONTRACTS.filter((contract) => contract.family === family).length,
      ]),
    ),
    { canonical: 11, demo: 11 },
  );

  for (let index = 0; index < ROUTE_CONTRACTS.length; index += 1) {
    const contract = ROUTE_CONTRACTS[index];
    const routeSource = await readFile(contract.moduleUrl, "utf8");
    assert.match(
      routeSource,
      new RegExp(`\\bas ${contract.method}\\b`),
      `${contract.path} exports ${contract.method}`,
    );
    assert.doesNotMatch(
      routeSource,
      new RegExp(`\\bas ${contract.method === "GET" ? "POST" : "GET"}\\b`),
    );

    const workspace = `matrix-${index}-${process.pid}`;
    const response = await requestRouteContract(nativeServer.origin, contract, { workspace });
    assert.equal(response.status, 200, `${contract.method} ${contract.path}`);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("set-cookie") ?? "", /commonstate_demo_session=/);

    const body = await response.json();
    if (contract.protocol === "mcp") {
      assert.equal(body.jsonrpc, "2.0");
      assert.equal(body.result.protocolVersion, "2025-06-18");
    } else {
      assert.equal(body.ok, true, `${contract.path} returned ${JSON.stringify(body)}`);
      assert.ok(body.state);
      if (contract.expectedAction) assert.equal(body.action, contract.expectedAction);
    }
  }
});

test("canonical and /api/demo aliases return equivalent contracts", async () => {
  assert.equal(ROUTE_PAIRS.length, 11);
  for (let index = 0; index < ROUTE_PAIRS.length; index += 1) {
    const { operation, canonical, demo } = ROUTE_PAIRS[index];
    assert.ok(canonical && demo, `missing route pair for ${operation.name}`);
    const canonicalWorkspace = `canon-${index}-${process.pid}`;
    const demoWorkspace = `demo-${index}-${process.pid}`;
    const [canonicalResponse, demoResponse] = await Promise.all([
      requestRouteContract(nativeServer.origin, canonical, { workspace: canonicalWorkspace }),
      requestRouteContract(nativeServer.origin, demo, { workspace: demoWorkspace }),
    ]);
    assert.equal(canonicalResponse.status, demoResponse.status, operation.name);
    assert.equal(
      canonicalResponse.headers.get("content-type"),
      demoResponse.headers.get("content-type"),
      operation.name,
    );
    const [canonicalBody, demoBody] = await Promise.all([
      canonicalResponse.json(),
      demoResponse.json(),
    ]);
    assert.deepEqual(
      normalizeWorkspacePayload(canonicalBody, canonicalWorkspace),
      normalizeWorkspacePayload(demoBody, demoWorkspace),
      operation.name,
    );
  }
});

test("API body and MCP protocol edge contracts remain fail-safe", async () => {
  const askContract = contractForPath("/api/demo/ask");
  const mcpContract = contractForPath("/api/demo/mcp");
  assert.ok(askContract && mcpContract);

  const invalid = await requestRouteContract(nativeServer.origin, askContract, {
    workspace: `invalid-json-${process.pid}`,
    rawBody: "{",
  });
  const invalidBody = await jsonResponse(invalid, 400);
  assert.deepEqual(invalidBody, {
    ok: false,
    error: { code: "INVALID_JSON", message: "request body contains invalid JSON" },
  });

  const nonObject = await requestRouteContract(nativeServer.origin, askContract, {
    workspace: `array-json-${process.pid}`,
    rawBody: "[]",
  });
  const nonObjectBody = await jsonResponse(nonObject, 400);
  assert.equal(nonObjectBody.error.code, "INVALID_JSON");

  const oversized = await requestRouteContract(nativeServer.origin, askContract, {
    workspace: `oversized-${process.pid}`,
    rawBody: `{"payload":"${"x".repeat(64 * 1024)}"}`,
  });
  const oversizedBody = await jsonResponse(oversized, 413);
  assert.equal(oversizedBody.error.code, "PAYLOAD_TOO_LARGE");

  const listed = await requestRouteContract(nativeServer.origin, mcpContract, {
    workspace: `mcp-list-${process.pid}`,
    body: { jsonrpc: "2.0", id: "tools", method: "tools/list" },
  });
  const listedBody = await jsonResponse(listed);
  assert.deepEqual(
    listedBody.result.tools.map((tool) => tool.name),
    [
      "get_context_pack",
      "get_evidence",
      "propose_claim",
      "request_approval",
      "record_outcome",
    ],
  );

  const notification = await requestRouteContract(nativeServer.origin, mcpContract, {
    workspace: `mcp-notification-${process.pid}`,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), "");
  assert.match(notification.headers.get("set-cookie") ?? "", /HttpOnly/i);
});

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
