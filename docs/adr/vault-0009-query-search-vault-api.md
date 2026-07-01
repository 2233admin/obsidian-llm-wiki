# ADR 0009: Query/Search Consumes Vault Read APIs Instead of Parsing Markdown Directly

## Status

Accepted

## Context

Canonical vault state lives in Markdown files under `sources/` and `evidence/`. Query/search needs those records, but direct Markdown/frontmatter parsing in query/search would duplicate schema handling and make schema migrations harder.

## Decision

Query/search should consume normalized records from vault read/index APIs rather than parsing Markdown directly.

Suggested boundary:

```text
vault.read_sources()
vault.read_evidence()
vault.build_index_snapshot()

query/search consumes normalized records
query/search owns ranking, embeddings, and retrieval
```

## Consequences

- Vault owns Markdown parsing, schema version handling, and path/link normalization.
- Query/search owns retrieval behavior and indexing strategy.
- Future schema changes can be handled inside vault APIs without updating every query/search caller.
- The Markdown files remain canonical even though consumers use normalized records.
