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

- Next.js/Vinext UI and API routes with Cloudflare Worker-compatible output.
- Drizzle schema and generated migration for 17 normalized D1 tables.
- D1 persistence when the binding and migration are present; isolated memory
  fallback otherwise, reported through `state.meta.mode`.
- Anonymous production workspaces derived from a random 256-bit `HttpOnly`,
  `Secure`, `SameSite=Lax` cookie. Caller workspace selectors work only on
  explicit local/test hosts.
- One backend projection powers the console's answers, proposals, receipts,
  replays, outcomes, and evals. Failed commands do not advance UI state.
- A deterministic provider keeps the public proof reproducible and honestly
  reports zero model tokens and cost.
- MCP-shaped JSON-RPC tools over POST for the shared agent contract.

The anonymous cookie is an isolation mechanism for the public demonstration,
not a substitute for enterprise authentication. The production path replaces
it with user and agent service identities.

## Persistence and consistency

The repository applies an optimistic workspace version to reject concurrent
stale saves. IDs and every query are workspace-scoped. Source events, claims,
approvals, context evidence, runs, and outcomes are append-oriented; mutable
lifecycle projections retain supersession history.

Demo reset is intentionally destructive inside the current browser workspace.
Production would use transactional Postgres writes, durable audit retention,
deletion propagation, and recovery tooling. This repository validates the D1
migration and Worker build but does not claim a live D1 integration run in CI.

## Production path

The API boundary maps to NestJS without changing product contracts. D1 records
map to Postgres/Supabase and JSONB; pgvector and lexical ranking can sit behind
the deterministic filters. LangGraph owns long-running agent state, Gemini
structured outputs sit behind the provider interface, and authenticated
Streamable HTTP MCP exposes the same tools to scoped agent identities.
