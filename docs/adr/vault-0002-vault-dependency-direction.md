# ADR 0002: Keep Vault Dependencies Above Ingest and Below Release/Query

## Status

Accepted

## Context

The vault layer needs to integrate with provider, ingest, release-check, and query/search surfaces without becoming a catch-all module. The key risk is duplicating provider/platform logic inside vault lint or making provider code aware of Markdown vault storage.

## Decision

The dependency direction is:

```text
provider -> ingest -> vault -> release-check
                  \-> query/search
```

More precisely:

- The provider layer does not depend on vault.
- The ingest layer owns source classification, provider selection, artifact capture, and output production.
- The vault layer consumes a versioned ingest output contract and owns Markdown state, scaffold, views, hot cache, and lint.
- The release-check layer may call vault lint and apply stricter release semantics.
- Query/search may read or index canonical `sources/` and `evidence/` notes.

## Consequences

- Vault lint must not duplicate provider/platform decisions.
- Ingest-to-vault integration should happen through an explicit contract or narrow write API.
- Release-check should reuse vault lint results instead of reimplementing schema validation.
- Query/search integration should treat Markdown source/evidence notes as canonical vault state.
