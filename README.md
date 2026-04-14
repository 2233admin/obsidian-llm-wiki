# obsidian-llm-wiki: Knowledge OS for your Obsidian Vault

A high-performance Knowledge Operating System that turns your flat Markdown files into a structured, queryable, and active knowledge graph using MCP, LLMs, and a unified adapter layer.

## Quick Start (3 Steps)

1.  **Clone the Repo**:
    ```bash
    git clone https://github.com/2233admin/obsidian-llm-wiki.git
    cd obsidian-llm-wiki
    ```
2.  **Run Setup**:
    ```bash
    bash setup.sh
    ```
3.  **Restart Claude Code**:
    Your new skills and MCP tools are now ready. Type `/vault-world` to begin.

## Core Capabilities

-   **Unified Query**: Search across filesystem, MemU (PostgreSQL), and GitNexus simultaneously.
-   **Knowledge Compilation**: Automatically chunk, embed, and cross-link raw notes into concepts.
-   **Skill-Driven Workflows**:
    -   `/vault-health`: Audit your vault for orphans, broken links, and staleness.
    -   `/vault-reconcile`: Resolve knowledge conflicts and contradictions.
    -   `/vault-save`: Intelligently save conversation context to the right folders.
    -   `/vault-challenge`: Let the vault argue back using your own recorded history.

## Architecture

```text
[ Agent Layer ] <--> [ Claude Code Skills ]
       |
[ MCP Server  ] <--> [ Unified Query Layer ]
       |                      |
[ Adapters    ] <--> [ Filesystem | MemU | GitNexus ]
       |
[ Compiler    ] <--> [ Chunking | LLM Embedding | Link Discovery ]
```

## Comparison

| Feature | obsidian-llm-wiki | Obsidian Second Brain | Local REST API |
| :--- | :--- | :--- | :--- |
| **Agentic** | Native (Claude Code) | Partial | No |
| **Multi-Source** | Yes (DB, Git, FS) | No (FS only) | No (FS only) |
| **Active Conflict** | Yes (Reconcile) | No | No |
| **Self-Healing** | Yes (Lint/Health) | No | No |
| **Performance** | High (Compiled) | Medium (Index) | Low (Request-based) |

## Configuration

Edit `vault-mind.yaml` to enable/disable adapters and adjust weights.

## License
GPL-3.0
