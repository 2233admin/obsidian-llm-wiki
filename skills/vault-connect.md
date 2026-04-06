---
name: vault-connect
description: >
  Bridge unrelated vault domains. Find structural analogues between different areas.
  Uses the vault-mind MCP server to identify and create connections.
---

# /vault-connect [topic A] [topic B]

# Requires: vault-mind MCP server

Find hidden connections between seemingly unrelated vault domains and bridge them.

## Modes

-   **Two topics given**: Find structural bridges between A and B.
-   **One topic given**: Find surprising connections TO this topic from other domains.
-   **No topic given**: Scan recent activity and find high-value cross-domain bridges.

## Steps

1.  **Read `_CLAUDE.md`** at vault root for folder map.

2.  **Map the Domains**:
    -   Use `query.unified` to search for all mentions of topics A and B.
    -   Use `query.explain` to extract the concept graph for each topic.
    -   Identify the domain clusters (folders, tags, links) for each.

3.  **Find Bridges**:
    -   **Structural Bridge**: Same abstract shape in different domains.
    -   **Causal Bridge**: Does one domain's output feed another?
    -   **Temporal Bridge**: Notes created or modified in the same window (check `mtime` with `vault.stat`).
    -   Use `vault.search` to find shared keywords or patterns.

4.  **Present Findings**:
    -   **Connections Found**: Ranked by surprise and utility.
    -   **Bridge**: What they share structurally.
    -   **Implication**: What you can DO with this connection.

5.  **Execute Linking**:
    -   Use `vault.append` or `vault.modify` to add wikilinks to both the source and target notes.
    -   Update any index files or create a synthesis note using `vault.create`.

6.  **Log Results**: Update `Log.md` using `vault.append`.

## Rules

-   **Output Language**: Use user's language (from `_CLAUDE.md`).
-   **Surprise Metric**: Prioritize structural analogies over surface similarity.
-   **Cite Sources**: Always include specific note paths.
-   **Propose Actions**: Ensure every connection has an implication.
-   **Bidirectional Linking**: Always link back if the connection is strong.
