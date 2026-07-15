# Threat model

## Protected assets

- Client and campaign-scoped facts
- Contract, payment, rights, and deliverable status
- Human approvals and agent identities
- Context packs, receipts, outcomes, and audit history

## Trust boundaries

- Retrieved source text is untrusted data, never executable instruction.
- Production demo workspace identity comes from a server-issued random cookie;
  callers cannot select it through request headers, query strings, or JSON.
- Agent writes enforce active actor status, permission, and write budget.
- Agent writes are proposals; consequential external actions remain dry-run.
- Derived summaries cannot become authority for the material that produced them.

## Primary threats and controls

| Threat | Shipped control |
| --- | --- |
| Cross-browser leakage | Random 256-bit `HttpOnly`, `Secure`, `SameSite=Lax` workspace cookie; every stored/query ID is workspace-scoped; foreign MCP claim IDs resolve to no evidence. |
| Caller-selected tenant | Header, query, and body workspace values are ignored outside explicit local/test hosts. |
| Stale rights or contracts | Critical stale or invalid rights, fee, platform, whitelisting, and delivery evidence fails closed for the affected action. |
| Prompt injection | Retrieved instructions are quarantined as data and cannot grant tools or alter system policy. |
| Duplicate/replayed writes | Content hashes and idempotency keys collapse duplicate ingestion and outcomes. |
| Concurrent approvals | Optimistic workspace versions reject stale saves. |
| Agent privilege escalation | Inactive, unpermissioned, or over-budget agent proposals are rejected. |
| Agent self-validation | Outcomes create proposed learning that still requires human review. |
| Misleading provenance | Source hashes derive from exact stored content and claim spans must be literal substrings; public and synthetic evidence use distinct classifications. |
| Misleading receipts | Receipt hashes bind the displayed context, provider/model, tools, approvals, cost, latency, actions, holds, and timestamps. |
| Destructive public actions | Outreach, payments, contracts, and campaign mutations are never executed in this edition. |

## Acceptance evidence

- Production-like API tests prove two cookies cannot read each other's state and
  caller selectors cannot cross the boundary.
- MCP evidence lookup returns nothing for a foreign-workspace claim ID.
- Provenance tampering changes executed evals from pass to fail.
- High-risk conflicts hold affected actions while unrelated safe work can remain.
- Replay with unchanged bound inputs reproduces the receipt hash.

## Honest limits

- The anonymous cookie isolates demo visitors but is not enterprise user auth.
- A stolen session cookie remains usable until replaced; the shipped attributes
  reduce exposure but production should add identity, rotation, and revocation.
- Demo reset deletes and recreates the current isolated workspace by design.
- D1 multi-record persistence relies on optimistic versioning; production should
  use transactional Postgres writes and durable recovery.
- No live creator, payment, contract, campaign, or private Tano integration exists.
