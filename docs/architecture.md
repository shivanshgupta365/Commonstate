# Commonstate architecture

Commonstate is a configurable operational-context platform. It preserves the
source, permission, time, policy, and configuration behind a fact so that both
humans and agents can make safe decisions from the same current state.

## System flow

```text
Sources → immutable evidence → proposed temporal claims → human truth workflow
                                                │
                                                ▼
identity + scope grants → deterministic filters → hybrid retrieval
                                                │
                                                ▼
                                   versioned context pack
                                                │
                                  ┌─────────────┴─────────────┐
                                  ▼                           ▼
                               humans                    MCP agents
                                  └─────────────┬─────────────┘
                                                ▼
                         policy → approval → action receipt → outcome
                                                │
                                                ▼
                                      append-only audit ledger
```

1. Connectors normalize source events and retain provider cursors, ACLs,
   deletions, content hashes, and idempotency keys.
2. Extraction proposes typed claims against the active ontology version.
3. Authorized humans approve, reject, merge, or supersede proposals.
4. Context compilation filters by tenant, principal, scope, claim ACL,
   lifecycle, time, freshness, and conflict before ranking.
5. The returned context pack binds the ontology version, policy version,
   principal, scope grants, evidence, provider, model, and tool versions.
6. Models propose actions. Deterministic policy raises the effective risk tier
   and decides whether execution is allowed, requires approval, or is blocked.
7. Actions, compensation, outcomes, and replay are bound to immutable receipts.

## Runtime topology

The application is a native Next.js 16 App Router project on Node 22. Vercel is
the primary web/API target, but the output runs with ordinary `next start` on
any compatible Node host.

- **Vercel:** pages, authenticated REST API, MCP, auth callbacks, connector
  callbacks, webhooks, and server-sent progress endpoints.
- **Supabase:** PostgreSQL, Auth, private Storage, full-text search, and
  pgvector. Runtime traffic uses a transaction pooler with prepared statements
  disabled.
- **Fly.io:** Node worker that claims PostgreSQL outbox jobs with
  `FOR UPDATE SKIP LOCKED` and performs connector, extraction, and action work.
- **WorkOS:** enterprise SSO through Supabase third-party auth and Directory
  Sync webhook events for provisioning/deprovisioning.

Shared packages isolate customer configuration, providers, connectors, policy,
and observability from the product UI and public deterministic fixtures.

## Identity and command context

Every production operation begins with a user session or rotating hashed
service-account credential. The server resolves active membership, role,
permissions, and scope grants and constructs:

```ts
type CommandContext = {
  principal: {
    type: "user" | "service_account" | "system";
    principalId: string;
    actorId: string;
  };
  organizationId: string;
  workspaceId: string;
  allowedScopeIds: string[];
  permissions: string[];
  authenticatedAt: string | null;
  requestId: string;
  clock: Clock;
};
```

The URL slug only locates a candidate membership. It never grants access.
Request bodies, query parameters, connector payloads, model output, and MCP
arguments cannot replace the actor, organization, workspace, or scope grants.

Supabase SSR session rotation happens in `proxy.ts`; API authorization still
uses a fresh verified user lookup so revocation is observed. Production and
Vercel deployments cannot enable local bootstrap authentication.

## Tenant-safe persistence

Product repositories are command-specific and paginated; they do not load and
rewrite a whole workspace. A mutation runs in one transaction, installs
transaction-local organization/workspace/principal settings, performs an
optimistic version check when required, writes domain state, idempotency,
usage, audit, and outbox records, then commits atomically.

PostgreSQL is an independent tenant boundary:

- operational rows carry organization and workspace IDs;
- composite foreign keys prevent mismatched tenant relationships;
- the runtime connection uses a `NOBYPASSRLS`, non-owner role;
- row-level policies read only transaction-local server context;
- negative tests execute as the actual runtime role;
- owner/migration credentials are never used by product repositories.

Collection APIs expose metadata projections. Private source bodies are returned
only through evidence endpoints after permission, scope, and ACL checks.

## Configuration versions

The visual builder produces validated JSON rather than executable customer
code. Zod validates static API shapes; Ajv validates customer-defined JSON
Schemas without coercion, defaults, or unknown-key removal.

A workspace configuration includes branding, terminology, scope-kind rules,
entity definitions, predicate schemas, precedence, freshness, conflicts,
approval policy, agent/tool access, metrics, workflows, and evaluations.
Changes are saved as drafts. Publishing creates an immutable ontology/policy
version and invalidates affected current context packs. Historical receipts
continue to replay with the versions under which they were created.

## Retrieval and evidence

Source bytes belong in a private Supabase Storage bucket. PostgreSQL stores the
object path, hash, classification, source metadata, extracted text, ACLs,
chunks, lexical vector, and optional embedding.

Context compilation orders its work deliberately:

1. organization/workspace and principal authorization
2. allowed scope and source/claim ACLs
3. approved lifecycle, temporal validity, freshness, and supersession
4. unresolved conflict and action-risk filters
5. PostgreSQL full-text and pgvector ranking
6. deterministic ordering and context hashing

Filtering before ranking prevents an embedding hit from bypassing access or
validity rules.

## Connectors and asynchronous work

The provider-neutral connector contract covers file upload, HMAC webhooks,
Slack, Google Drive, Microsoft Teams, and SharePoint/OneDrive. Adapters retain
authorization state, monotonic cursors, provider event IDs, ACL replacement,
deletion tombstones, and normalized delivery hashes.

The web transaction enqueues durable jobs. The worker owns bounded retries,
exponential backoff, dead-letter state, cancellation, and health reporting.
Handlers are idempotent and must re-check the workspace kill switch and
connector execution state immediately before an external side effect.

## Provider and action boundaries

Gemini, OpenAI, and Anthropic implement one validated structured-output
interface. Workspace selection, fallback order, secret resolution, source-hash
cache keys, and configuration versions remain outside model control. Public
demos use an explicit deterministic provider.

Action risk is assigned deterministically:

- low: reversible internal operation with verified compensation
- medium: one authorized human approval
- high: two independent approvals, recent re-authentication, preflight, and
  explicit execution
- critical: blocked during private beta

Every proposal, approval, preflight, attempt, compensation result, and outcome
is auditable and idempotent.

## Public demonstrations and compatibility

`/demo/[template]` uses checked-in synthetic fixtures and performs no production
API request. Authenticated `/app/*` surfaces never fall back to a recording or
anonymous fixture.

The demonstration clock exists only in fixture/domain code. Production command
contexts use an injectable real UTC clock.

## Deployment models

Hosted SaaS and vendor-managed dedicated deployments use the same commit,
migrations, configuration schema, and worker. A dedicated deployment receives
separate Vercel, Supabase, Fly.io, domain, encryption keys, secrets, monitoring,
backup, and restore boundaries. Customer-specific code forks are prohibited.
