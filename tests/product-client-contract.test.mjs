import assert from "node:assert/strict";
import test from "node:test";

test("product client preserves the command envelope and singular claim contract", async () => {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  const originalFetch = globalThis.fetch;
  let request;

  globalThis.fetch = async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      ok: true,
      data: {
        command: "approve",
        result: { claimIds: ["claim-1"], decision: "approved" },
        state: { workspace: { id: "workspace-1", slug: "acme" }, claims: [] },
      },
      meta: { requestId: "request-1" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const { executeWorkspaceCommand } = await import("../components/product/productClient.ts");
    const response = await executeWorkspaceCommand("acme", "approve", {
      claimId: "claim-1",
      reason: "Reviewed by an authorized operator.",
    });

    assert.equal(response.ok, true);
    assert.deepEqual(response.data, { claimIds: ["claim-1"], decision: "approved" });
    assert.equal(response.state?.workspace.slug, "acme");
    assert.equal(request.input, "/api/v1/workspaces/acme/commands/approve");
    assert.equal(request.init.method, "POST");
    assert.equal(JSON.parse(request.init.body).claimId, "claim-1");
    assert.ok(request.init.headers["Idempotency-Key"]);
  } finally {
    globalThis.fetch = originalFetch;
    unregister();
  }
});

test("setup client reads the authenticated template registry items envelope", async () => {
  const { register } = await import("tsx/esm/api");
  const unregister = register();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input) => {
    assert.equal(String(input), "/api/v1/templates");
    return new Response(JSON.stringify({
      ok: true,
      data: {
        items: [{ id: "blank", name: "Blank workspace", configuration: { template: "blank" } }],
      },
      meta: { requestId: "request-templates" },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const { getProductTemplates } = await import("../components/product/productClient.ts");
    const response = await getProductTemplates();
    assert.equal(response.ok, true);
    assert.equal(response.data.items[0].id, "blank");
    assert.equal(response.data.items[0].configuration.template, "blank");
  } finally {
    globalThis.fetch = originalFetch;
    unregister();
  }
});
