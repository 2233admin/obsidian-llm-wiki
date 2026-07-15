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
