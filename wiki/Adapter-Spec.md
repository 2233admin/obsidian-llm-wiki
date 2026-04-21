An adapter is a pluggable backend module that services a subset of MCP operations.
Adapters declare a capabilities set; the registry uses that set to fan out queries
to whichever adapters can handle them and merge the results. The filesystem adapter
is the only required adapter -- all others are optional and degrade gracefully when
absent. This page specifies the adapter contract, documents the four shipped
adapters, and gives a recipe for adding a new one.

## Adapter Contract

Each adapter satisfies the following interface (pseudocode -- not TypeScript):

    interface VaultAdapter {
      name: string                    // unique id, e.g. "filesystem"
      capabilities: Set<Capability>  // operations this adapter handles
      isAvailable(): Promise<bool>   // health-check called at startup
      execute(op: string, params: object): Promise<Result>
    }

    type Capability =
      | "vault.read" | "vault.search" | "vault.graph"
      | "query.unified" | "compile.run"
      | ... // any operation name from the 40-op catalog

Adapters are registered in `vault-mind.yaml` and loaded by
`mcp-server/src/adapters/registry.ts` at startup. The registry calls
`isAvailable()` on each optional adapter; adapters that fail the check are
skipped silently and reported via `query.adapters`.
## Adapters

### filesystem

The filesystem adapter is always-on. It is loaded unconditionally and serves as
the authoritative fallback for all `vault.*` operations. It requires only the
Node.js `fs` module and the ripgrep binary bundled in `mcp-server/`.

Key behaviours:

- **vault.search** -- ripgrep-backed grep across all `.md` files. Returns
  matching lines with line numbers. Does not rank results. For ranked search
  use `query.search` (filesystem-only ranked) or `query.unified` (all adapters).
- **vault.create / vault.modify / vault.append / vault.delete / vault.rename**
  -- all mutating operations default to `dryRun=true`. No write happens unless
  the caller explicitly passes `dryRun: false`.
- **vault.graph** -- builds the wikilink graph by scanning frontmatter and
  `[[wikilink]]` patterns. Produces nodes, edges, orphan flags, and
  unresolvedLinks count. Writes the result to the vault root as JSON.
- **PROTECTED_DIRS** -- `.obsidian`, `.trash`, `.git`, `node_modules` are always
  blocked from writes regardless of `dryRun` flag.

Source: `adapters/` (filesystem logic is embedded in the registry and operations
layer; the separate adapter directories are `adapter-obsidian/`, `adapter-memu/`,
and `adapter-gitnexus/`).
### obsidian

The obsidian adapter bridges to a running Obsidian Desktop instance via
WebSocket. It requires the companion `obsidian-vault-bridge` plugin to be
installed and active in Obsidian (sibling repo, not this one).

**Status note:** The obsidian-vault-bridge plugin is being repositioned from a
general MCP proxy to a more focused role -- absorbing commands that require live
Obsidian plugin API access (graph view data, canvas operations, hotkey triggers).
The boundary between what belongs in the bridge vs. the filesystem adapter is
still being refined. See [[Rationale]] for the drift discussion. Do not build
hard dependencies on specific bridge operation names stabilising before v3.0.0.

When available, this adapter adds:

- Live graph view data not derivable from raw wikilinks
- Obsidian plugin API features (starred notes, canvas, etc.)
- Real-time vault change events via WebSocket subscription

When unavailable (Obsidian not running, plugin not installed, WebSocket timeout),
all operations fall back to the filesystem adapter. No hard error is raised.

Source: `adapters/adapter-obsidian/src/`
### memU

The memU adapter provides semantic similarity search via pgvector. It connects
to a running memU instance (PostgreSQL + pgvector) configured in
`vault-mind.yaml` with a per-host `user_id`.

Disabled by default. Enable by setting `adapters.memu.enabled: true` in
`vault-mind.yaml` and providing connection credentials.

When available, this adapter enhances:

- `query.unified` -- adds semantic similarity scores to the merged result set
- `vault.reindex` -- bulk-ingests vault content into the pgvector store

When unavailable, `query.unified` falls back to filesystem scoring only.
Keyword search via `vault.search` is unaffected.

Source: `adapters/adapter-memu/src/`

### gitnexus

The gitnexus adapter adds code-aware cross-references for vaults that contain
or sit alongside source trees. It connects to a running GitNexus MCP server.

Disabled by default. Useful when vault notes cite code symbols, function names,
or file paths that exist in an indexed repository.

When available, this adapter enhances:

- `query.unified` -- adds code-context edges to search results
- Wikilinks that reference code symbols resolve against the GitNexus index

When unavailable, text search is unaffected. Code-symbol wikilinks remain
as unresolved edges in the concept graph.

Source: `adapters/adapter-gitnexus/src/`
## Capability Matrix

The table below groups operations by category. For the full 40-operation list
see `docs/mcp-tools-reference.md`.

| Operation group | filesystem | obsidian | memU | gitnexus |
|-----------------|------------|----------|------|----------|
| CRUD (create, read, modify, append, delete, rename, mkdir) | required | n/a | n/a | n/a |
| Search (vault.search, vault.searchByTag, vault.searchByFrontmatter) | required | n/a | n/a | n/a |
| Graph (vault.graph, vault.backlinks, vault.lint) | required | optional | n/a | optional |
| Lint / audit (vault.lint, vault.enforceDiscipline) | required | n/a | n/a | n/a |
| Compile (compile.run, compile.status, compile.diff, compile.abort) | required | n/a | n/a | n/a |
| Recipe (recipe.run, recipe.list, recipe.show, recipe.status, recipe.doctor) | required | n/a | n/a | n/a |
| Agent (agent.trigger, agent.schedule, agent.status, agent.history) | required | n/a | n/a | n/a |
| Unified query (query.unified, query.explain) | required | optional | optional | optional |
| Semantic index (vault.reindex) | n/a | n/a | optional | n/a |

**required** -- operation is served by this adapter and cannot fall back.
-  **optional** -- adapter enhances the operation when available; filesystem is the fallback.
**n/a** -- adapter does not participate in this operation group.
## Fan-Out and Ranking

`query.unified` sends the query to all available adapters in parallel and
merges results using per-adapter weight multipliers.

Default weights from `vault-mind.example.yaml` (override per-call via the
`weights` parameter or globally via `adapter_weight_<name>` in the yaml):

| Adapter    | Default weight |
|------------|----------------|
| filesystem |            1.0 |
| vaultbrain |            0.8 |
| memU       |            0.6 |
| obsidian   |        unset (1.0 implicit) |
| gitnexus   |        unset (1.0 implicit) |

The lower weights for semantic adapters encode a deliberate bias: filesystem
results are authoritative (what the user wrote); semantic results are
suggestive (what an embedding thought was similar). Override per use case, do
not edit the defaults.

To up-weight semantic results and down-weight raw grep:

    query.unified { query: "...", weights: { memu: 1.5, filesystem: 0.7 } }

Results from each adapter are scored internally (BM25-style for filesystem,
cosine similarity for memU) and then multiplied by the adapter weight before
merging. Ties are broken by adapter priority: filesystem > obsidian > memU >
gitnexus.

`query.search` is filesystem-only with the same scoring pipeline but no
fan-out. Use it when you want deterministic, reproducible results without
semantic or code-context noise.
## Failure Modes

**Adapter unavailable at startup** -- `isAvailable()` returns false or times out.
The adapter is excluded from the registry. `query.adapters` reports it as
unavailable. All operations fall back to filesystem. No error is surfaced to the
calling agent unless it explicitly checks `query.adapters`.

**Adapter slow during a request** -- each adapter call has an internal timeout
(default 5000ms, configurable in `vault-mind.yaml`). If an adapter exceeds the
timeout, its results are dropped and the remaining adapter results are returned.
A warning is logged to the MCP server stderr.

**Adapter returns conflicting data** -- when two adapters return results for the
same vault path with different content (e.g. filesystem has the saved file,
obsidian has an unsaved buffer), filesystem data wins. This is the
headless-first invariant: the filesystem is the authoritative source of record.
The obsidian adapter can surface live unsaved state, but it never overwrites
filesystem data in the merged result set.
## Adding a New Adapter

1. **Create the directory** -- `adapters/<name>/src/index.ts`. Follow the
   structure of `adapters/adapter-memu/src/` as the reference implementation.
   Export a class that implements the `VaultAdapter` interface from
   `mcp-server/src/adapters/registry.ts`.

2. **Declare capabilities** -- set the `capabilities` property to the exact
   operation names your adapter handles (e.g. `new Set(["query.unified"])`).
   Only declare operations your adapter actually implements.

3. **Register in config** -- add an entry under `adapters:` in
   `vault-mind.yaml` with `enabled: true` and any connection parameters
   your adapter needs (credentials, host, port).

4. **Wire into the registry** -- import your adapter class in
   `mcp-server/src/adapters/registry.ts` and add it to the
   `optionalAdapters` array. The registry calls `isAvailable()` at startup
   and skips it on failure.

5. **Add integration tests** -- create `adapters/<name>/src/__tests__/`.
   At minimum: availability check (mocked), a happy-path execute call, and
   a failure/timeout path. Reference `adapters/adapter-memu/src/__tests__/`
   for the test pattern. Update the README adapter table.

## See also

- [[Architecture]] -- where the adapter registry sits in layer 2.
- [[Home]] -- page map.
- [[Rationale]] -- "Why not just a vector database?" and the bridge drift note.
- [[Compile-Pipeline]] -- what chunks adapters consume from.
- [[Persona-Design]] -- how personas and support skills compose the MCP surface on top of adapters.
- [[Security-Model]] -- dry-run contract that every adapter honours.
- [[Recipes]] -- content collectors that feed the vault adapters read from.
- [[FAQ]] -- common adapter-related questions.
- `adapters/` (repo) -- the four adapter implementations.
- `vault-mind.example.yaml` -- enable flags and weight defaults.
- `docs/mcp-tools-reference.md` -- authoritative 40-operation signatures.
