# Commonstate architecture

Commonstate is an operational context control plane, not a document chatbot. It
keeps evidence-backed operational state shared by humans and agents and records
why each consequential decision was proposed.

## Runtime flow

1. Sources enter the Evidence Ledger with exact content hashes and a public,
   private, or synthetic classification.
2. The Truth Engine converts literal source spans into typed, temporal claims.
3. Conflicts remain visible until a human approves, rejects, or supersedes the
   proposed claim.
4. The Context Compiler applies browser workspace, scope, lifecycle, temporal
   validity, critical freshness, task predicates, and conflict filters.
5. Agents receive the smallest matching cited pack; stale critical evidence and
   unresolved high-risk conflicts hold the affected action.
6. A receipt binds context, evidence, provider, model, prompts, tools, approvals,
   cost, latency, proposed actions, holds, and timestamps into one hash.
7. Outcomes enter the ledger as proposed learning and cannot self-approve.

```text
Sources -> Evidence ledger -> Truth engine -> Context compiler
   -> Humans and agents -> Receipts and outcomes -> Evidence ledger
```

## Shipped vertical slice

- Native Next.js 16 App Router UI and route handlers, built with `next build`
  and served with `next start` on Node 22.
- Drizzle `pg-core` schema and generated migration for 17 normalized Supabase
  Postgres tables, using JSONB, native booleans, timezone-aware timestamps,
  foreign keys, uniqueness constraints, and workspace indexes.
- PostgreSQL persistence through Supabase's transaction pooler with prepared
  statements disabled. `DATABASE_URL` serves application traffic;
  `MIGRATION_DATABASE_URL` is reserved for schema changes.
- Isolated memory persistence only in local development and tests, reported as
  `state.meta.mode: "memory-local"`. Durable operation reports `"postgres"`.
- Anonymous production workspaces derived from a random 256-bit `HttpOnly`,
  `Secure`, `SameSite=Lax` cookie. Caller workspace selectors work only on
  explicit local/test hosts.
- One backend projection powers the console's answers, proposals, receipts,
  replays, outcomes, and evals. Failed commands do not advance UI state.
- A deterministic provider keeps the public proof reproducible and honestly
  reports zero model tokens and cost.
- JSON-RPC 2.0 MCP tools over POST for the shared agent contract.
- A provider-neutral `DemoClient` chooses a fresh API or a checked-in,
  deterministic recording without changing the console UI.

The anonymous cookie is an isolation mechanism for the public demonstration,
not a substitute for enterprise authentication. The production path replaces
it with user and agent service identities.

## Persistence and consistency

Every workspace mutation runs in one database transaction. The workspace row is
updated with an optimistic version compare-and-swap before dependent records
are persisted. A stale writer returns `409 CONCURRENT_UPDATE`, and the failed
transaction leaves no partial sources, claims, conflicts, or events.

IDs and every collection query are workspace-scoped. Collection reads have
deterministic ordering so seed hashes, context versions, receipts, and replay
remain reproducible after a database round trip. Source events, claims,
approvals, context evidence, runs, and outcomes are append-oriented; mutable
lifecycle projections retain supersession history.

Opening a workspace has a provider-neutral 1.25-second storage deadline. A
missing connection, failed query, timeout, or failed write returns HTTP `503`
with error code `STORAGE_UNAVAILABLE` in production. Production never switches
to process memory. Demo reset is intentionally destructive only inside the
current browser workspace and runs transactionally.

## Recorded fallback

```text
Console -> DemoClient -> fresh API -> Supabase Postgres
                    \-> versioned recording -> pure deterministic state machine
```

`ApiDemoClient` first requests `/api/demo/state` with a bounded browser timeout.
Only a network failure, timeout, or storage `503` selects
`RecordedDemoClient`; validation, permission, and domain errors remain visible.
Once selected, the mode is pinned for the current console session. A failure
after a successful live mutation offers retry/reset instead of silently changing
the source of truth.

`/tano?demo=recorded` is the explicit zero-live-API entry point. It loads the
static versioned fixture directly; the same route is offered as an intentional
reset after a recoverable live mutation failure.

The checked-in recording supports the complete ask, ingest, approve/reject,
agent, replay, outcome, and reset workflow without live API calls. It declares
its accepted question and workflow inputs; anything else returns an explicit
“not included in this recording” response. The fixture generator invokes pure
domain functions, not a deployed server, and records schema, generator, fixture
hash, and 24/24 eval metadata.

## API boundary

The canonical `/api/*` family and browser-oriented `/api/demo/*` family expose
the same 11 operations: state, reset, ask, ingest, update, approve, reject,
run-agent, replay, outcome, and MCP. This is a 22-path contract. `update` remains
an alias of `ingest`; both families preserve envelopes, errors, status codes,
64KB request limits, and `Cache-Control: no-store`.

The deployment target is Vercel, but the runtime has no host-specific adapter
and can run on any Node 22 platform. Future authenticated connectors, hybrid
vector/lexical retrieval, long-running graphs, and model providers can sit
behind the existing deterministic domain and MCP boundaries.
