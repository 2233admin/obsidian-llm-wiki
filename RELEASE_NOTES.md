# LLM Wiki v2.7.0-beta.1

This release candidate turns system settings, Project Context, and Work Run coordination into shared LLM Wiki domains instead of host-specific features. Obsidian is the primary visual control plane, while MCP and Python remain usable headlessly.

The pre-Agent-binding baseline was verified at commit `89cf831ed4615270c56edd2784928a29e52e1789`. The Agent-binding beta product commit `b0c447a5f228ddd2d4f3f1ba0b001817f89ea155` repeated the complete 5090 gate and real local ↔ 5090 handoff before prerelease publication.

## Shared Settings Platform

- One versioned setting registry and schema contract across TypeScript, Python, MCP, and Obsidian.
- Deterministic precedence: `session > workspace-project > vault > user-device > product default`.
- Expected-revision mutations, validation, provenance, snapshot explanation, migration planning, and evidence-backed Doctor health.
- Secret References replace plaintext credentials. Snapshots, events, plugin data, Project Hubs, exports, and logs never carry resolved secret values.
- The default Agent model connection supports `inherit`, `local`, and `cloud` modes. MCP Agent/Compiler invocations consume the effective provider, base URL, and model; only cloud mode resolves a device-local Secret Reference at invocation time.
- `LLMWIKI_COMPILER_PATH` is the canonical source-install override; `VAULT_MIND_COMPILER_PATH` remains compatible.

## Obsidian control plane

- The LLM Wiki settings page consumes the shared operation contract instead of duplicating settings logic.
- Plugin data retains only presentation preferences, the local device binding reference, and the migration journal.
- Legacy `pythonPath` and `kbMetaPath` values migrate to user-device assignments with exact-preimage compensation and revision-guarded rollback.
- Effective value, winning scope, inheritance, validation, apply mode, Secret Reference status, and Doctor results are visible from Obsidian.
- The Agent model section exposes model mode, provider, OpenAI-compatible base URL, model identifier, and credential reference without adding a plaintext API-key field.
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

This beta is packaged as three manual-test archives for MCP, compiler, and the Obsidian plugin. For the plugin beta, extract `main.js`, `manifest.json`, and `styles.css` into an isolated vault's plugin directory; BRAT/community-store distribution is not claimed by this beta.

The current capability and authority map is in [docs/CAPABILITY_INVENTORY.md](docs/CAPABILITY_INVENTORY.md).

## Release evidence status

- Shared Settings, Project Context/Hub, migration, workflow, plugin, bundle, and install-smoke gates are defined for the release branch.
- The local deterministic two-vault fleet harness passed all 8 checks at product commit `b0c447a5f228ddd2d4f3f1ba0b001817f89ea155`.
- The previous 5090/Orca sequence passed exactly once for baseline commit `89cf831ed4615270c56edd2784928a29e52e1789`; details are recorded in [docs/FLEET_WORKFLOW_ACCEPTANCE.md](docs/FLEET_WORKFLOW_ACCEPTANCE.md).
- The exact beta product commit passed Settings `33/33`; MCP `402 passed, 18 skipped`; Obsidian `11/11`; root Python `197 passed`; compiler `789 passed, 15 subtests`; Ruff, typecheck, build, bundle clean-diff, strict OpenSpec, Fleet safety `5/5`, and the shipped-install smoke with `124` operations.
- The fresh real handoff used fixture digest `615b5359e836d8224f5b6ebaf92fcdb7c724cfc89e0e7e3d89a92f873bc580a7` and correlation ID `9f8bd015-6a5b-440b-bbe3-7cf33547eaae`. Remote phase ran exactly once; returned-state verification passed all 6 checks.
- The clean exact-SHA 5090 worktree and dependency environment were prepared and confirmed through Orca task `task_8b75633c128f` and terminal `term_a4da43a7-e97e-45f0-84f1-d1b218be3581`; the complete gates then ran against that same worktree. The accepted Work Run retained its fixture-declared External Projections `task_762926afd8e3` and `term_3345405f-64bb-407a-a6a9-7d0cdc8edfe2`.
