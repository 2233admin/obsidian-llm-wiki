# ADR 0007: Keep Vault Lint Local and Let Release-Check Promote Severity

## Status

Accepted

## Context

Vault lint and release-check both need to evaluate vault readiness, but they answer different questions. Vault lint asks whether local vault state is internally healthy. Release-check asks whether a vault is acceptable for a specific publication or delivery profile.

## Decision

`vault lint` remains the local integrity checker. `llmwiki-release-check` may call vault lint and promote selected issues to stricter severities based on release policy.

Default split:

```text
vault lint
  -> local health check
  -> errors block with exit 1
  -> warnings are visible but exit 0
  -> stale hot cache is warning
  -> unsupported source is warning
  -> missing optional views is info

release-check
  -> publication/delivery gate
  -> unresolved conflict is error
  -> stale hot cache is error
  -> contract/state mismatch is error
  -> unsupported source error/warning depends on release profile
```

## Consequences

- Vault lint does not need to know every release policy.
- Release-check reuses vault lint rather than copying schema and path rules.
- Release profiles can evolve without changing the vault's local health semantics.
