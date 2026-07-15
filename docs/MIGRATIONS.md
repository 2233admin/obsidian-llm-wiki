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
