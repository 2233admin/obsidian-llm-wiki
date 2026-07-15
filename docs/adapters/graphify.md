# graphify adapter

Wraps the [graphify](https://pypi.org/project/graphifyy/) CLI as an LLM Wiki adapter, adding project-wide knowledge graph capabilities: code, docs, PDFs, images, and video — all extracted and queryable through the same `vault.search` / `vault.graph` / `vault.read` MCP surface.

## Quick start

```bash
uv tool install graphifyy        # install once
graphify extract /path/to/vault  # build the initial graph
```

Then in `vault-mind.yaml`:

```yaml
graphify:
  enabled: true
  vault_path: "/path/to/your/project"   # defaults to top-level vault_path
```

Restart the MCP server. If graphify is not on PATH or `--version` fails, the adapter disables itself and logs a warning -- everything else keeps working.

## Capabilities

| Capability | MCP tool | What it does |
|---|---|---|
| `search` | `vault.search` | Runs `graphify query <term>` and returns the BFS/DFS traversal text as a single ranked result |
| `graph` | `vault.graph` | Reads `graphify-out/graph.json`, collapses symbol-level nodes to unique file-level `GraphNode`s |
| `read` | `vault.read` | Returns all graph symbols belonging to a given source file |

## Config reference

All fields are optional. Unset fields use the defaults shown.

```yaml
graphify:
  enabled: false

  # Path to project root to scan (default: top-level vault_path)
  vault_path: ""

  # Directory containing graphify-out/graph.json (default: <vault_path>/graphify-out)
  output_dir: ""

  # Path/name of graphify binary (default: "graphify")
  binary: "graphify"

  # Run 'graphify update <vault_path>' before returning graph() results.
  # Keeps the graph fresh at the cost of an extra subprocess per call.
  auto_rescan: false

  # Subprocess timeout in milliseconds (default: 30000)
  timeout: 30000
```

## How graph() works

graphify's `graph.json` contains symbol-level nodes (functions, classes, headings, PDF sections, etc.). LLM Wiki's `GraphData` is file-centric. The adapter:

1. Reads `graph.json` from `<output_dir>/graph.json`
2. Collapses all nodes sharing the same `source_file` into one `GraphNode`
3. Resolves edges from node-id pairs to file pairs, drops same-file edges, deduplicates
4. Maps `"contains"` and `"method"` edge relations to `GraphEdge.type = "tag"`; everything else becomes `"link"`

## Edge type mapping

| graphify relation | LLM Wiki type |
|---|---|
| `contains`, `method` | `"tag"` (structural hierarchy) |
| everything else | `"link"` |

## Graceful degradation

- graphify not installed -> adapter marks `isAvailable = false`, logs install hint, returns empty results
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
