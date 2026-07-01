# ADR 0003: Use Contract-Then-Apply for Ingest to Vault Integration

## Status

Accepted

## Context

The ingest layer owns source classification, provider selection, pipeline execution, and artifact capture. The vault layer owns Markdown schema, path safety, generated views, hot cache, and lint. If ingest writes vault files directly, provider pipelines will gradually learn vault layout details and duplicate write safety logic.

## Decision

Ingest will produce a versioned `llmwiki.ingest.output` contract. The vault layer will validate and apply that contract to vault state.

The intended flow is:

```text
llmwiki ingest <source> --output-contract meta/ingest-123.md
llmwiki vault apply-ingest-output meta/ingest-123.md
llmwiki vault lint <vault>
```

## Consequences

- Ingest remains the provider/pipeline owner.
- Vault remains the Markdown schema and transaction owner.
- Contracts can be dry-run, linted, replayed, and tested independently.
- Release-check can validate contract/state consistency.
- Future providers do not need to understand vault file layout.
