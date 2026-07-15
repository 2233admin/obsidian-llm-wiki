# Settings and the Obsidian control plane

LLM Wiki has one Settings Platform shared by MCP, the Python compiler/CLI, and the Obsidian desktop plugin. A host may present or edit settings, but it does not become the settings source of truth.

## Resolution model

Effective values resolve deterministically:

```text
session > workspace-project > vault > user-device > product default
```

| Scope | Intended use | Persistence |
|---|---|---|
| `product` | Versioned defaults distributed with LLM Wiki | Read-only registry |
| `user-device` | Machine-local runtime and tool bindings | OS user configuration, or `LLMWIKI_SETTINGS_USER_PATH` |
| `vault` | Settings shared by users of one vault | `_llmwiki/settings/vault.json` |
| `workspace-project` | Overrides for one canonical `project/<slug>` | `_llmwiki/settings/projects/<project-id>.json` |
| `session` | Temporary per-process overrides | Memory only |

Every mutation uses an expected revision. A stale writer receives a conflict instead of overwriting a newer assignment. `settings.snapshot.explain` shows the winning scope, overridden candidates, provenance, validation, and apply mode.

## Runtime discovery

The MCP bundle discovers the compiler in this order:

1. `LLMWIKI_COMPILER_PATH`;
2. compatibility alias `VAULT_MIND_COMPILER_PATH`;
3. the compiler directory adjacent to the installed runtime.

The value is a compiler **directory** containing `kb_meta.py`, not the script path itself. Python executable discovery keeps the existing `VAULT_MIND_PYTHON`, then `PYTHON`, then `python` fallback. New automation should prefer `LLMWIKI_COMPILER_PATH`; the older variable remains accepted for compatibility.

Example MCP environment:

```json
{
  "VAULT_PATH": "/path/to/vault",
  "LLMWIKI_COMPILER_PATH": "/path/to/obsidian-llm-wiki/compiler",
  "VAULT_MIND_PYTHON": "python"
}
```

Do not commit a machine-specific compiler or vault path into shared Project records. Runtime paths belong in the user-device scope or process environment.

`VAULT_MIND_VAULT_PATH` and `VAULT_BRIDGE_VAULT` are **bootstrap-only vault locators**. The MCP process may use them to find the vault and therefore the scoped Settings documents, but they are not a second settings authority and must not be used for adapter, provider, model, or credential configuration. Once bootstrapped, the resolved `vault.path` and the immutable Settings snapshot describe the running context.

## Obsidian control plane

The desktop-only Obsidian plugin uses an in-process client over the same Settings Platform contracts. Open **Obsidian → Settings → LLM Wiki** to inspect:

- effective value and winning scope;
- validation and apply mode;
- inherited versus explicitly assigned values;
- capability Doctor state and remediation;
- advanced fields, including provider Secret References.

The first UI slice edits `user-device` and `vault`. Workspace-project and session remain valid resolution scopes but require a bound project/session context.

## Agent model connection

The **Agent model** section binds the default model connection used by Agent/Compiler invocation:

| Setting | Purpose |
|---|---|
| `models.agent.mode` | `inherit` keeps legacy env/YAML behavior; `local` and `cloud` opt into Settings-owned invocation. |
| `models.agent.provider` | Provider identity such as `ollama`, `openai-compatible`, `qwen`, or `minimax`. |
| `models.agent.base_url` | OpenAI-compatible API base URL. |
| `models.agent.model` | Model identifier sent to the endpoint. |
| `models.agent.secret_ref` | Device-local credential reference used only in cloud mode. |

Agent model connection values intentionally support `user-device`, `vault`, and `session` scope. They are not project-scoped until Agent/Compiler invocations carry an explicit Project Context end to end. URLs containing `user:password@host` are rejected; credentials must use `models.agent.secret_ref`.

Local mode removes inherited cloud credentials before launching the child process. Cloud mode resolves the Secret Reference only at the MCP host's child-process boundary. The credential value is never returned by `settings.*`, written into plugin data, or synchronized through the vault.

For a local Ollama-compatible server, select `local`, set the base URL (for example `http://127.0.0.1:11434/v1`), and choose the installed model identifier. No API key is required. For a cloud endpoint, select `cloud`, configure its base URL/model, place the real key in a device-local secret provider such as an environment variable, and bind only its locator in Obsidian.

## Dream Time cadence

Dream Time cadence is opt-in and Project-scoped. These public, `next-operation`
Settings default to `false` and may be assigned at vault, workspace-project, or
session scope:

| Setting | Explicit operation |
|---|---|
| `agents.dream_time.cadence.daily.enabled` | One `checkpoint` proposal per UTC day. |
| `agents.dream_time.cadence.weekly.enabled` | One `learn` proposal per Monday-based UTC week. |
| `agents.dream_time.cadence.monthly.enabled` | One `review` proposal per UTC month. |

Enabling a key does not start a timer, daemon, or background process. A host
calls `dreamtime.cadence.status` to inspect a deterministic window and invokes
`dreamtime.cadence.run` explicitly. The run creates a canonical Work Run,
Context Envelope, append-only Usage facts, and an immutable proposal pending
manual approval; it cannot write an approved Memory Revision directly.

## Knowledge adapters

MCP retrieval adapters use one Settings-derived startup profile. `adapters.enabled` selects the registry members; LightRAG, RAG-Anything, Hindsight, Kanban, and QMD read their endpoint, path, collection, executable, timeout, and Secret Reference metadata from namespaced `adapters.*` settings. These settings are `restart-required` because the registry is assembled at MCP startup.

| Adapter | Settings |
|---|---|
| MemU | `adapters.memu.dsn`, `user_id`, query/subprocess settings, embedding model, and optional `secret_ref` |
| LightRAG | `adapters.lightrag.base_url`, `mode`, API paths, and `secret_ref` |
| RAG-Anything | `adapters.raganything.base_url`, query/process paths, and `secret_ref` |
| Hindsight | `adapters.hindsight.base_url`, `bank_id`, `timeout_ms`, and optional `secret_ref` |
| Kanban | `adapters.kanban.glob` |
| QMD | `adapters.qmd.collection` and device-local `binary` |

The runtime profile is redacted: it contains only effective values, Secret Reference metadata/status, snapshot identity, validation issues, and field provenance. The environment-backed secret value is resolved only in the final device-local call immediately before constructing an HTTP adapter. `settings.snapshot.resolve`, `settings.snapshot.explain`, `settings.doctor`, logs, and Project Hub never receive that value.

Existing variables such as `VAULT_MIND_ADAPTERS`, `MEMU_*`, `LIGHTRAG_*`, `RAGANYTHING_*`, `HINDSIGHT_*`, `VAULT_MIND_KANBAN_GLOB`, and `VAULT_MIND_QMD_COLLECTION` remain legacy compatibility inputs only while the corresponding Settings key still wins at product scope. The profile marks them `legacy-env` (or `legacy-config` for the historical YAML adapter list). An explicit Settings value always wins. An explicit disabled adapter, invalid endpoint/list/timeout, or unresolved explicit Secret Reference fails closed and never falls back to an older token or endpoint.

`adapters.memu.dsn` must be a credential-free PostgreSQL URL with no userinfo, query parameters, or fragment; connection options such as passwords, passfiles, and TLS key paths belong only in the private DSN. If the operational DSN contains credentials or connection options, store the complete private DSN in a device-local secret provider and assign only `adapters.memu.secret_ref`. Legacy `MEMU_DSN` values are redacted to a public endpoint in the profile and resolved as a Secret Reference at the final MemU construction boundary; an unsafe query/fragment fails closed instead of being copied into the profile. The private DSN must target the same host, port, and database as the public setting; a mismatch fails closed. Doctor never opens PostgreSQL or launches MemU subprocesses.

The vault-to-MemU write/sync command uses that same profile for adapter enablement, public endpoint, user ID, graph Python/CWD/timeout, and embedding model. Explicit Settings remain authoritative; `MEMU_*`, `OLLAMA_EMBED_MODEL`, and CLI compatibility flags are considered only while the corresponding key remains at product scope. `--dsn` accepts a public credential-free endpoint only and rejects userinfo, query, or fragment input without echoing it. A private DSN is resolved separately for each final database or graph subprocess call, passed to `memu_graph` only through its device-local environment, and never placed in an operating-system argument vector, log message, result payload, snapshot, or Doctor output. The read-only graph-recall and `memu_search.py` fallback paths follow the same child-environment rule; their argv contains only non-secret operation, query, vector, and limit inputs, and output containing the resolved DSN is rejected instead of being returned.

Hindsight is integrated only as a provider-neutral, read-only `search` adapter over `POST /v1/default/banks/{bank_id}/memories/recall`. LLM Wiki does not call Hindsight retain/reflect operations, copy its implementation, or treat an external bank as governed Agent Memory or durable knowledge. Recall results remain external retrieval evidence subject to the existing Source, Memory, and Promotion boundaries. The clean-room evidence is registered as Source `src_ef1d62b18b98` at inspected upstream commit `5ab6bdc9b63b76ba644124bf65a0fb18c72db7d9` (MIT).

## Project Tracker projections

GitHub, Gitea, Linear, and Plane are External Projections of the canonical local Project and Work Items. They use an independent Settings profile in MCP, the Python work-OS sync path, and the Obsidian production control plane; they are not Host Capability Connectors.

| Setting | Purpose |
|---|---|
| `providers.project_tracker.enabled` | Enables the selected tracker projection for the effective scope. |
| `providers.project_tracker.provider` | Selects `github`, `gitea`, `linear`, or `plane`. |
| `providers.project_tracker.transport` | Selects governed `http` or `oauth` transport. |
| `providers.project_tracker.endpoint` | Supplies the public Cloud or self-hosted base URL. Credential-bearing URLs are rejected. |
| `providers.project_tracker.secret_ref` | Selects the device-local credential reference; no resolved credential is persisted. |
| `providers.project_tracker.timeout_ms` | Bounds the complete next pull or apply operation. |

An explicit Project Tracker assignment always wins. Existing `.vault-mind/forge.json` bindings and provider environment variables (`GITHUB_TOKEN`, `GITEA_TOKEN`, `LINEAR_TOKEN`, or `PLANE_API_KEY`) remain compatibility inputs only while the entire Project Tracker profile is unconfigured. Compatibility provenance is marked `legacy-forge-json`/`legacy-env`. Legacy explicit endpoints still pass the same HTTPS-or-loopback-HTTP validation as Settings endpoints, and every legacy pull/apply receives a 10-second end-to-end deadline. Once Project Tracker Settings is explicit, disabled, invalid, missing its Secret Reference, or uses an unsafe endpoint, sync fails closed instead of falling back to a legacy token. Credentials are provider-bound and are resolved only at the final network boundary; dry-run plans, snapshots, Doctor output, and logs remain redacted.

Plane uses its current REST contract: `X-API-Key` authentication and `/api/v1/workspaces/{workspace_slug}/projects/{project_id}/work-items/` on `https://api.plane.so` or a configured self-hosted base URL. The binding must provide `workspace_slug` and `project_id`. Optional `state_type_ids` values are workspace-specific Plane state UUIDs keyed by `backlog`, `unstarted`, `started`, `completed`, or `canceled`; LLM Wiki never guesses them. A missing mapping omits `state` from the mutation and marks the plan `needs-mapping`. See the registered clean-room evidence at `00-Inbox/Sources/plane/plane-rest-api-official-documentation-0387cb926d12.md`.

## Host Capability connectors

Host Capability Settings remain a separate profile for governed discovery and execution of capability descriptors:

| Setting | Purpose |
|---|---|
| `providers.host_capability.enabled` | Enables the selected executable connector for the effective scope. |
| `providers.host_capability.provider` | Selects a reviewed Host connector by canonical `connector/...` identity or by a generic identifier normalized into that namespace. The historical key name is retained for Settings compatibility; it is not a Project Tracker provider selector. |
| `providers.host_capability.transport` | Selects governed `stdio`, `http`, or compatible host transport. |
| `providers.host_capability.endpoint` | Supplies the public endpoint or transport target. Credential-bearing URLs are rejected. |
| `providers.host_capability.secret_ref` | Selects the device-local credential reference; no resolved credential is persisted. |
| `providers.host_capability.timeout_ms` | Bounds the next lazy connector operation. |

Project Tracker endpoints, `.vault-mind/forge.json` bindings, and provider credentials such as `GITHUB_TOKEN`, `GITEA_TOKEN`, `LINEAR_TOKEN`, or `PLANE_API_KEY` must not be copied or inherited into this profile. Tracker push authority comes from reviewed Project state plus the projection safety gates, never from a Host Capability grant. The only environment compatibility path for Host execution is the explicit generic `LLMWIKI_HOST_CAPABILITY_CONNECTOR_ID`, `LLMWIKI_HOST_CAPABILITY_TRANSPORT`, `LLMWIKI_HOST_CAPABILITY_ENDPOINT`, and optional `LLMWIKI_HOST_CAPABILITY_KEY` set.

Connector registration stores reviewed identity, health, and provenance, while Settings supplies the selected connector identity, endpoint, timeout, enabled state, and Secret Reference at each lazy connection. A bare selector such as `reviewed-expert` normalizes to `connector/reviewed-expert`; an already canonical selector remains unchanged. Selection never creates or approves a connector: registration requires an authenticated human/approver/admin and the backend replaces client-supplied review actors and timestamps before storing it. The Obsidian client may submit only an empty connector configuration object. Project-gated `host.*` operations accept `bindingId` and `grantId`; the backend reloads the current Binding, Profile, Child Work Run, and Capability Grant and rejects stale, expired, cross-Project, or out-of-scope authority before opening a transport.

Obsidian plugin data is intentionally limited to:

- presentation preferences such as the selected scope and advanced-field visibility;
- a machine-local device binding reference;
- the legacy migration journal needed for recovery.

It must not retain operational assignments, resolved secrets, absolute paths copied from another device, or an independent configuration model. The plugin ID remains `vault-mind-promote` for installation compatibility; the human-facing product name is **LLM Wiki**.

To install a built plugin manually, copy `manifest.json`, `main.js`, and `styles.css` from `obsidian-plugin/` into:

```text
<vault>/.obsidian/plugins/vault-mind-promote/
```

Restart or reload Obsidian after replacing the files. The plugin requires the desktop app because governed promotion and runtime checks use Node child processes.

## Secret Reference

A Secret Reference is metadata describing where a credential can be resolved. It is not the credential itself:

```json
{
  "provider": "environment",
  "locator": "TAVILY_API_KEY"
}
```

Snapshots and Doctor may report the reference plus `present`, `missing`, or `unreachable`. They never return the resolved value. Do not paste a credential into a normal string field, migration note, Project Hub, workflow evidence, or plugin data.

The registry includes environment references for web search and the Agent cloud model. OS keychain and external-vault providers are part of the contract, but availability depends on the host connector. The current built-in child-process resolver supports environment references; Doctor reports other providers as unreachable until a host connector is installed.

## Settings operations

| Operation | Purpose |
|---|---|
| `settings.definitions.list` / `settings.definitions.get` | Inspect the canonical registry and presentation metadata. |
| `settings.scopes.get` | Read one redacted scoped document and its revision. |
| `settings.snapshot.resolve` | Resolve an immutable effective snapshot for a runtime context. |
| `settings.snapshot.explain` | Explain one setting's precedence and provenance. |
| `settings.assignment.set` / `settings.assignment.unset` | Mutate one assignment with expected-revision protection. |
| `settings.validate` | Validate definitions, documents, effective values, and dependencies. |
| `settings.migrations.plan` | Plan Settings document schema changes without writing. |
| `settings.doctor` | Return evidence-backed `available`, `degraded`, `unavailable`, or `disabled` capability health. |

Use `settings.scopes.get` immediately before a mutation and pass its revision as `expectedRevision`. After a conflict, refresh the scope and re-evaluate the intended change; do not retry with a guessed revision.

Legacy Obsidian settings migration and rollback are documented in [MIGRATIONS.md](MIGRATIONS.md). The complete schema-level operation list is in [mcp-tools-reference.md](mcp-tools-reference.md).
