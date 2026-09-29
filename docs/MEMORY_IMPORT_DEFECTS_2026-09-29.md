# Memory import and retrieval defects (2026-09-29)

This is a dated, bounded defect record for the Source → Ingest → Memory → Retrieval path. It is based on repository `main` at `413350d` and the locally installed LLM Wiki `0.4.0-beta.5`. It does not claim a whole-product audit. Runtime reproductions used synthetic data in temporary vaults; deployment of the repository MCP search build was not confirmed.

This draft records failures for follow-up repair. It does not enable bulk memory import or change production data. Keep the pull request in Draft until fixes and regression checks replace this record.

## Source registration and ingest

| ID | Failure and evidence | Regression check for the repair |
| --- | --- | --- |
| S1 | `source.register` accepts a legacy registry with `sources: []`. `readRegistry` treats an array as an object; assigning a string-keyed source to that array disappears on JSON serialization. The operation can report success while `source.list` loses the source after reload. See `mcp-server/src/source/source.ts` (`readRegistry`, `registerSource`). | Start with `_llmwiki/source-registry.json` containing `{"version":1,"sources":[]}`. Register and reload one synthetic URL. The source must remain queryable, or registration must fail before writing a Source Note. |
| S2 | Re-registering one canonical URL with a new Project or Platform reuses `existing.notePath` while changing the record's Project/Platform. The actual write can fall outside the targets authorized by `sourcePolicyTargetPaths`. See `source.ts` (`registerSource`) and `mcp-server/src/core/write-policy.ts`. | Register a URL globally; register it again for `project/demo` with `platform=github`. Assert that the returned path, stored note, registry fields, write verdict and audit targets agree. Migrate or explicitly reject an incompatible old path. |
| S3 | On Windows, a vault path beginning `.Obsidian/` passes the case-sensitive protected-directory check and resolves to `.obsidian/`. See `source.ts` (`normalizeVaultRelPath`) and `mcp-server/src/vault/store.ts` (`FileVaultStore.normalizePath`). | In a temporary vault containing `.obsidian/private.md`, attempt to register `.Obsidian/private.md` as `vaultPath`. Reject it before reading or registering the file. Cover the other protected top-level directories with case variants. |
| S4 | URL credentials in userinfo or query parameters are stored verbatim in both Source Registry and Source Notes. `source.ts` (`canonicalUrl`, `sourceNoteMarkdown`) keeps those values; `mcp-server/src/source/ingest-run.ts` already has a separate query-redaction path for Evidence Notes. | Register synthetic URLs with `?token=SYNTHETIC_VALUE` and `https://user:SYNTHETIC_PASSWORD@example.com/`. Neither durable Source artifact may contain those values; preserve stable source identity without exposing credentials. |
| S5 | `source.ingest.verify` rechecks immutable artifacts and completed stages, but can return `verified: true` after the materialized Evidence Note is deleted. See `mcp-server/src/source/ingest-run.ts` (`verifyRun`). `docs/INGEST.md` says completion requires an accepted, retrievable Evidence Note. | Complete a synthetic vault-path ingest, delete only its returned Evidence Note, then verify. Report the missing note and fail completion verification. |

## Retrieval and current-truth selection

| ID | Failure and evidence | Regression check for the repair |
| --- | --- | --- |
| R1 | `vault.search` uses ripgrep without a Markdown file filter. It returns `.txt` content although the operation promises vault Markdown search and its fallback walks only `.md`, `.canvas` and `.base`. See `mcp-server/src/connector/fs-transport.ts` (`searchVaultWithRipgrep`, `walkMd`). | Put a unique marker only in `plain.txt` in a temporary vault. `vault.search` must not return it, with or without ripgrep. |
| R2 | When ripgrep is unavailable, `FilesystemAdapter.fallbackSearch` uses recursive grep without the primary path's hidden/ignore rules. A synthetic marker in `.obsidian/private.md` was returned by the fallback but excluded by ripgrep. See `mcp-server/src/adapters/filesystem.ts`. | Run the filesystem/query search with ripgrep present and absent. Both paths must exclude protected and hidden metadata paths, with the same vault boundary. |
| R3 | The compiler intentionally allows an unreviewed pure-knowledge draft to supersede reviewed current truth by newer `last-verified` or `supersedes`, which conflicts with `docs/MEMORY_GOVERNANCE.md`'s draft boundary. Draft research claims can also enter the current-state projection. See `compiler/kb_meta.py` (`_pass1_supersession`) and project-memory projection code. | Replay a reviewed claim and a newer draft for the same entity, once by timestamp and once by `supersedes`. Current truth must remain reviewed until explicit promotion. |

## Research-record enablement (not yet exposed on `main`)

`memory.research.record.save` is defined in project-memory operations but is not registered in the `main` runtime. The following defects are present in the beta.5 compiled helper path and must be fixed before exposing it.

| ID | Failure and evidence | Regression check for the repair |
| --- | --- | --- |
| M1 | The save operation is defined but absent from the public operation registry, so callers cannot use it through the MCP runtime. See `mcp-server/src/core/project-memory-operations.ts` and runtime composition in `mcp-server/src/index.ts`. | Verify `tools/list` includes the operation when enabled, or document the helper as unavailable. |
| M2 | The save write policy authorizes `<agent>/memory/research/records/**`, but the handler writes `<agent>/research/records/<id>.json`. This permits a narrow memory-only allowlist to approve a write outside it and records a misleading audit target. See `project-memory-operations.ts` (`memory.research.record.save`, `saveResearchRecord`) and `mcp-server/src/core/write-policy.ts` (`memoryPolicyBasePath`). | With collaboration enforcement allowing only `<agent>/memory/**`, attempt the save. The actual path must be inside the approved target or the operation must be denied before writing. |
| M3 | Store-backed saves write through `VaultStore`, while previous-revision lookup and context projection read only the physical filesystem. A memory-only store reproduced two saves at revision 1 and an empty current-state projection. See `project-memory-operations.ts` (`saveResearchRecord`, `createDurableProjectMemorySource`, `readJson`, `listJsonRecords`). | Save the same research record twice through a memory-only store, then compile context. Revision/idempotency and projected state must reflect the stored record. |

## Gate before importing conversation memory

Repair and run the checks above against the same build used by the Obsidian plugin and MCP host. Then run a small synthetic, draft-only import through registration, ingest, retrieval and promotion preview. Confirm that a rejected or deleted Evidence Note, a protected path, a secret URL, and an unreviewed claim cannot appear as verified current truth. Only after that gate should the independently verified memory documents and separately reviewed session sources be considered for bulk import.
