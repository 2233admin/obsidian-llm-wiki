---
llmwiki_type: analysis
title: Shipped capability inventory against the LLM Wiki × OBC × Dream Time target
generated-by: agent:codex
generated-at: 2026-07-13
agent: codex
status: draft
review: draft
scope: project
project: obsidian-llm-wiki
source-nodes:
  - repo:37b5e6e56319b9b8fe66b6ae34db3cb8f9961a8f
---

# Shipped capability inventory

## Scope and baseline

This inventory answers the Wayfinder question “which capabilities are shipped, partial, or absent?” against authoritative baseline `37b5e6e`. It is inspection evidence, not promoted architecture truth.

The highest-priority lens is the user-identified **LLM Wiki system-wide settings gap**. The system has substantial domain behavior, but it does not yet have one settings domain, registry, schema, migration path, or control plane shared by its runtimes and user interfaces. OBC is only one settings consumer; it is not the center of this gap.

## Executive finding

The repository is not missing a knowledge backend. It already ships a broad MCP, compiler, query, Work-OS, source-registration, view-generation, and diagnostic foundation. The structural gap is a system-wide settings platform:

- Runtime configuration is fragmented across environment variables, a partially parsed `vault-mind.yaml`, compiler-specific files, machine-local bindings, connector-specific variables, workflow files, and Obsidian plugin `data.json`.
- There is no canonical versioned settings schema, registry, typed domain API, migration protocol, validation/doctor report, or secret-reference policy spanning LLM Wiki.
- The Obsidian plugin is still a `0.1.0` single-purpose Promote gesture with only two path fields, so it cannot act as the main control plane for the existing system.
- OBC, community-plugin lifecycle, vault readiness, adapters, providers, Work-OS, cycles, publishing, and Dream Time integration all need to consume the same settings platform rather than inventing local configuration.
- Daily notes and generic cycle rollups exist, but Daily/Weekly/Monthly are not yet one coherent knowledge-cycle product surface.

The next architecture work should therefore reuse the shipped engines and specify the missing **LLM Wiki Settings Platform plus Obsidian control plane**, rather than redesigning OBC, plugin installation, query, or Work-OS from scratch.

## Capability matrix

| Target area | State | Shipped evidence | Important gap |
|---|---|---|---|
| System settings / configuration | Structurally absent | Individual configuration loaders, environment variables, example YAML, local bindings, plugin `data.json`, connector variables, and workflow constants exist | No canonical settings registry/schema/API, layered precedence model, migration, validation, secret references, change events, or cross-runtime parity |
| Source registration | Shipped Phase 1 | `source.register/list/get`; URL and vault-path registration; Source Notes and registry | No executable `repoPath`, `filePath`, `directoryPath`, or `text` registration; registration is not capture |
| Capture / ingest | Partial | `ingest.providers` and `ingest.link.preflight`; OPENCLI and media/transcribe routing contract | Preflight does not execute capture; provider output must still land in the vault and be indexed |
| Knowledge Items / governance | Shipped foundation | AI-output quarantine, provenance, memory, conversation decisions, promotion policy, work write policy | Product/Repository/Capability/Release identity is not yet first-class |
| Compiler | Shipped, broad | Compile run/diff/status/abort; rhizome metadata; currency, initiatives, cycles, Work-OS, graph/holon/provenance output | Several advanced compiler capabilities remain CLI-only and are not visible in Obsidian settings |
| Unified query | Shipped | Eight query operations: filesystem search, RRF unified search, semantic/vector search, trace, answer, explain, adapter inventory | Adapter/configuration health is not presented as a coherent user settings surface |
| Work-OS | Shipped foundation | Project issue CRUD/linking/comments; derived Kanban, Canvas, and Base views; Python/TypeScript board parity; work driver and budget/lease mechanics | Plugin dependencies and execution controls are not integrated into the Obsidian UI |
| Vault readiness | Shipped but fragmented | `context.vault_status` has five readiness buckets; `vault.lint` checks health; OBC provides deeper static diagnostics | Readiness, OBC findings, plugin status, and remediation are separate surfaces with no unified diagnosis page |
| OBC diagnostics | Shipped CLI engine / one settings consumer | Link extraction/resolution, explicit diagnostic codes, orphan/stale detection, semantic suggestions, fix planning, guarded apply | No integration with the system settings domain, MCP operation, Obsidian command, run history, pack configuration, or result view |
| Community plugin lifecycle | Shipped backend | Read-only status plus safe, dry-run-first, atomic install/enable; validates IDs; preserves user `data.json` on refresh | Only `kb_meta ensure-plugin`; defaults around Kanban; no inventory UI, update UX, health explanation, or OBC binding |
| Obsidian plugin | Minimal / stale | Promote command, file-menu gesture, dry-run preview, base-head-safe apply | Version `0.1.0`; settings are only Python path and `kb_meta.py` path; no LLM Wiki system control plane |
| Daily / cycle | Partial | `vault.daily`; `cycle:` aggregation and completion view; weekly dogfood rollup script | Daily/Weekly/Monthly are not first-class governed knowledge-cycle artifacts with shared configuration and views |
| Connectors | Partial | Compiler connectors exist for Chubby, Gmail, Hacker News, web search, and X; MCP transport/connectors exist | Availability, credentials, provider health, and routing are not unified in plugin settings |
| Publishing | Partial | Static HTML exporter and Gitea `pages` branch workflow | Demo source is hard-wired; serving requires external admin setup; no product-facing publish settings/status |
| Views | Shipped foundation | Graph viewer; Obsidian-native JSON Canvas; Base export; Kanban rendering; static HTML | Views are generated through different commands and are not organized into one discoverable Obsidian experience |

## System settings and Obsidian control-plane deep dive

### Current configuration reality

LLM Wiki currently has configuration mechanisms, but not a settings backend:

- [`mcp-server/src/index.ts`](../../../mcp-server/src/index.ts) implements a local `loadConfig()` with environment-over-YAML precedence and recognizes only a limited top-level shape.
- [`vault-mind.yaml.example`](../../../vault-mind.yaml.example) describes richer nested adapter, compiler, agent, query, and collaboration settings than the simple line parser can faithfully represent.
- Adapters and connectors independently read many environment variables for endpoints, credentials, models, commands, timeouts, and paths.
- [`compiler/workspace.py`](../../../compiler/workspace.py) owns machine-local project bindings in `.vault-mind/local-bindings.json`.
- Obsidian plugins persist their own `data.json`; publishing uses workflow environment constants; scripts and hooks consume additional independent variables.

These are configuration fragments. They do not provide a canonical Settings entity, ownership metadata, typed validation, defaults and effective-value explanation, migrations, secret references, health, or consistent reads across TypeScript, Python, Obsidian, CLI, MCP, Dream Time, and future hosts.

### What is already reusable

1. **OBC diagnostic engine.** [`obc/README.md`](../../../obc/README.md) and [`obc/cli.py`](../../../obc/cli.py) expose `extract`, `check`, `orphan`, `stale`, `plan`, and `apply`. Diagnostics distinguish certainty and safety instead of returning a boolean.
2. **Plugin lifecycle backend.** [`compiler/plugins.py`](../../../compiler/plugins.py) already models installed and enabled as separate axes, detects broken half-states, plans before writing, performs atomic replacement, and preserves non-asset files such as plugin `data.json`.
3. **CLI integration.** [`compiler/kb_meta.py`](../../../compiler/kb_meta.py) exposes `ensure-plugin` with plugin ID, repository, dry-run/apply, and force controls.
4. **Vault readiness.** [`mcp-server/src/adapters/vaultbrain/vault-status.ts`](../../../mcp-server/src/adapters/vaultbrain/vault-status.ts) already distinguishes missing, empty, unindexed, stale/backgrounding, and ready vaults.

OBC is functionally implemented but not fully packaged as an installable product surface: the root [`pyproject.toml`](../../../pyproject.toml) declares no console-script entry point and an empty dependency list, while [`obc/semantic.py`](../../../obc/semantic.py) imports scikit-learn. This is one example of the system-wide requirement: every capability needs a settings/readiness contract that can honestly report whether it is configured and callable.

### What the current Obsidian plugin actually provides

[`obsidian-plugin/src/main.ts`](../../../obsidian-plugin/src/main.ts) is a thin Promote client. Its persisted settings model contains only:

- `pythonPath`
- `kbMetaPath`

The plugin has no representation of the LLM Wiki runtime, configuration layers, OBC, diagnostic packs, community-plugin inventory, connector availability, query adapters, source providers, publishing, cycles, Dream Time, or generated views. Its package and manifest remain at `0.1.0`.

### Confirmed missing settings-platform and control-plane capabilities

- A canonical, versioned `SettingsRegistry`/`SettingsSnapshot` domain contract shared by Python and TypeScript.
- A settings information architecture covering Runtime, Vault, Knowledge, Memory, Work-OS, Diagnostics, Community Plugins, Providers/Connectors, Query/Index, Daily/Weekly/Monthly cycles, Publishing, Dream Time, Security, and Advanced settings.
- Explicit setting ownership, scope, precedence, default, effective value, provenance, sensitivity, restart requirement, validation state, and capability dependencies.
- Layered scopes for product defaults, user/device, vault, workspace/project, and session overrides without placing machine paths or secrets into durable knowledge.
- Schema migrations, forward/backward compatibility, atomic persistence, backup/recovery, and cross-runtime conformance tests.
- Secret references and presence/health checks without returning or persisting secret values in reviewed knowledge or plugin-readable plain text.
- Read/write/validate/doctor/export/import/reset operations and change notifications for all hosts.
- Automatic runtime/path discovery and a test/doctor action; users should not have to understand `kb_meta.py` as the product boundary.
- Read-only plugin inventory and health: installed, enabled, version, update availability, missing assets, enabled-without-files, files-without-enabled-entry.
- Explicit install/enable/update/disable actions with dry-run previews and preserved plugin data.
- OBC run controls and profile/pack settings, with deterministic results, evidence, safety tier, and a route into reviewed Work-OS proposals.
- OBC runtime/package readiness checks, including a callable entry point and declared optional semantic dependencies.
- A durable, versioned settings schema with migrations and secret/reference boundaries.
- Status and remediation UX joining vault readiness, indexing, OBC findings, provider health, and plugin health.
- Tests for settings migration, Obsidian UI behavior, and the plugin-to-domain boundary.

## Release-drift evidence

- The Obsidian plugin feature was introduced on 2026-06-28 and remains version `0.1.0`.
- OBC was implemented in a sequence of commits on 2026-07-02.
- The authoritative baseline is from 2026-07-12, yet there is still no system-wide settings operation namespace, registry, migration mechanism, or parity contract across the plugin, MCP, compiler, connectors, scripts, and workflows.

This confirms the reported problem is system-wide: domain capabilities advanced independently while their configuration remained fragmented and the Obsidian control surface did not advance with them.

## Architecture implications for later Wayfinder tickets

1. Establish Settings as a first-class LLM Wiki domain before treating the Obsidian settings tab as the source of truth.
2. Treat the Obsidian plugin as the primary human-facing settings client and operational control plane; MCP, CLI, Dream Time, diagnostics, and other hosts use the same settings operations.
3. Keep durable knowledge and Work-OS authority separate from operational settings. Settings may reference vault/project identities but must not become a competing knowledge truth store.
4. Reuse existing engines such as `compiler/plugins.py`, OBC, vault readiness, query adapters, providers, and Work-OS; do not duplicate their logic in UI code.
5. Expose settings and capability operations through a stable bridge instead of shelling every feature directly from individual UI controls.
6. Keep OBC one-shot and replayable. It consumes system settings; it does not own the settings backend or scheduler.
7. Make the system-wide settings platform a prerequisite to the integration protocol and the first usable vertical slice.

## Evidence index

- MCP surface: [`docs/mcp-tools-reference.md`](../../../docs/mcp-tools-reference.md) — 104 operations across 18 namespaces.
- Host/plugin UI: [`obsidian-plugin/src/main.ts`](../../../obsidian-plugin/src/main.ts), [`obsidian-plugin/manifest.json`](../../../obsidian-plugin/manifest.json), [`obsidian-plugin/package.json`](../../../obsidian-plugin/package.json).
- OBC: [`obc/README.md`](../../../obc/README.md), [`obc/cli.py`](../../../obc/cli.py), [`docs/SPEC-OBC-MVP.md`](../../../docs/SPEC-OBC-MVP.md).
- Plugin lifecycle: [`compiler/plugins.py`](../../../compiler/plugins.py), [`compiler/tests/test_plugins.py`](../../../compiler/tests/test_plugins.py), [`compiler/kb_meta.py`](../../../compiler/kb_meta.py).
- Work-OS and views: [`docs/LOCAL_PROJECTS.md`](../../../docs/LOCAL_PROJECTS.md), [`HANDOFF.md`](../../../HANDOFF.md).
- Source and ingest boundaries: [`CONTEXT.md`](../../../CONTEXT.md), [`docs/INGEST.md`](../../../docs/INGEST.md), [`docs/AGENT_WORKFLOW_INTEGRATION.md`](../../../docs/AGENT_WORKFLOW_INTEGRATION.md).
- Publishing: [`docs/PAGES_PUBLISHING.md`](../../../docs/PAGES_PUBLISHING.md).

## Verification method

The inventory was derived from tracked source, generated MCP reference, tests, release history, and negative repository searches for OBC/plugin integration. No runtime or external repository was treated as durable truth.
