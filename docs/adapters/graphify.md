# graphify adapter

Wraps the [graphify](https://pypi.org/project/graphifyy/) CLI as an optional LLM Wiki Knowledge Adapter, adding project-wide relationship evidence for code, docs, PDFs, images, and video. Graphify data stays isolated from the filesystem `vault.graph` contract and never becomes accepted mind-map structure without a confirmed Visual Edit Plan.

## Quick start

```bash
uv tool install graphifyy        # install once
graphify extract /path/to/vault  # build the initial graph
```

Then in `vault-mind.yaml`:

```yaml
adapters:
  graphify:
    enabled: true
    binary: "graphify"
    output_dir: ""
    auto_rescan: false
    timeout: 30000
```

Restart the MCP server. The same fields can be set through the Settings Platform keys `adapters.graphify.*`; explicit Settings assignments win over environment variables and `vault-mind.yaml`.

If the CLI is unavailable but a valid cached `graph.json` exists, graph/read evidence remains available in read-only degraded mode while search and rescan are disabled. If neither the CLI nor a cached graph is available, the adapter disables itself and the rest of LLM Wiki keeps working.

## Capabilities

| Capability | MCP tool | What it does |
|---|---|---|
| `search` | `query.unified` with `adapters=["graphify"]` | Runs `graphify query <term>` and returns bounded traversal text |
| `graph` | `graph.adapters.query` with `adapters=["graphify"]` | Reads `graph.json` and returns an isolated, provenance-bearing adapter snapshot |
| `read` | Knowledge Adapter read path | Returns graph symbols belonging to a source file |

`vault.graph` remains the filesystem wikilink graph. It is intentionally not merged with Graphify's adapter-owned graph shape.

## Config reference

All fields are optional. Unset fields use the defaults shown.

```yaml
adapters:
  graphify:
    enabled: false

    # Directory containing graph.json (default: <vault_path>/graphify-out)
    output_dir: ""

    # Path/name of graphify binary (default: "graphify")
    binary: "graphify"

    # Run 'graphify update <vault_path>' before graph reads.
    auto_rescan: false

    # Subprocess timeout in milliseconds (default: 30000)
    timeout: 30000
```

Compatibility top-level `graphify.*`, flat `graphify_*`, and `VAULT_MIND_GRAPHIFY_*` environment values are still accepted. Device-local binary/output paths are restricted to `user-device` or `session` Settings scopes and are never returned in graph/search results.

## How graph() works

graphify's `graph.json` contains symbol-level nodes (functions, classes, headings, PDF sections, etc.). LLM Wiki's `GraphData` is file-centric. The adapter:

1. Reads `graph.json` from `<output_dir>/graph.json`
2. Collapses all nodes sharing the same `source_file` into one `GraphNode`
3. Resolves edges from node-id pairs to file pairs and drops same-file edges
4. Maps `"contains"` and `"method"` edge relations to `GraphEdge.type = "tag"`; everything else becomes `"link"`
5. Deduplicates each normalized file edge while aggregating distinct provenance records in `GraphEdge.evidence`

Each evidence record retains:

- `adapter`: `"graphify"`
- `relation`: graphify's original relation, such as `"calls"` or `"semantically_similar_to"`
- `confidence`: normalized to `"extracted"`, `"inferred"`, `"ambiguous"`, or `"unknown"`
- `sourcePath`: graphify's source evidence path

Consumers must treat inferred or ambiguous evidence as a suggestion. It does not
authorize a vault write or visual-map edit until the user accepts the proposed
change.

## Edge type mapping

| graphify relation | LLM Wiki type |
|---|---|
| `contains`, `method` | `"tag"` (structural hierarchy) |
| everything else | `"link"` |

## Graceful degradation

- graphify not installed -> adapter marks `isAvailable = false`, logs install hint, returns empty results
- graphify not installed but cached `graph.json` exists -> graph/read remain available; search/rescan are disabled
- `graph.json` absent (no `graphify extract` run) -> `graph()` and `read()` return empty, `search()` still works if binary is present
- Subprocess timeout or crash -> returns empty, does not propagate the error

## Prerequisites

```
uv tool install graphifyy   # PyPI package name has double-y
graphify extract <path>     # build graph.json once (runs tree-sitter + Leiden clustering)
graphify update <path>      # incremental re-scan (changed files only)
```

The adapter ships no bundled copy of graphify. License: MIT (compatible with LLM Wiki's GPL-3.0 license via subprocess invocation).

## Windows

On Windows, `uv tool install graphifyy` may install a `.cmd` wrapper rather than a native `.exe`. The adapter detects `.cmd`/`.bat` extensions and sets `{ shell: true }` automatically. No manual config needed.
