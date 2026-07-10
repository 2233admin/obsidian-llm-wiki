---
name: vault-save
description: >
  Save everything worth keeping from the current conversation to the knowledge vault.
  Uses the vault-mind MCP server to create or update notes.
---

# /vault-save

# Requires: vault-mind MCP server

Save conversation knowledge (decisions, insights, research) to your vault.

## Steps

1.  **Read `_CLAUDE.md`** for folder maps and indexing rules.

2.  **Analyze the Conversation**: Identify all vault-worthy items (Decisions, Status changes, Insights, Tasks, Connections).

3.  **Draft Writes**: For each identified item:
    -   Find the target note (new or existing) based on the vault map.
    -   Prepare the Markdown content.

4.  **Execute Writes via MCP**:
    -   Use `vault.exists` to check if the target path exists.
    -   If new: call `vault.create`.
    -   If updating: call `vault.modify` or `vault.append`.
    -   Batch these operations using `vault.batch` if there are many.

5.  **Propagate Changes**:
    -   Update the daily note (use `vault.create` or `vault.append`).
    -   Update any linked index or catalog files (use `vault.modify`).
    -   Update `Log.md` or `log.md`.

6.  **Report**: List exactly what was saved and where.

## Rules

-   **All output in user's language** (from `_CLAUDE.md`).
-   **No Duplicates**: Check for existing notes before creating new ones.
-   **Frontmatter Mandatory**: Every new note must have a title, date, and relevant tags.
-   **Interactivity**: Confirm paths or major overwrites if they seem ambiguous.
-   **Proactive Save**: Suggest saving when a logical work block (like a feature or design) completes.
