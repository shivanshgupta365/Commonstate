# Commonstate — Tano Edition

> **Every human. Every agent. Same state.**

![Commonstate social preview](public/og.png)

Commonstate is an operational context control plane: one living, permissioned
truth shared by people and agents. It versions decisions, compiles the minimum
valid context for a task, and produces a content-addressed receipt for every
dry-run agent action.

This is an independent, unofficial Tano concept built from public Tano material
and visibly synthetic campaign records. It uses no private Tano data and never
contacts creators, changes contracts, moves money, or mutates campaigns.

- [Repository](https://github.com/shivanshgupta365/commonstate-tano-edition)
- [90-second guided proof](docs/demo-script.md) — also built directly into `/tano`
- Live deployment: added after the first production publish

## The proof loop

The Tano Edition runs one complete operational workflow:

1. Ask which creators can launch whitelisted TikTok ads under £15k.
2. Inspect eligibility with literal source spans, validity, and classification.
3. Ingest a synthetic Slack update that changes outreach, rights, and delivery state.
4. Review every extracted proposal and resolve its visible conflicts.
5. See the blast radius across context packs and scheduled actions.
6. Run the dry-run Relationship Agent against newly compiled state.
7. Inspect its context, provider, tools, approvals, actions, and receipt hash.
8. Replay the prior run against current truth and expose the newly blocked action.
9. Record the outcome as a proposed learning that cannot self-approve.

The product includes Overview, Change Inbox, Memory Map, Ask Commonstate, Agent
Console, Replay, Evals, an evidence drawer, command palette, and responsive
mobile navigation.

## Why this is not another RAG chatbot

Chunk retrieval can find an old brief. It cannot safely determine which of two
instructions is current, whether a rights window has expired, who approved a
change, or which scheduled actions must now stop.

Commonstate treats operational knowledge as typed, temporal claims with:

- exact source content hash and literal source span
- company, client, and campaign scope
- human or agent author and authority
- observed, valid, and freshness timestamps
- public, private, or synthetic classification
- lifecycle and supersession history
- task-aware context selection and claim-level citations
- content-addressed, append-only receipts between demo resets

Expired critical facts and unresolved rights, fee, whitelisting, or delivery
conflicts fail closed for the affected action.

## Architecture

```text
Sources -> Evidence ledger -> Truth engine -> Context compiler
   -> Humans and agents -> Receipts and outcomes -> Evidence ledger
```

The shipped vertical slice uses Next.js/Vinext, TypeScript, Cloudflare-compatible
Workers output, D1/Drizzle persistence, and a deterministic provider. A
memory-backed fallback keeps local development usable without external
credentials; `/api/demo/state` reports the active storage mode.

The production direction is NestJS, Postgres/Supabase, pgvector, LangGraph,
Gemini structured outputs, and authenticated Streamable HTTP MCP. The demo
already exposes the same tool contract through a POST JSON-RPC endpoint:

```text
get_context_pack(task, entity_refs, as_of?)
get_evidence(claim_ids)
propose_claim(subject_ref, predicate, value, source_ref, validity, idempotency_key)
request_approval(proposal_ids, reason)
record_outcome(run_id, status, metrics, notes)
```

In production, anonymous browser workspace identity comes from a random
256-bit `HttpOnly`, `Secure`, `SameSite=Lax` session cookie. Header, query, and
body workspace selectors are ignored outside local/test hosts. Agent writes
also enforce actor activity, permission, and write budget.

## API surface

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/demo/state` | Current isolated workspace projection |
| POST | `/api/demo/reset` | Restore the deterministic demo seed |
| POST | `/api/demo/ask` | Compile a cited, task-aware answer |
| POST | `/api/demo/ingest` | Add an untrusted source event and proposals |
| POST | `/api/demo/approve` | Human-approve proposed truth |
| POST | `/api/demo/reject` | Reject proposed truth |
| POST | `/api/demo/run-agent` | Produce dry-run actions and a receipt |
| POST | `/api/demo/replay` | Compare the same run across context versions |
| POST | `/api/demo/outcome` | Record an outcome and propose a learning |
| POST | `/api/demo/mcp` | MCP-style JSON-RPC `initialize`, `tools/list`, `tools/call` |

All mutations return `{ ok, action, result, state }`. The console advances only
after a successful API result and renders the returned evidence, proposals,
agent run, replay, outcome, and eval data.

## Repository map

- `app/` — product routes and API handlers
- `components/landing/` — Commonstate product story and interactive preview
- `components/console/` — Tano operating console and guided workflow
- `db/` and `drizzle/` — normalized D1 schema and generated migration
- `lib/commonstate/` — truth, context, receipt, eval, and persistence domain
- `docs/` — architecture, threat model, ADRs, outreach, and demo script
- `tests/` — domain/API/rendered tests plus Playwright browser flows
- `.github/workflows/ci.yml` — lint, typecheck, build, tests, and browser CI

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and enter the Tano Edition. Local development
defaults to isolated in-memory persistence when D1 and its migration are not
available. Inspect `state.meta.mode` from `/api/demo/state` to confirm the mode.

Generate a new migration after changing `db/schema.ts`:

```bash
npm run db:generate
```

## Verify

```bash
npm run lint
npm run typecheck
npm test
npm run playwright:install
npm run test:e2e
```

The release suite currently passes:

- 52 deterministic Node tests
- 24 executed domain-v2 acceptance invariants
- 4 Chromium product flows, including the complete six-step proof and 390px mobile
- 100/100 Lighthouse accessibility and best practices on `/` and `/tano`
- 7.0ms local p95 for the seeded state endpoint across 30 requests

The eval suite recomputes results from state invariants. Provenance tampering
causes a real failure; no acceptance result is seeded as `passed: true`.

## Data, safety, and honest limits

- Public Tano evidence links to [Tano's official agent-readable documentation](https://www.tano.ai/llms-full.txt).
- Creator and campaign operations are labelled **synthetic** in data and UI.
- Exact stored source bytes produce each source hash; every claim span must occur in its source.
- Retrieved instructions are quarantined as untrusted data.
- Re-ingestion uses content hashes and idempotency keys.
- Consequential actions remain dry-run and human-gated.
- The deterministic provider reports zero model tokens and zero model cost.
- Demo reset intentionally replaces that browser's isolated workspace history.
- The D1 path is built and migration-tested, but this repository's local CI does
  not claim a live hosted-D1 integration test.

Tano's public docs state that live campaign data is not publicly self-serve and
outbound webhooks are not currently emitted, so this concept never implies
privileged integration access.

## What I would build with Tano access

1. Authenticated Slack, Drive, email, Linear, and campaign event connectors.
2. Source ACL synchronization, deletion propagation, and freshness SLOs.
3. Postgres/pgvector hybrid retrieval behind the deterministic compiler.
4. OAuth-scoped MCP identities and transactional write budgets.
5. Outcome attribution across CTR, CPA, ROAS, delivery time, and corrections.
6. Continuous adversarial evals against Tano's real event and action schemas.

## Architecture decisions

- [Typed temporal claims over chunk-only RAG](docs/adr/0001-temporal-claims.md)
- [Relational adjacency before a graph database](docs/adr/0002-relational-graph.md)

## Application note

**Subject: I built the missing context layer for Tano's agents**

Your message about a shared company brain stuck with me. I built Commonstate: a
Tano Edition where operator decisions become versioned knowledge, agents receive
only current scoped context, and every action is cited, audited, and replayable.
The live product includes a guided 90-second proof, and the repository contains
the system decisions, threat model, and executable evals. I would love to show
you what I would build next with Tano's real event stream.
