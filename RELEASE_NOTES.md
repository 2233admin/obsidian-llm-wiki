# LLM Wiki v2.6.0 release candidate

This release candidate turns system settings, Project Context, and Work Run coordination into shared LLM Wiki domains instead of host-specific features. Obsidian is the primary visual control plane, while MCP and Python remain usable headlessly.

It is not the final release record yet. The deterministic local fleet harness is part of the release gate; a real local ↔ 5090 run must still be recorded at the final product commit before main is released.

## Shared Settings Platform

- One versioned setting registry and schema contract across TypeScript, Python, MCP, and Obsidian.
- Deterministic precedence: `session > workspace-project > vault > user-device > product default`.
- Expected-revision mutations, validation, provenance, snapshot explanation, migration planning, and evidence-backed Doctor health.
- Secret References replace plaintext credentials. Snapshots, events, plugin data, Project Hubs, exports, and logs never carry resolved secret values.
- `LLMWIKI_COMPILER_PATH` is the canonical source-install override; `VAULT_MIND_COMPILER_PATH` remains compatible.

## Obsidian control plane

- The LLM Wiki settings page consumes the shared operation contract instead of duplicating settings logic.
- Plugin data retains only presentation preferences, the local device binding reference, and the migration journal.
- Legacy `pythonPath` and `kbMetaPath` values migrate to user-device assignments with exact-preimage compensation and revision-guarded rollback.
- Effective value, winning scope, inheritance, validation, apply mode, Secret Reference status, and Doctor results are visible from Obsidian.
- The plugin ID remains `vault-mind-promote` so existing installations continue to load.

## Project Context and Work-OS

- Every Project has one durable `project/<slug>` identity across work, knowledge, runtime, settings, and integrations.
- Repository and vault paths are machine-local Workspace Bindings. GitHub, Gitea, Linear, and Orca identifiers are External Projections.
- Current work lives in `01-Projects/<project>/issues/`; the old `10-Projects/<project>/docket/**` store remains retired.
- Project Hub is a read-only composition over domain owners. Its settings section uses the real Effective Settings Snapshot and reports degraded or unavailable state honestly.
- Anchor-only and legacy layouts have inventory, deterministic plan, explicit apply, backup manifest, conflict protection, and preview-first restore operations.

## Work Runs and fleet handoff

- Work Driver and workflow operations preserve the same Project ID, Work Item ID, Work Run ID, agent identity, and idempotent transitions.
- Local joins validate the active machine-local lease.
- `portable-handoff` uses a short-lived capability bound to the durable Work Run. Only its hash and expiry are durable; the raw capability and local workspace paths remain device-local.
- Mismatched Project, Work Item, Work Run, agent, missing capability, and incorrect capability joins fail without mutation.
- The acceptance harness exercises local prepare, remote join/checkpoint/leave, replay safety, and local Doctor/Project Hub verification with independent vault copies.

## Link diagnostics naming

**LLM Wiki** is the product name. **OBC** means only the existing **Obsidian Broken Link Checker** compatibility and link-diagnostics package. OBC consumes shared settings; it is not the settings backend or a synonym for the system.

## Upgrade notes

1. Review [docs/INSTALL.md](docs/INSTALL.md) and [docs/SETTINGS.md](docs/SETTINGS.md).
2. Back up existing Obsidian plugin data and Settings documents before the first upgraded plugin load.
3. Follow [docs/MIGRATIONS.md](docs/MIGRATIONS.md) for plugin or Project layout migration.
4. Run `settings.validate`, `settings.doctor`, and `project.context.doctor`.
5. Inspect the read-only `project.hub.get` result for settings, workspace, runtime, and integration drift.

The current capability and authority map is in [docs/CAPABILITY_INVENTORY.md](docs/CAPABILITY_INVENTORY.md).

## Release evidence status

- Shared Settings, Project Context/Hub, migration, workflow, plugin, bundle, and install-smoke gates are defined for the release branch.
- The local deterministic two-vault fleet harness is implemented.
- The real 5090/Orca sequence is documented in [docs/FLEET_WORKFLOW_ACCEPTANCE.md](docs/FLEET_WORKFLOW_ACCEPTANCE.md) but is **not claimed complete in these notes**.
- Final release requires the same tested commit, fixture digest, and correlation ID across local prepare, 5090 remote execution, and local verification, followed by a clean release audit.
