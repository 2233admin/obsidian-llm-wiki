# ADR 0001: Put the Vault Layer in the LLMwiki Main Repository

## Status

Accepted

## Context

The vault work began as a prototype under `10-Projects/llmwiki-vault`, but its real purpose is to provide the Markdown-first product layer for the broader LLMwiki system. It must integrate with `llmwiki-ingest`, `llmwiki-provider`, `llmwiki-release-check`, and query/search surfaces.

Keeping it as a standalone side project would make the source/evidence schema, CLI commands, ingest output contract, and release-check rules drift away from the modules that need to consume them.

## Decision

The vault layer will be merged into the LLMwiki main repository as an internal system module/package. Its CLI should hang under the main `llmwiki` command tree.

## Consequences

- The prototype implementation is migration input, not the final packaging boundary.
- Vault lint should become reusable by release-check instead of being copied.
- Ingest should produce or hand off a versioned output contract that the vault layer can consume.
- Query/search should index or read the canonical `sources/` and `evidence/` notes.
- Future PRs should target the LLMwiki main repository, not a separate `llmwiki-vault` repository.
