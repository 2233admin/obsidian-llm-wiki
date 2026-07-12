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

The highest-priority lens is the user-identified OBC/Obsidian plugin settings gap: the system has substantial backend behavior, but the Obsidian-hosted configuration and diagnostic control surface has not kept pace.

## Executive finding

The repository is not missing a knowledge backend. It already ships a broad MCP, compiler, query, Work-OS, source-registration, view-generation, and diagnostic foundation. The structural gap is the human-facing Obsidian control plane:

- OBC is a capable one-shot static-analysis CLI, but it is not exposed through the Obsidian plugin.
- The Obsidian plugin is still a `0.1.0` single-purpose Promote gesture with only two path fields.
- A well-tested community-plugin install/enable/status backend already exists in Python, but it is reachable only through `kb_meta ensure-plugin`; it is not available through MCP or the plugin settings UI.
- Daily notes and generic cycle rollups exist, but Daily/Weekly/Monthly are not yet one coherent knowledge-cycle product surface.

The next architecture work should therefore reuse the shipped engines and specify the missing plugin control plane, rather than redesigning OBC, plugin installation, query, or Work-OS from scratch.

## Capability matrix

| Target area | State | Shipped evidence | Important gap |
|---|---|---|---|
| Source registration | Shipped Phase 1 | `source.register/list/get`; URL and vault-path registration; Source Notes and registry | No executable `repoPath`, `filePath`, `directoryPath`, or `text` registration; registration is not capture |
| Capture / ingest | Partial | `ingest.providers` and `ingest.link.preflight`; OPENCLI and media/transcribe routing contract | Preflight does not execute capture; provider output must still land in the vault and be indexed |
| Knowledge Items / governance | Shipped foundation | AI-output quarantine, provenance, memory, conversation decisions, promotion policy, work write policy | Product/Repository/Capability/Release identity is not yet first-class |
| Compiler | Shipped, broad | Compile run/diff/status/abort; rhizome metadata; currency, initiatives, cycles, Work-OS, graph/holon/provenance output | Several advanced compiler capabilities remain CLI-only and are not visible in Obsidian settings |
| Unified query | Shipped | Eight query operations: filesystem search, RRF unified search, semantic/vector search, trace, answer, explain, adapter inventory | Adapter/configuration health is not presented as a coherent user settings surface |
| Work-OS | Shipped foundation | Project issue CRUD/linking/comments; derived Kanban, Canvas, and Base views; Python/TypeScript board parity; work driver and budget/lease mechanics | Plugin dependencies and execution controls are not integrated into the Obsidian UI |
| Vault readiness | Shipped but fragmented | `context.vault_status` has five readiness buckets; `vault.lint` checks health; OBC provides deeper static diagnostics | Readiness, OBC findings, plugin status, and remediation are separate surfaces with no unified diagnosis page |
| OBC diagnostics | Shipped CLI engine | Link extraction/resolution, explicit diagnostic codes, orphan/stale detection, semantic suggestions, fix planning, guarded apply | No MCP operation, no Obsidian command/settings UI, no run history, no pack configuration, no result view |
| Community plugin lifecycle | Shipped backend | Read-only status plus safe, dry-run-first, atomic install/enable; validates IDs; preserves user `data.json` on refresh | Only `kb_meta ensure-plugin`; defaults around Kanban; no inventory UI, update UX, health explanation, or OBC binding |
| Obsidian plugin | Minimal / stale | Promote command, file-menu gesture, dry-run preview, base-head-safe apply | Version `0.1.0`; settings are only Python path and `kb_meta.py` path; no LLM Wiki/OBC control plane |
| Daily / cycle | Partial | `vault.daily`; `cycle:` aggregation and completion view; weekly dogfood rollup script | Daily/Weekly/Monthly are not first-class governed knowledge-cycle artifacts with shared configuration and views |
| Connectors | Partial | Compiler connectors exist for Chubby, Gmail, Hacker News, web search, and X; MCP transport/connectors exist | Availability, credentials, provider health, and routing are not unified in plugin settings |
| Publishing | Partial | Static HTML exporter and Gitea `pages` branch workflow | Demo source is hard-wired; serving requires external admin setup; no product-facing publish settings/status |
| Views | Shipped foundation | Graph viewer; Obsidian-native JSON Canvas; Base export; Kanban rendering; static HTML | Views are generated through different commands and are not organized into one discoverable Obsidian experience |

## OBC and plugin-settings deep dive

### What is already reusable

1. **OBC diagnostic engine.** [`obc/README.md`](../../../obc/README.md) and [`obc/cli.py`](../../../obc/cli.py) expose `extract`, `check`, `orphan`, `stale`, `plan`, and `apply`. Diagnostics distinguish certainty and safety instead of returning a boolean.
2. **Plugin lifecycle backend.** [`compiler/plugins.py`](../../../compiler/plugins.py) already models installed and enabled as separate axes, detects broken half-states, plans before writing, performs atomic replacement, and preserves non-asset files such as plugin `data.json`.
3. **CLI integration.** [`compiler/kb_meta.py`](../../../compiler/kb_meta.py) exposes `ensure-plugin` with plugin ID, repository, dry-run/apply, and force controls.
4. **Vault readiness.** [`mcp-server/src/adapters/vaultbrain/vault-status.ts`](../../../mcp-server/src/adapters/vaultbrain/vault-status.ts) already distinguishes missing, empty, unindexed, stale/backgrounding, and ready vaults.

OBC is functionally implemented but not fully packaged as an installable product surface: the root [`pyproject.toml`](../../../pyproject.toml) declares no console-script entry point and an empty dependency list, while [`obc/semantic.py`](../../../obc/semantic.py) imports scikit-learn. That packaging gap must be resolved before an Obsidian settings page can honestly report OBC as ready.

### What the current Obsidian plugin actually provides

[`obsidian-plugin/src/main.ts`](../../../obsidian-plugin/src/main.ts) is a thin Promote client. Its persisted settings model contains only:

- `pythonPath`
- `kbMetaPath`

The plugin has no representation of OBC, diagnostic packs, community-plugin inventory, connector availability, query adapters, source providers, publishing, cycles, or generated views. Its package and manifest remain at `0.1.0`, and repository history shows the plugin’s only feature commit predates the OBC implementation.

### Confirmed missing control-plane capabilities

- A settings information architecture covering Runtime, Vault, Diagnostics/OBC, Community Plugins, Providers/Connectors, Query/Index, Cycles, Publishing, and Advanced paths.
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
- The authoritative baseline is from 2026-07-12, yet there is no OBC reference in the plugin, installer scripts, setup scripts, MCP operations, or plugin settings.

This confirms the reported problem is real: OBC advanced independently while the Obsidian plugin settings/control surface did not advance with it.

## Architecture implications for later Wayfinder tickets

1. Treat the Obsidian plugin as LLM Wiki’s human-facing host adapter and control plane, not as OBC’s durable truth store.
2. Keep OBC one-shot and replayable. The plugin configures and invokes diagnostic runs; scheduling belongs outside OBC.
3. Reuse `compiler/plugins.py` for plugin lifecycle semantics. Do not build a second installer inside TypeScript.
4. Expose domain operations through a stable bridge instead of shelling every feature directly from individual UI controls.
5. Make OBC/plugin settings a prerequisite to the OBC diagnostic contract and the first vertical slice, because the vertical slice is not usable if diagnostics cannot be configured or inspected in the primary Obsidian experience.

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
