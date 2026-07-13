# @obsidian-llm-wiki/settings-platform

MIT-licensed, host-neutral Settings Platform core for LLM Wiki. The package
owns the versioned setting registry, canonical schemas, deterministic snapshot
resolution and explanation, validation, scope stores, optimistic mutation,
atomic persistence, recoverable backups, redaction, migrations planning, and
capability doctor results.

Canonical precedence is:

```text
session > workspace-project > vault > user-device > product default
```

Persistent scope paths are physically separated:

- user-device: OS user configuration, or `LLMWIKI_SETTINGS_USER_PATH`;
- vault: `<vault>/_llmwiki/settings/vault.json`;
- workspace-project: `<vault>/_llmwiki/settings/projects/<project-id>.json`;
- session: process memory only;
- product: the read-only versioned registry in `registry/v1.json`.

No runtime dependency is required. Secret values are never accepted: only
`SecretReference` metadata and `present | missing | unreachable` health cross
the package boundary. Python implements the same contract independently in
`compiler/settings_platform.py` and both runtimes are pinned by the shared JSON
fixtures under `fixtures/`.
