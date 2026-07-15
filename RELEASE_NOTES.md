# LLM Wiki v2.8.0-beta.1

This release candidate turns Settings, Project Context, governed Agent Rooms,
Dream Time, Work Runs, external projections, and multi-device execution into
one LLM Wiki backend. Obsidian is the primary visual control plane, while MCP,
CLI, and Python remain usable headlessly.

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

## Governed Agents and Dream Time

- Agent Profiles, Project Bindings, Threads, Rooms, Context Envelopes, consult,
  delegation, child Work Runs, and Artifact Projections share canonical Project
  identities instead of creating another project or memory ledger.
- Dream Time creates immutable checkpoint, learn, and review proposals and
  requires fingerprinted human approval before a Memory Revision changes.
- Daily, Monday-based weekly, and monthly UTC cadences are disabled by default
  and run only through an explicit host call; no scheduler or daemon is added.

## Knowledge adapters and external project trackers

- memU, LightRAG, RAG-Anything, Hindsight, Kanban, and QMD use one redacted
  Settings-derived runtime profile. Secrets resolve only on the executing
  device at the final adapter construction boundary.
- Hindsight contributes read-only recall evidence only. LLM Wiki retains
  authority over Project Context, Memory review, Sources, and Promotion.
- GitHub, Gitea, Linear, and Plane are Project Tracker projections configured
  independently from Host Capability Connectors. Plane uses the current
  work-items endpoint and explicit workspace-specific state UUID mappings.

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

- Local candidate gates cover shared domains, MCP, compiler, plugin, release
  security, isolated installation, upgrade/rollback/reinstall, strict OpenSpec,
  and the deterministic Agent-aware two-vault Fleet harness.
- The tag workflow additionally requires
  `docs/release-evidence/v2.8.0-beta.1.json` to prove a fresh exact-SHA real 5090
  delegated Child Work Run. The evidence verifier rejects forged checks,
  identity drift, noncanonical fixtures, or product changes after the tested
  commit.
- Real memU PostgreSQL and configured third-party network providers remain
  opt-in environment tests; the Beta does not claim them when their credentials
  or services are absent.
