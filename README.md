# Commonstate

> **Every human. Every agent. Same state.**

![Commonstate social preview](public/og.png)

![Commonstate architecture — humans and agents acting from the same verified state](public/commonstate-architecture.png)

Commonstate is an operational-context control plane for companies using people
and AI agents together. It turns changing company activity into permissioned,
temporal claims; compiles only the valid context required for a task; applies
deterministic action policy; and records an evidence-backed receipt for every
decision.

The product is built as a hosted multi-tenant SaaS and as a vendor-managed
dedicated deployment. Its operating model is configured from data, not
customer-specific code forks.

## Product surfaces

- `/` — product landing page and solution-pack switcher
- `/login` — email, Google, and enterprise SSO entry points
- `/setup` — seven-step workspace and ontology builder
- `/app/[workspaceSlug]/overview` — operational truth health
- `/app/[workspaceSlug]/inbox` — proposed-claim review
- `/app/[workspaceSlug]/map` — entities, relationships, and evidence
- `/app/[workspaceSlug]/ask` — cited, time-aware decisions
- `/app/[workspaceSlug]/agents` — agent identities, tools, budgets, and receipts
- `/app/[workspaceSlug]/replay` — historical context comparison
- `/app/[workspaceSlug]/evals` — executable trust and safety checks
- `/app/[workspaceSlug]/settings` — draft and publish immutable configuration
- `/demo/[template]` — transparent, zero-API public template fixtures

Authenticated workspaces never substitute recorded data. Public demos are
visibly labelled synthetic and deterministic.

## Complete solution packs

| Pack | Scope hierarchy | Core operating objects |
| --- | --- | --- |
| AI Operations | Company → Team → Workflow | agents, tools, runs, incidents, policies, decisions, outcomes |
| Enterprise Governance | Organization → Business Unit → System | policies, controls, evidence, vendors, owners, exceptions, reviews |
| Agency Operations | Agency → Client → Engagement | briefs, assets, deliverables, approvals, vendors, campaigns, outcomes |
| Blank | Customer-defined | validated scope, entity, predicate, metric, agent, and policy definitions |

Every pack includes a versioned ontology, policy defaults, metrics, configured
agents, a guided workflow, synthetic evidence, outcome definitions, and a
24-case evaluation manifest. The visual builder can tailor the vocabulary,
scope hierarchy, entities, sources, providers, approvers, risk policy,
branding, locale, timezone, and currency before publishing configuration v1.

## Why this is more than connected search

Search can retrieve an old instruction. It cannot safely decide which
instruction is current, whether the requester may use it, which policy applies,
or whether a downstream action must stop.

Commonstate models operational knowledge as typed, temporal claims with:

- immutable source hashes and literal evidence spans
- organization, workspace, and nested-scope ownership
- source, claim, and principal ACLs
- author, authority, confidence, classification, and valid time
- proposed, approved, rejected, superseded, and expired lifecycle states
- deterministic precedence, freshness, conflict, and risk rules
- claim-level citations in answers, context packs, actions, and replay
- immutable ontology and policy versions bound to historical receipts

Unresolved high-risk truth fails closed. Models can propose; deterministic
policy decides what may execute.

## Architecture

```text
Slack · Drive · Teams · SharePoint · Files · Signed webhooks
                         │
                         ▼
             Evidence ledger + source ACLs
                         │
                         ▼
     Truth engine ── configuration + policy versions
                         │
                         ▼
      Permission filters → freshness/conflict filters
                         │
                         ▼
          Hybrid retrieval + context compiler
                         │
                 ┌───────┴────────┐
                 ▼                ▼
              Humans        MCP / agents
                 └───────┬────────┘
                         ▼
          Actions · receipts · outcomes · audit
```

The repository keeps the Next.js 16 web/API application at its root and uses
npm workspaces for shared platform packages and a Node 22 worker:

- `app/` — native App Router pages and route handlers
- `components/product/` — generic product, onboarding, demos, and console
- `lib/product/` — authentication, tenancy, API, MCP, and repositories
- `packages/configuration/` — templates, Ajv schemas, and version validation
- `packages/policy/` — risk classification, approvals, execution, compensation
- `packages/providers/` — Gemini, OpenAI, Anthropic, and deterministic adapters
- `packages/connectors/` — files, webhooks, Slack, Drive, Teams, and Graph
- `packages/observability/` — audit-chain, retention, and usage primitives
- `apps/worker/` — PostgreSQL outbox worker with retries and dead-letter state
- `db/` and `drizzle/` — PostgreSQL schema, RLS, migrations, and runtime role
- `deploy/dedicated/` — validated dedicated-deployment manifest

Runtime topology:

- Vercel: Next.js web and API
- Supabase: PostgreSQL, Auth, Storage, full-text search, and pgvector
- Fly.io: asynchronous ingestion and connector worker
- WorkOS: enterprise SSO and Directory Sync

## Identity and tenant isolation

Workspace slugs are presentation-only. Every production request constructs a
server-owned command context from the authenticated user or service account,
its active membership, role, and scope grants. Request bodies, route slugs,
models, and MCP arguments cannot choose an actor or tenant.

Tenant isolation is enforced twice:

1. command-specific repositories apply permissions, scope grants, and ACLs;
2. a restricted PostgreSQL runtime role is subject to row-level security.

The schema uses tenant-composite foreign keys, rotating hashed service-account
credentials, append-only audit events, idempotency records, and organization /
workspace ownership on operational rows. Collection projections omit private
source bodies. Directory deprovisioning immediately disables the corresponding
membership or service account before asynchronous cleanup is queued.

## Risk-tiered actions

| Tier | Private-beta behavior |
| --- | --- |
| Low | reversible internal operation may execute once when compensation is verified |
| Medium | waits for one authorized human approval |
| High | waits for two authorized approvers, recent re-authentication, and connector preflight |
| Critical | blocked |

Payments, contracts, access changes, destructive deletion, and externally sent
messages are critical by default. Workspaces also have a kill switch and
connector-level execution controls. Every path produces a policy and execution
receipt; retries reuse the caller's idempotency key.

## Public API and MCP

`/api/v1` provides authenticated, cursor-paginated resources for sessions,
organizations, workspaces, configuration, members, roles, connectors, sources,
claims, conflicts, approvals, context packs, agents, actions, replays, outcomes,
usage, jobs, and audit events. Production writes require `Idempotency-Key`.

The authenticated `/api/v1/mcp` endpoint accepts bearer service-account
credentials and exposes:

```text
get_context_pack
get_evidence
propose_claim
request_claim_approval
propose_action
request_action_approval
get_action_status
record_outcome
```

## Connectors and model providers

Connector adapters implement provider authorization seams, webhook signature
verification, cursor-based sync, deletion propagation, source ACLs, and
idempotent writes. A connector remains visibly unconfigured until its required
credentials and callback authorization are present; the UI never implies a
successful live sync without them.

Provider-neutral structured-output adapters are included for Gemini, OpenAI,
and Anthropic. Selection and fallback are workspace-scoped, deterministic demos
use no managed model, and provider responses are validated before entering the
truth workflow. Enterprise BYOK records reference encrypted credentials rather
than exposing secrets to the browser or model.

## Run locally

Requires Node.js 22 and PostgreSQL 16. A local PostgreSQL URL is required for
authenticated product work; only the legacy demo may use its explicit test
memory mode.

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

For a local database-backed owner session, set:

```text
DATABASE_URL=postgresql://localhost/commonstate
PRODUCT_DATABASE_URL=postgresql://commonstate_runtime:...@localhost/commonstate
MIGRATION_DATABASE_URL=postgresql://localhost/commonstate
COMMONSTATE_LOCAL_AUTH=true
COMMONSTATE_CREDENTIAL_PEPPER=<local-random-secret>
```

Then open [http://127.0.0.1:3000](http://127.0.0.1:3000). Production and Vercel
deployments do not permit local bootstrap authentication.

Key environment groups are documented in `.env.example`:

- database owner, restricted runtime, and migration URLs
- Supabase browser and server credentials
- WorkOS SSO and webhook credentials
- managed model provider keys
- connector OAuth, signing, and encryption credentials
- worker, telemetry, and health settings

## Database and worker

Apply migrations with the owner or migration role, then install the checked-in
restricted runtime grants:

```bash
npm run db:migrate
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/runtime-role.sql
```

Run the worker locally with:

```bash
npm run worker:start
```

Jobs are claimed with `FOR UPDATE SKIP LOCKED`, use bounded retries, and move to
a dead-letter state after the configured limit. The worker exposes a health
endpoint and supports cancellation and idempotent handlers.

## Verification

```bash
npm run lint
npm run typecheck
npm run typecheck:workspaces
npm test
npm run test:platform
npm run build
npm run playwright:install
npm run test:e2e
npx --no-install lhci autorun --config lighthouserc.cjs
```

Durable integration runs additionally set `DATABASE_URL`,
`PRODUCT_DATABASE_URL`, and `COMMONSTATE_CREDENTIAL_PEPPER`, apply every
migration twice, and run the PostgreSQL, RLS, concurrency, API, MCP, WorkOS,
performance, and product workflow contracts.

## Private-beta boundary

This repository implements the production private-beta application and its
credential-gated integration seams. Customer production rollout still requires
real Supabase, WorkOS, model-provider, connector, monitoring, encryption, and
cloud credentials; security review; backup/restore rehearsal; and an approved
dedicated-deployment manifest. Stripe self-serve billing, arbitrary customer
code, customer-cloud deployment, critical external actions, and formal SOC 2
certification are intentionally outside this milestone.
