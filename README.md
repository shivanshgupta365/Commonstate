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

The shipped product is a native Next.js 16 App Router application with TypeScript,
React 19, Drizzle, and Supabase Postgres. It builds with `next build`, runs with
`next start`, deploys normally to Vercel, and also runs on any Node 22 host.

The 17-table relational model uses JSONB, native booleans, timezone-aware
timestamps, workspace indexes, and foreign-key constraints. Every workspace
mutation is one PostgreSQL transaction. Optimistic compare-and-swap rejects a
stale writer before any dependent row is committed, and deterministic query
ordering keeps context hashes, receipts, and replay reproducible.

The product exposes the shared agent contract through a POST JSON-RPC endpoint:

```text
get_context_pack(task, entity_refs, as_of?)
get_evidence(claim_ids)
propose_claim(subject_ref, predicate, value, source_ref, validity, idempotency_key)
request_approval(proposal_ids, reason)
record_outcome(run_id, status, metrics, notes)
```

At runtime, `DATABASE_URL` points to the Supabase transaction pooler and prepared
statements are disabled for pooler compatibility. `MIGRATION_DATABASE_URL` is
used by Drizzle for schema changes. `/api/state` and `/api/demo/state` report
`state.meta.mode` as `"postgres"` or `"memory-local"`.

Process memory is allowed only in local development and tests. In production,
missing, failed, or timed-out storage returns HTTP `503` with error code
`STORAGE_UNAVAILABLE`; the server never silently places operational state in
instance memory.

### Fresh and recorded operation

The console talks through a provider-neutral `DemoClient` boundary:

- `ApiDemoClient` uses the live `/api/demo/*` contract.
- `RecordedDemoClient` uses the versioned
  `public/demo/recorded-tano-v1.json` fixture.

The browser first attempts live state with a bounded timeout. A network failure,
timeout, or storage `503` loads the recording and pins that console session to
**Recorded deterministic**. Validation, permission, and domain failures do not
trigger fallback, and a failed live mutation never silently changes mode.
Open `/tano?demo=recorded` to intentionally skip the live API and start directly
from the recording. After a recoverable live-mutation failure, the existing mode
control offers this explicit reset while leaving retry available.

Recorded mode implements ask, ingest, approve, reject, agent run, replay,
outcome, and reset. It accepts only the inputs declared by the recording; other
questions receive an explicit “not included in this recording” result. The
fixture is generated from pure domain functions, carries a schema version,
generator version, fixture hash, and 24/24 eval result, and is verified before
use.

In production, anonymous browser workspace identity comes from a random
256-bit `HttpOnly`, `Secure`, `SameSite=Lax` session cookie. Header, query, and
body workspace selectors are ignored outside local/test hosts. Agent writes
also enforce actor activity, permission, and write budget.

## API surface

The same 11-operation contract is available under both `/api` and `/api/demo`,
for 22 route paths in total:

| Method | Suffix | Purpose |
| --- | --- | --- |
| GET | `/state` | Current isolated workspace projection |
| POST | `/reset` | Restore the deterministic demo seed |
| POST | `/ask` | Compile a cited, task-aware answer |
| POST | `/ingest` | Add an untrusted source event and proposals |
| POST | `/update` | Compatibility alias for `/ingest` |
| POST | `/approve` | Human-approve proposed truth |
| POST | `/reject` | Reject proposed truth |
| POST | `/run-agent` | Produce dry-run actions and a receipt |
| POST | `/replay` | Compare the same run across context versions |
| POST | `/outcome` | Record an outcome and propose a learning |
| POST | `/mcp` | JSON-RPC `initialize`, `tools/list`, and `tools/call` |

State success is `{ ok, state }`; mutation success is `{ ok, action, result,
state }`; failures are `{ ok: false, error: { code, message } }`. All JSON
responses use `Cache-Control: no-store`, request bodies are capped at 64KB, and
the two prefixes preserve the same status codes and alias behavior. The MCP
endpoint speaks JSON-RPC 2.0 with protocol version `2025-06-18` and exposes all
five tools listed above.

The console advances only after a successful result and renders the returned
evidence, proposals, agent run, replay, outcome, and eval data.

## Repository map

- `app/` — product routes and API handlers
- `components/landing/` — Commonstate product story and interactive preview
- `components/console/` — Tano operating console and guided workflow
- `db/` and `drizzle/` — normalized PostgreSQL schema and generated migration
- `lib/commonstate/` — truth, context, receipt, eval, and persistence domain
- `public/demo/` — versioned deterministic recording served by this application
- `scripts/generate-recorded-fixture.ts` — pure-domain recording generator
- `docs/` — architecture, threat model, ADRs, outreach, and demo script
- `tests/` — domain, route, PostgreSQL, performance, and browser contracts
- `.github/workflows/ci.yml` — quality, storage, live/recorded browser, and
  Lighthouse release gates

## Run locally

Requires Node.js 22.13 or newer.

For the full persistent product, copy the environment template and replace the
placeholder Supabase URLs:

```bash
cp .env.example .env
# Replace the placeholder URLs in .env, then:
npm install
npm run db:migrate
npm run dev
```

The variables are:

| Variable | Use |
| --- | --- |
| `DATABASE_URL` | Supabase transaction-pooler URL used by the application |
| `MIGRATION_DATABASE_URL` | Direct or session-pooler URL used only by Drizzle |
| `NEXT_PUBLIC_SITE_URL` | Canonical public origin for metadata and social cards |
| `POSTGRES_POOL_MAX` | Optional per-instance connection cap; defaults to `3` |

Open `http://localhost:3000` and enter the Tano Edition. Inspect
`state.meta.mode` from `/api/demo/state` to confirm `"postgres"`.

For UI work without credentials, `npm run dev` intentionally uses isolated
`"memory-local"` storage. That behavior is unavailable in a normal production
process.

Generate a new migration after changing `db/schema.ts`:

```bash
npm run db:generate
npm run db:migrate
```

Apply `npm run db:migrate` a second time to verify the migration is idempotent.

### Vercel deployment

1. Set `DATABASE_URL`, `NEXT_PUBLIC_SITE_URL`, and optionally
   `POSTGRES_POOL_MAX` in the Vercel project.
2. Apply migrations separately with `MIGRATION_DATABASE_URL`.
3. Keep the standard build command `npm run build`; no custom output adapter is
   required.
4. After deployment, open `/api/state` over HTTPS and verify
   `state.meta.mode === "postgres"` before promoting the release.

Do not set `COMMONSTATE_TEST_MEMORY` in a deployed environment. It exists only
for automated production-server tests.

## Verify

```bash
npm run lint
npm run typecheck
npm run build
npm test
npm run demo:record
git diff --exit-code -- public/demo/recorded-tano-v1.json
npm run playwright:install
npm run test:e2e
npx --no-install playwright test --config playwright.recorded.config.ts
npx --no-install lhci autorun --config lighthouserc.cjs
```

To run the durable-storage contracts against a local PostgreSQL or Supabase test
database:

```bash
npm run db:migrate
node --test tests/postgres-repository.test.mjs tests/api.test.mjs tests/performance.test.mjs
```

The release gates cover:

- all 22 native route paths and both prefix families
- seed, mutation, reset, idempotency, rollback, and stale concurrent writes
- live and zero-live-API recorded versions of the complete workflow, including
  reject and reset branches
- two-browser workspace isolation, 64KB bodies, cookies, and selector rejection
- keyboard, reduced-motion, 390px, Axe, and Lighthouse checks
- 50 successful warm PostgreSQL context-pack requests with p95 below 750ms
- 24 executed domain-v2 acceptance invariants

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
- Production storage failures return `503 STORAGE_UNAVAILABLE`; no server-instance
  memory fallback is used.
- Recorded mode is visibly labelled, verifies its fixture hash, and rejects
  unsupported inputs instead of presenting canned evidence as fresh output.

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
