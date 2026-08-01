# ADR 0002: Relational adjacency before a graph database

**Status:** Accepted

## Context

Commonstate needs traversable relationships and reverse dependency lookups for
blast-radius analysis. The initial scale does not justify a second operational
database.

## Decision

Represent entities and relationships in relational tables with indexed source,
target, type, workspace, and scope columns. Keep typed claim values in JSON.

## Consequences

- Transactions, permissions, audit events, and graph edges live in one store.
- SQL joins are sufficient for the current product scale and straightforward to test.
- A dedicated graph store remains an optimization if later workloads require
  multi-hop traversal at materially larger scale.
