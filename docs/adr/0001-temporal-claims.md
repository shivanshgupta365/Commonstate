# ADR 0001: Typed temporal claims over chunk-only RAG

**Status:** Accepted

## Context

Similarity search can find relevant text but cannot reliably decide which of
two conflicting instructions is current, who approved it, or whether it is
valid for a specific campaign.

## Decision

Store source material immutably, then project atomic claims with a subject,
predicate, typed value, scope, author, source span, confidence, lifecycle, and
validity window. Retrieval returns claims and evidence, not unqualified chunks.

## Consequences

- Conflicts, expiry, and supersession become explicit product states.
- Agent context is deterministic and auditable.
- Ingestion is more expensive than raw chunking, but the cost is paid once and
  actionable retrieval becomes safer and smaller.
