---
name: vault-world
description: >
  Load vault context progressively -- identity, navigation, and current state.
  Uses the vault-mind MCP server to query unified knowledge.
---

# /vault-world

# Requires: vault-mind MCP server

Load relevant knowledge and current state from your vault to build a starting context.

## Steps

1.  **L0 -- Navigation (1-2K tokens)**:
    -   **Unified Query**: Call `query.unified` with `query: "recent activity, dashboard, and core rules"` to identify the primary context.
    -   **Read Config**: Read `_CLAUDE.md` to establish the operating environment.

2.  **L1 -- Current State (2-5K tokens)**:
    -   **Home/Dashboard**: Use `vault.read` on the main entry points (e.g., `_index.md`, `dashboard.md`).
    -   **Recent Memory**: Read today's daily note and the most recent `Log.md` entries.
    -   **Current Tasks**: Search for active tasks across the vault using `vault.search`.

3.  **L2 -- Domain Deep Dive (On Demand)**:
    -   When a specific topic emerges, use `query.explain` to load related concept graphs.

4.  **Present Status**:
    -   **Current Priorities**: Top 3 active threads.
    -   **Momentum**: Summary of last session's outcome.
    -   **System Status**: Note if any vault-health issues need immediate attention.

## Rules

-   **Output Language**: Use the user's language (defined in `_CLAUDE.md`).
-   **Conciseness**: Avoid loading long files entirely unless necessary.
-   **Don't Re-Invent**: If `query.unified` gives high-confidence results, use those first before manual searching.
-   **Triggering**: Run this at the start of a session or when context feels lost.
