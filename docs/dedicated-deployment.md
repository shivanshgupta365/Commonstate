# Vendor-managed dedicated deployment runbook

Dedicated deployments use the same reviewed commit, migrations, policies, and solution packs as hosted Commonstate. A customer receives separate Vercel, Supabase, Fly.io, encryption-key, domain, monitoring, and backup boundaries; there are no customer code forks.

## 1. Approve the manifest

1. Copy `deploy/dedicated/manifest.example.json` into the private deployment inventory.
2. Validate it against `deploy/dedicated/manifest.schema.json`.
3. Pin `vercel.gitRef` to a reviewed commit SHA. Mutable branches are prohibited for production promotion.
4. Keep only secret-manager references in the manifest. Plain database passwords, service-role keys, provider keys, connector tokens, and encryption material are prohibited.
5. Obtain customer approval for region, hostname, retention, SSO domains, connector scopes, and incident contacts.

Generate the deterministic promotion plan before provisioning:

```bash
npm run deploy:dedicated:plan -- /path/to/customer-manifest.json
```

The command rejects schema drift and requires a full reviewed 40-character
commit SHA for production. Its JSON output is the immutable input to the
provisioning pipeline and release evidence bundle; it contains secret-manager
references, never secret values.

The plan also rejects non-HTTPS or cross-host health checks, raw network URLs
in secret fields, reused secret references, and a Fly command that does not
start the Commonstate worker. `manifestHash` binds the reviewed source manifest;
`planHash` binds its ordered promotion phases. CI validates the checked-in
example on every change. The planner is deliberately non-provisioning: the
release pipeline must pass this reviewed plan to the vendor APIs using its own
short-lived deployment identity, so a repository command can never create a
customer environment from a developer laptop implicitly.

## 2. Provision isolated infrastructure

1. Create a Supabase project in the approved region with point-in-time recovery, network restrictions, three distinct database credentials, and an `immutable-sources` private bucket. `MIGRATION_DATABASE_URL` is the schema owner and is available only to the release pipeline. `DATABASE_URL` is the server-side authentication/provisioning role with no DDL permission. `PRODUCT_DATABASE_URL` is `commonstate_runtime`, the `NOBYPASSRLS` role used for tenant-scoped product commands and workers.
2. Apply migrations with the migration connection, then run RLS tests using the restricted runtime role. Applying the migration command a second time must produce no change.
   Install `drizzle/runtime-role.sql` with the owner connection, grant that role
   a generated login credential through the secret manager, and verify
   `current_user = 'commonstate_runtime'`, `rolbypassrls = false`, and
   `rolsuper = false` through the runtime connection before starting the app.
3. Create the Vercel project from the pinned commit. Configure its custom domain, `NEXT_PUBLIC_SITE_URL`, Supabase public values, server-only `DATABASE_URL`, RLS-enforced `PRODUCT_DATABASE_URL`, and secret references. Never bind `MIGRATION_DATABASE_URL` to the web project.
4. Create the Fly.io worker app in the paired region with at least one running machine. Supply only `PRODUCT_DATABASE_URL` and the encryption-key reference; the worker must not receive the schema-owner credential. The worker command must run the concrete handler composition around `PostgresOutboxRepository` and `runWorkerRuntime`.
5. Generate a unique workspace encryption key and signing secrets. Never reuse hosted-SaaS or another customer's keys.

## 3. Configure identity and integrations

1. Create the customer's WorkOS organization and verify its domain before enabling SSO or Directory Sync.
2. Map directory groups to organization roles and scope grants; test provisioning, deprovisioning, and revoked-session rejection.
3. Create connector OAuth applications or customer consent records per provider. Store access and refresh credentials encrypted; the presence of a connector manifest alone must not mark it connected.
4. Start every connector paused. Run a least-privilege list-only preflight, review sample ACL mappings and deletion behavior, then activate it with an audit event.
5. Keep external action execution disabled until the customer's action allowlist, approvers, compensation behavior, and kill-switch owners are signed off.

## 4. Verify before promotion

- Auth: email/Google as contracted, enterprise SSO, directory provisioning/deprovisioning, reauthentication, and service-account rotation.
- Isolation: guessed IDs, Storage paths, SQL joins, REST, MCP, jobs, callbacks, and audit exports cannot cross the organization boundary.
- Data: file and signed webhook ingestion, one configured OAuth connector, ACL replacement, deletion, retry, cursor replay, and duplicate delivery.
- Safety: low action executes once; medium and high approvals cannot be bypassed; critical action is blocked; kill switch prevents new execution; compensation result is receipted.
- Reproducibility: configuration upgrade invalidates current context while historical receipts replay against their bound configuration version.
- Operations: `/api/health`, worker health snapshot, alerts, dead-letter inspection, usage aggregation, point-in-time restore, Storage restore, and key-rotation rehearsal.
- Product: clean HTTPS incognito onboarding through ingest, approve/reject, ask, agent, action, replay, and outcome with no recorded-demo fallback.

Production promotion requires a signed manifest, green migrations and tests, a successful restore drill, no serious accessibility findings, and customer confirmation of identity and retention settings.

## 5. Operate and recover

- Alert on web/API availability, outbox age, dead-letter rate, connector auth failures, RLS denials, model error rate, and audit-chain verification.
- Stop new external work with the workspace kill switch before pausing the worker or a connector. Do not delete queued jobs during an incident.
- Rotate service-account, provider, connector, and signing credentials without changing workspace identity. Record every rotation in the audit ledger.
- Test database and immutable-source restoration quarterly. Restore into a quarantined project, verify hashes and tenant boundaries, then destroy the drill environment.
- Deploy with expand-contract migrations: web and worker must tolerate both schemas during rollout. Roll back application code only after confirming queued payload compatibility.
