# Commonstate platform foundations

This repository contains provider-neutral foundations for the multi-company private beta. The modules are deliberately separated from public deterministic fixtures and are wired into authenticated product routes without importing demo-specific domain code.

## Configuration and solution packs

`packages/configuration` defines immutable, schema-versioned workspace configuration and complete AI Operations, Enterprise Governance, Agency Operations, and blank packs. A published configuration version binds the ontology, action policy, agents, metrics, workflows, and evaluations used by later context packs and receipts.

Static API payloads remain application-owned and should use Zod. Customer entity attributes and predicate values are validated by `CustomerSchemaValidator` with Ajv. It disables coercion, defaults, and removal of unknown fields and does not permit customer code or executable schema keywords.

## Model providers

`packages/providers` exposes one structured-output interface:

- The deterministic provider requires an exact model and cache-key recording.
- OpenAI uses the Responses API with strict JSON Schema output and does not store responses.
- Gemini uses `responseMimeType: application/json` and `responseJsonSchema`.
- Anthropic uses Messages structured output through `output_config.format`.

All live adapters require credentials supplied by the server, apply an abort deadline, return token and latency receipts, and never read a workspace or actor identity from model output. An absent credential returns `PROVIDER_NOT_CONFIGURED`; deterministic fallback is explicit in the provider route. Retrieved source content is treated as untrusted and obvious prompt instructions are quarantined before inference.

## Connectors

`packages/connectors` owns normalized source events, manifests, credential state, cursor monotonicity, ACL replacement, deletion propagation, webhook replay protection, and provider transport seams.

- File upload normalization and HMAC-signed webhook ingestion are complete provider-independent primitives. The configured webhook value is a deployment master: Commonstate derives a different signing secret for every organization, workspace, and connector, and the deployment secret broker distributes that derived value to the sender.
- Slack history, Google Drive files/changes, Microsoft Teams messages, and SharePoint/OneDrive delta synchronization use their official SDKs when a server-side access token and target IDs are supplied.
- OAuth authorization, callback routes, token refresh, and subscription/webhook registration remain deployment/application responsibilities. The adapters report `ready: false` without credentials and never present a connector as connected merely because its manifest exists.
- Drive and SharePoint metadata events mark `bodyPending` when a separate content-fetch/storage job is required. They are not accepted as body evidence until that job stores and hashes the immutable bytes.

Every external delivery must be written with a unique `(workspace_id, connector_instance_id, delivery_id)` key. ACL events replace the prior provider ACL; deletion events tombstone the projection, clear body hashes and ACLs, and invalidate dependent context packs.

## Outbox, actions, usage, and audit

`apps/worker` provides the Postgres claim SQL and repository boundary for `FOR UPDATE SKIP LOCKED`, idempotent enqueue, exponential retry, dead-letter, queued and in-flight cancellation, health snapshots, and cooperative shutdown. Production must instantiate `PostgresOutboxRepository`; the in-memory repository is only for tests and local development.

`packages/policy` deterministically raises action risk and cannot accept a lower model-selected tier. Reversible internal actions may auto-execute; medium actions need one approval; high actions need two independent approvals, recent reauthentication, preflight, and explicit execution; critical actions are blocked. The coordinator enforces a workspace kill switch, connector disablement, idempotency, compensation, and hash-bound execution receipts.

`packages/observability` defines additive usage events, deterministic aggregates, retention decisions, and a tenant-bound append-only audit hash chain. Audit collection projections intentionally omit before/after bodies and expose only hashes.

## Application wiring and deployment boundary

The product API now supplies the server-owned organization, workspace,
principal, permission, and scope context; transaction-local RLS settings;
configuration versioning; idempotent mutations; audit and usage records; signed
webhook ingestion; and durable outbox records. Authenticated product routes do
not import a public recording or anonymous workspace fallback.

Live customer rollout still has an explicit credential and infrastructure
boundary:

1. `PRODUCT_DATABASE_URL` must use the checked-in restricted runtime role, not
   the migration/schema owner.
2. Source bytes are uploaded through the authenticated
   `/api/v1/workspaces/:slug/sources/upload-url` contract into the private
   `SUPABASE_SOURCE_BUCKET`. Completion rechecks object metadata, byte size,
   content type, and SHA-256 before marking the artifact ready and queuing its
   extraction job. The server uses only `SUPABASE_SERVICE_ROLE_KEY`; production
   has no local-storage fallback.
3. Provider and connector secret references must resolve through the
   deployment's KMS-backed credential service.
4. `WORKER_HANDLER_MODULE` must compose the approved connector-sync,
   source-body fetch, extraction, action-execution, and retention handlers.
5. Connector OAuth applications, callbacks, subscriptions, and provider
   webhook registrations must be completed in the customer's environment.
6. Feature flags, monitoring, backup/restore, retention, and incident routing
   must pass the dedicated or hosted environment runbook.

A manifest or adapter being present never marks the corresponding external
system as live. Readiness remains false until authorization, preflight, and an
audited activation succeed.
