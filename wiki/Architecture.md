This page describes the internal architecture of obsidian-llm-wiki (v2.0.0): a
headless-first MCP server that compiles a plain-markdown vault into a queryable
concept graph and exposes it through 40 typed operations across 5 namespaces.
Obsidian is optional; the filesystem adapter is always available, so the server
runs in any CI or terminal environment without a desktop app.

> **Note:** A Mermaid layer diagram is deferred. The ASCII diagram below is the
> canonical reference until Mermaid rendering is confirmed on GitHub Wiki.

## Four-Layer Architecture

    +---------------------------------------------------------------+
    | L4  Agent Scheduler                                           |
    |     cron-driven actions: compile / emerge / reconcile /       |
    |     prune / challenge                                         |
    |     agent.trigger  agent.schedule  agent.status               |
    +---------------------------------------------------------------+
    | L3  Compiler Pipeline                                         |
    |     link discovery -> concept graph build ->                  |
    |     surplus evaluation (relationships + contradictions)       |
    |     compile.run  compile.status  compile.diff  compile.abort  |
    +---------------------------------------------------------------+
    | L2  Adapter Registry                                          |
    |     filesystem  (always-on, authoritative)                    |
    |     obsidian    (optional, WebSocket bridge)                  |
    |     memU        (optional, pgvector semantic similarity)      |
    |     gitnexus    (optional, code-aware graph)                  |
    |     query.adapters reports live availability                  |
    +---------------------------------------------------------------+
    | L1  MCP Server                                                |
    |     stdio transport, @modelcontextprotocol/sdk                |
    |     40 operations dispatched by namespace prefix              |
    |     entry: mcp-server/src/index.ts                            |
    +---------------------------------------------------------------+
Requests enter at L1, pass through namespace dispatch, fan out to one or more
L2 adapters, and return merged results. The compiler (L3) and scheduler (L4)
run as background processes and write back to the vault through the same
filesystem adapter that serves live queries.

## Namespace Overview

| Namespace   | Ops | Purpose                                                         |
|-------------|-----|-----------------------------------------------------------------|
| vault.*     |  23 | Full CRUD, search, graph, lint, metadata, AI-output sediment    |
| query.*     |   4 | Cross-adapter ranked search and concept explanation             |
| compile.*   |   4 | Trigger, abort, diff, and status for the compiler pipeline      |
| recipe.*    |   5 | Ingest recipes (collectors that pull external content to vault) |
| agent.*     |   4 | Schedule, trigger, and inspect background agent actions         |

Operation counts are authoritative as of v2.0.0. Run
`npm run generate-tools-doc` to regenerate `docs/mcp-tools-reference.md` if you add operations.
## Request Lifecycle

The following trace covers a `/vault-librarian what do I know about X` call:

1. The agent host (Claude Code, Codex, etc.) reads the skill block from
   `CLAUDE.md` and resolves `/vault-librarian` to a system prompt that
   instructs the model to prefer `vault.search`, `vault.read`, and `vault.backlinks`.

2. The model emits a tool call for `vault.search` with query=X. The MCP
   client sends this over stdio to the server process.

3. `mcp-server/src/index.ts` receives the JSON-RPC request and routes it to
   the operation handler registered for `vault.search` in
   `mcp-server/src/core/operations.ts`.
4. The `vault.search` handler delegates to the filesystem adapter via the
   adapter registry. The filesystem adapter runs a ripgrep-backed scan across
   `.md` files and returns matching lines with line numbers.

5. For a `query.unified` call (cross-adapter search), the registry fans the
   query out to all available adapters in parallel, applies per-adapter weight
   multipliers, and merges the ranked result sets before returning.

6. The operation handler serialises the result as a JSON-RPC response and
   writes it to stdout. The MCP client in the agent host receives it.

7. The model receives the tool result, selects the most relevant excerpts, and
   constructs a response with wikilink-style citations such as
   `[[retrieval-augmented-generation]]`.

8. If the persona prompt also calls `vault.backlinks`, that result merges into
   the same response turn -- the agent decides whether to issue follow-up
   tool calls before composing its final answer.
## Data Model

The compiler (`compile.run`) produces an on-disk concept graph written to the
vault root (path configurable via `vault-mind.yaml`):

- **nodes** -- one entry per `.md` file. Fields: `path`, `title`, `tags`,
  `aliases`, `exists` (bool -- false for wikilink targets with no backing file).
- **edges** -- directed wikilinks. Fields: `from`, `to`, `count`,
  `resolved` (bool). Unresolved edges point to `exists=false` nodes.
- **orphan flag** -- set on nodes with no inbound resolved edges. Surfaced by
  `vault.lint` and `vault.graph`.
- **unresolvedLinks count** -- summary metric returned by `vault.graph` for
  quick vault health checks.

No database, no embeddings at this layer. The graph is plain JSON regenerated
on each `compile.run`. The filesystem adapter reads the cached artifact for
`vault.graph` calls between compile runs.
## Headless-First Invariant

The filesystem adapter is the unconditional fallback. It uses only Node.js
`fs` APIs and the ripgrep binary bundled in `mcp-server/` -- no external
services, no running Obsidian, no database.

| Adapter absent | Effect                                                            |
|----------------|-------------------------------------------------------------------|
| obsidian       | No live Obsidian plugin features (graph view data, plugin API).   |
|                | All vault CRUD and vault.search still work via filesystem.        |
| memU           | No semantic similarity ranking. query.unified falls back to       |
|                | filesystem scoring only. Keyword search is unaffected.            |
| gitnexus       | No code-aware cross-references. Text search is unaffected.        |

Nothing hard-crashes when optional adapters are offline. `query.adapters`
returns current availability so agents can adjust strategy at runtime.
## Extension Points

**New adapter** -- create `adapters/<name>/src/index.ts`, implement the
`VaultAdapter` interface (see `mcp-server/src/adapters/registry.ts`), declare
a `capabilities` set, and register the adapter in `vault-mind.yaml` under
`adapters:`. Integration tests go in `adapters/<name>/src/__tests__/`. See
[[Adapter-Spec]] for the full contract.

**New operation or namespace** -- add an entry to the `operations` array in
`mcp-server/src/core/operations.ts`. The MCP tool schema is derived from that
array at startup; no separate JSON schema file needs editing. Regenerate
`docs/mcp-tools-reference.md` with `npm run generate-tools-doc`.

**New compile stage** -- pipeline stages live in `compiler/`. Add a stage
module and import it in `compiler/index.ts`. Each stage receives the current
graph and returns a mutated copy; vault writes go through the filesystem
adapter, not raw `fs` calls.

**New recipe (ingest collector)** -- add a YAML frontmatter + script file to
`recipes/`. The `recipe.*` namespace auto-discovers recipes via
`mcp-server/src/recipes/_registry.ts` at startup.
## Non-Goals

These are explicit out-of-scope items. See the [README](../README.md)
honest-limits section for the user-facing version.

- **Not a vector database.** Semantic similarity is delegated to the optional
  memU adapter. The core system does not embed or index vectors.
- **Not bidirectional real-time sync with Obsidian.** The WebSocket adapter
  requires Obsidian Desktop to be running and propagates changes on demand
  only, not continuously.
- **Not a code-understanding tool.** The server indexes text, wikilinks, and
  frontmatter structure. Source code analysis is the gitnexus adapter domain,
  and only for vaults that intentionally include source trees.
- **Not a hosted service.** The server runs locally via stdio; no cloud sync,
  no account, no telemetry.

## See also

- [[Home]] -- page map.
- [[Rationale]] -- axioms the four layers cash out.
- [[FAQ]] -- common architecture-shaped questions.
- [[Adapter-Spec]] -- deep dive on L2.
- [[Compile-Pipeline]] -- deep dive on L3.
- [[Persona-Design]] -- how skills compose the MCP surface.
- [[Security-Model]] -- preflight gates in the request lifecycle.
- [[Recipes]] -- content collectors that land raw markdown into the vault.
- `docs/mcp-tools-reference.md` -- authoritative 40-operation catalogue.
- `mcp-server/src/core/operations.ts` -- namespace dispatch and handlers.
