# Agent Wiki Contracts

This package is the versioned, host-neutral serialization boundary shared by
the TypeScript MCP host and the Python compiler. JSON schemas and fixtures are
the canonical wire contract; each runtime keeps an independent implementation
and proves parity against the same fixtures.

Contract version 1 covers capability profiles, ingest runs, source-versioned
contribution manifests, maintenance queue entries, execution receipts,
embedding fingerprints, and safe query traces. Optional providers remain
optional and provider-specific payloads must not cross this boundary.
