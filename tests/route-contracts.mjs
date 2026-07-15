const operations = [
  {
    name: "state",
    method: "GET",
    expectedAction: null,
  },
  {
    name: "reset",
    method: "POST",
    body: {},
    expectedAction: "reset",
  },
  {
    name: "ask",
    method: "POST",
    body: {
      question:
        "Which creators can launch whitelisted TikTok ads this week under GBP 15,000?",
    },
    expectedAction: "ask",
  },
  {
    name: "ingest",
    method: "POST",
    body: { idempotencyKey: "route-contract-ingest" },
    expectedAction: "ingest",
  },
  {
    name: "update",
    method: "POST",
    body: { idempotencyKey: "route-contract-update" },
    expectedAction: "ingest",
  },
  {
    name: "approve",
    method: "POST",
    body: {},
    expectedAction: "approve",
  },
  {
    name: "reject",
    method: "POST",
    body: {},
    expectedAction: "reject",
  },
  {
    name: "run-agent",
    method: "POST",
    body: { task: "Compile the safe creator launch queue.", mode: "recorded" },
    expectedAction: "run-agent",
  },
  {
    name: "replay",
    method: "POST",
    body: {},
    expectedAction: "replay",
  },
  {
    name: "outcome",
    method: "POST",
    body: { status: "measured", metrics: { ctrLiftPercent: 12.4 } },
    expectedAction: "outcome",
  },
  {
    name: "mcp",
    method: "POST",
    body: { jsonrpc: "2.0", id: "route-contract", method: "initialize" },
    expectedAction: null,
    protocol: "mcp",
  },
];

const prefixes = [
  { family: "canonical", prefix: "/api" },
  { family: "demo", prefix: "/api/demo" },
];

export const ROUTE_CONTRACTS = prefixes.flatMap(({ family, prefix }) =>
  operations.map((operation) => ({
    ...operation,
    family,
    path: `${prefix}/${operation.name}`,
    moduleUrl: new URL(
      `../app${prefix}/${operation.name}/route.ts`,
      import.meta.url,
    ),
  })),
);

export const ROUTE_PAIRS = operations.map((operation) => ({
  operation,
  canonical: ROUTE_CONTRACTS.find(
    (contract) => contract.family === "canonical" && contract.name === operation.name,
  ),
  demo: ROUTE_CONTRACTS.find(
    (contract) => contract.family === "demo" && contract.name === operation.name,
  ),
}));

export function contractForPath(pathname) {
  return ROUTE_CONTRACTS.find((contract) => contract.path === pathname) ?? null;
}

export async function requestRouteContract(
  serverOrigin,
  contract,
  {
    publicOrigin,
    workspace,
    cookie,
    headers = {},
    body = contract.body,
    method = contract.method,
    rawBody,
    requestPath = contract.path,
  } = {},
) {
  const requestHeaders = new Headers({ accept: "application/json", ...headers });
  if (cookie) requestHeaders.set("cookie", cookie);
  if (body !== undefined || rawBody !== undefined) {
    requestHeaders.set("content-type", "application/json");
  }
  if (workspace) requestHeaders.set("x-commonstate-workspace", workspace);
  if (publicOrigin) {
    const publicUrl = new URL(publicOrigin);
    requestHeaders.set("host", publicUrl.host);
    requestHeaders.set("x-forwarded-host", publicUrl.host);
    requestHeaders.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  }

  const requestBody = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
  const url = new URL(requestPath, serverOrigin);
  if (workspace) url.searchParams.set("workspace", workspace);
  return fetch(url, {
    method,
    headers: requestHeaders,
    ...(requestBody === undefined ? {} : { body: requestBody }),
  });
}

export function normalizeWorkspacePayload(payload, workspace) {
  return JSON.parse(
    JSON.stringify(payload)
      .replaceAll(workspace, "<workspace>")
      .replace(/anon-[a-f0-9]{24}/g, "<workspace>")
      // Context IDs, context-version hashes, run IDs, and receipt hashes bind
      // the workspace ID by design. Alias parity compares their shape rather
      // than expecting two isolated workspaces to share content addresses.
      .replace(/[a-f0-9]{8,64}/g, "<content-hash>"),
  );
}
