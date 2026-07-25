# Migration and rollback

LLM Wiki keeps host settings, Project identity, work state, and knowledge in separate owning domains. Migration joins those domains through stable identities; it does not merge their roots or treat a local path as canonical identity.

## Legacy Obsidian plugin settings

Older `vault-mind-promote` plugin data may contain `pythonPath`, `kbMetaPath`, or scoped `assignments`. On plugin load, LLM Wiki plans these mappings:

| Legacy value | Settings Platform assignment |
|---|---|
| `pythonPath` | `runtime.python.path` at `user-device` scope |
| `kbMetaPath` | `runtime.kb_meta.path` at `user-device` scope |
| legacy scoped assignments | Same key at the valid corresponding scope |

The plugin reads the destination revisions and exact preimage before writing. The migration behaves as one logical transaction: if a later assignment fails, compensating writes restore assignments already changed. Only after every assignment succeeds does the plugin save stripped plugin data plus an `applied` migration journal.

Normal upgrade procedure:

1. Close other Obsidian windows using the same vault.
2. Back up the plugin's existing `data.json` and the relevant Settings documents.
3. Install or reload the LLM Wiki plugin.
4. Open **Settings → LLM Wiki** and run Doctor.
5. Confirm the runtime values show `user-device` as the winning scope and that plugin data contains no legacy operational fields.

If migration cannot complete, the plugin keeps the legacy data and reports migration pending; it must not save the stripped document. Fix the reported runtime/store problem and reload.

Rollback is revision-guarded. The migration journal records the exact preimage and the revisions written by migration. A host rollback through `rollbackPluginDataMigration` restores that preimage only when those revisions are still current. If another user or host changed the same scope afterward, rollback refuses rather than deleting newer work. The current settings page does not expose a general-purpose rollback button; operators should use the host recovery path or restore the backups with Obsidian stopped and then run Doctor again.

Never copy a user-device Settings document to another machine as a migration shortcut. Bind the second device separately.

## Project layout migration

Every Project uses a stable `project/<slug>` identity. The canonical roots remain separate:

```text
Projects/<slug>.md                 shared Project Registry record
01-Projects/<slug>/                Work-OS and Work Runs
10-Projects/<slug>/                project knowledge
.vault-mind/local-bindings.json    machine-local workspace bindings
```

An older vault may have only `01-Projects/<slug>/_project.md`, legacy aliases, or retired docket work. Use the Project migration operations in this order:

1. `project.migration.inventory` — collect registry, anchor, knowledge, legacy work, binding, lease, and workflow representations without writing.
2. `project.migration.plan` — produce a deterministic hash-guarded plan. Review conflicts and proposed targets.
3. `project.migration.apply` with the default `apply=false` — preview the current plan through the mutating operation boundary.
4. `project.migration.apply apply=true` — apply only after review. Optionally provide a safe `batch_id`.
5. Run `project.context.doctor`, then `project.registry.list` and `project.hub.get` for the migrated Project.

Applied batches record backups and a manifest under:

```text
.vault-mind/project-migrations/<batch>/manifest.json
```

Restore is also preview-first:

1. call `project.migration.restore` with the vault-relative manifest and leave `apply=false`;
2. review hash preconditions and targets;
3. call it again with `apply=true` only when restoration is still intended.

Migration and restore are hash-checked. If source or destination bytes changed after planning, the operation reports a conflict and writes nothing. Re-inventory and review a new plan instead of bypassing the guard.

Retired `10-Projects/<project>/docket/**` inputs may migrate only into authoritative issue notes under `01-Projects/<project>/issues/`. Migration never makes the docket current again.

## Verification after either migration

- `settings.validate` has no unexpected errors.
- `settings.doctor` reports each capability honestly; unavailable is not rewritten as healthy.
- `project.context.doctor` has no unexplained identity drift.
- `project.hub.get` remains read-only and contains no machine-local path or resolved secret.
- Git review shows only the intended shared records; machine-local bindings and capabilities remain outside shared knowledge.

## Agent Wiki additive state migration

Agent Wiki state is versioned and additive. Current readers accept supported legacy/v0 Ingest Run, receipt, and maintenance queue shapes in memory; the next successful mutation writes canonical v1. Contribution manifests use `unknown-provenance` for legacy compiler output until backfill or an operator-reviewed `python compiler/compile.py <topic> --full --force-full-rebuild` establishes source-versioned support. Ordinary compile and maintenance runs fail closed instead of bypassing this gate. Settings migration remains report-first through `settings.migrations.plan`.

Retained state includes:

```text
_llmwiki/ingest-runs/v1/       runs and immutable receipts
_llmwiki/ingest-artifacts/v1/  immutable captures and derivatives
_llmwiki/ingest-active/v1/     active Source digests
_llmwiki/maintenance/          queue state and execution receipts
<topic>/.llmwiki/              contribution manifests and generation pointers
```

Query traces are versioned, redacted diagnostic output and are not a durable authority. If a host persists them externally, apply that host's diagnostic-log retention policy; do not promote them into Memory.

### Rollback switches

1. Inspect `settings.agent_wiki.features`.
2. Set only the compatibility switch needed for the affected surface:
   - `VAULT_MIND_AGENT_WIKI_INGEST=disabled` blocks new run/resume;
   - `VAULT_MIND_COMPILE_TRIGGER_MODE=legacy-threshold` restores the old trigger;
   - `VAULT_MIND_RETRIEVAL_MODE=legacy-rrf` restores pure RRF ordering;
   - `VAULT_MIND_TOOLCHAIN_PROBES=disabled` prevents live provider probes.
3. Restart the MCP process when its environment changes.
4. Verify registration, read-only inspection, filesystem retrieval, and compiler output before removing any state.

Rollback never deletes runs, receipts, manifests, generations, queues, fingerprints, or traces. Retain them until a backup is verified and any required full rebuild has completed. Delete immutable artifacts only under an explicit data-retention decision after proving that no active Source, receipt, or projection references their hashes.

### Upgrade verification

- Run `settings.migrations.plan`, `settings.validate`, and `settings.doctor`.
- Confirm provider profiles show expected version/capabilities without endpoint or secret reflection.
- Run `source.ingest.verify` for representative old and new runs.
- Plan the maintenance queue in report-only mode before draining it.
- Verify the current compiler generation pointer and unaffected projection byte stability.
- Exercise both tiered retrieval and the `legacy-rrf` fallback before removing the rollback window.
