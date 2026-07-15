import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { after, before, test } from "node:test";

import { startNativeNextServer } from "./helpers/native-next-server.mjs";
import { contractForPath, requestRouteContract } from "./route-contracts.mjs";

let nativeServer;

before(async () => {
  nativeServer = await startNativeNextServer();
});

after(async () => {
  await nativeServer?.stop();
});

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

test("context-pack API p95 remains below 750ms on the seeded dataset", async (context) => {
  const contract = contractForPath("/api/demo/mcp");
  assert.ok(contract);
  const workspace = `perf-${process.pid}`;
  const body = {
    jsonrpc: "2.0",
    id: "context-performance",
    method: "tools/call",
    params: {
      name: "get_context_pack",
      arguments: {
        task:
          "Which creators can launch whitelisted TikTok ads this week under GBP 15,000?",
        entity_refs: [],
      },
    },
  };

  async function sample() {
    const startedAt = performance.now();
    const response = await requestRouteContract(nativeServer.origin, contract, {
      workspace,
      body,
    });
    const durationMs = performance.now() - startedAt;
    assert.equal(response.status, 200);
    const rpc = await response.json();
    assert.equal(rpc.jsonrpc, "2.0");
    assert.ok(rpc.result?.content?.[0]?.text);
    const payload = JSON.parse(rpc.result.content[0].text);
    assert.equal(payload.ok, true);
    assert.equal(payload.tool, "get_context_pack");
    return durationMs;
  }

  for (let index = 0; index < 5; index += 1) await sample();
  const durations = [];
  for (let index = 0; index < 50; index += 1) durations.push(await sample());

  const p95 = percentile(durations, 95);
  const threshold = Number(process.env.COMMONSTATE_CONTEXT_P95_MS ?? "750");
  context.diagnostic(
    `context-pack samples=${durations.length} p95=${p95.toFixed(1)}ms threshold=${threshold}ms`,
  );
  assert.ok(
    p95 < threshold,
    `context-pack p95 ${p95.toFixed(1)}ms must remain below ${threshold}ms`,
  );
});
