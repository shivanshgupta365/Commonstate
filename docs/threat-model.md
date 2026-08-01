# Commonstate threat model

## Protected assets

- private source files, extracted text, ACLs, and temporal claims
- organization membership, roles, scope grants, and service credentials
- ontology, policy, connector, provider, and BYOK configuration
- approvals, context packs, model/tool inputs, actions, and compensation
- receipts, replay, outcomes, usage records, and audit history

## Trust boundaries

- Browser and MCP input is untrusted and cannot select tenant identity.
- Connector payloads are untrusted until signature, delivery identity, tenant
  mapping, and cursor rules are verified.
- Retrieved source content is untrusted data, never system or tool instruction.
- Model output is a proposal and cannot set permissions, authority, risk,
  approvals, or execution identity.
- The application enforces access, and PostgreSQL RLS independently enforces the
  organization/workspace boundary with a restricted runtime role.
- Worker jobs are untrusted stale work until identity, kill switch, connector,
  policy, and idempotency are revalidated.

## Threats and controls

| Threat | Control |
| --- | --- |
| Guessed workspace or object ID | Active membership selects the server context; slugs and object IDs grant nothing; repository and RLS filters both apply. |
| Cross-tenant SQL join | Organization/workspace columns, composite foreign keys, transaction-local RLS settings, restricted `NOBYPASSRLS` role, and negative role tests. |
| Private body leakage in lists | Collection projections omit source bodies; evidence reads require permission, scope, and source/claim ACL checks. |
| Revoked user remains active | Supabase user verification plus active-membership check on every command; Directory Sync immediately revokes linked memberships/service accounts. |
| Stolen service credential | Secret shown once, SHA-256 hash stored with a server pepper, key prefix lookup, expiry, rotation/revocation, workspace and scope binding. |
| Caller-selected actor/tenant | Actor, organization, workspace, role, and grants come only from verified auth records; body/query/header/model/MCP overrides are ignored or rejected. |
| OAuth or magic-link redirect abuse | Relative-only allowlist behavior, repeated decoding checks, backslash/protocol-relative rejection, and same-origin URL resolution. |
| Session refresh leakage through cache | Supabase SSR cookie rotation mirrors required no-cache headers; authenticated API responses are `no-store`. |
| Forged or replayed webhook | Provider/HMAC signature verification over raw bounded bytes, durable provider event ID, payload hash conflict detection, and tenant mapping from stored connector metadata. |
| Out-of-order connector update | Provider cursors and observed timestamps are monotonic; duplicates are idempotent; deletion creates a tombstone and invalidates dependent context. |
| Prompt injection in sources | Source text stays in a delimited data channel; system/tool permissions are server-owned; structured output is schema-validated. |
| Poisoned recursive summary | Derived summaries cannot validate themselves or become authority for their own source chain. |
| Expired or superseded fact | Lifecycle, valid-time, freshness, precedence, and conflict filters execute before retrieval ranking and action compilation. |
| Fabricated citation | Claim stores source ID/hash/span; evidence read verifies literal provenance; receipts bind exact claim IDs and context hash. |
| Duplicate or concurrent write | Required idempotency key, transactional idempotency record, optimistic compare-and-swap, unique delivery keys, and rollback on stale version. |
| Model lowers action risk | Policy can only raise the effective tier; medium/high approvals are independent records; critical actions are non-executable. |
| Approval replay or self-approval | Permission, distinct approver, proposal status/version, expiry, and recent-auth checks occur in the execution transaction. |
| Worker side effect repeats | Job and action idempotency, connector preflight, attempt receipts, status transition checks, and compensation result. |
| Provider/BYOK crosses workspace | Secret reference and provider configuration are tenant-bound; caches include workspace, source hash, and configuration version. |
| Audit history rewritten | Append-only application API, chained before/after hashes, restricted runtime privileges, and exported chain verification. |
| Storage outage causes demo data in production | Authenticated routes fail with typed `503`; only explicit public demo clients can load checked-in recordings. |

## Risk-tier execution boundary

The effective tier is the maximum of requested operation, policy categories,
data classification, connector capability, and irreversible consequences.

- Low execution requires reversibility, verified compensation, enabled
  connector, live preflight, idempotency, and no kill switch.
- Medium execution requires one currently authorized approver.
- High execution requires two distinct authorized approvers, recent
  authentication, preflight, and a final explicit execution command.
- Critical execution is rejected in private beta.

Externally sent messages, access changes, destructive deletion, payments, and
contract mutation are critical by default.

## Acceptance evidence

- Product integration creates two organizations and proves UI/API/MCP/resource
  IDs cannot cross them.
- RLS tests use `SET ROLE commonstate_runtime`, not the schema owner, and prove
  a mismatched organization/workspace context returns no rows.
- Deprovisioning tests prove a verified Directory Sync event disables access and
  an altered replay is rejected.
- Source projection tests prove private bodies never appear in collections.
- Prompt-injection, provenance-tampering, stale-rights, conflict, recursive
  summary, and replay evals are executable rather than hard-coded badges.
- Concurrent write tests prove `CONCURRENT_UPDATE` leaves no partial records.
- Action tests prove low executes once, medium/high cannot bypass approval, and
  critical never executes.
- Public fixture tests assert zero `/api/v1` requests; authenticated console
  tests assert no recording is loaded after an API failure.

## Operational controls still required per deployment

- Supabase point-in-time recovery and private Storage backup/restore rehearsal
- WorkOS and connector webhook endpoint registration and secret rotation
- managed/BYOK secret storage backed by a production KMS
- WAF/rate limits, abuse monitoring, alert routing, and incident ownership
- quarterly tenant-isolation, credential-rotation, and restore exercises
- reviewed retention/deletion policy and customer data-processing terms

These are deployment controls, not conditions silently simulated by the demo.
The private beta must not be promoted for a customer until its dedicated or
hosted environment has completed the runbook in `docs/dedicated-deployment.md`.
