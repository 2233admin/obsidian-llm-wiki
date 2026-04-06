---
name: vault-emerge
description: >
  Surface unnamed patterns from recent vault activity.
  Uses the vault-mind MCP server to analyze and structure data.
---

# /vault-emerge [days=30]

# Requires: vault-mind MCP server

Find patterns hiding in your vault that you haven't named yet.

## Steps

1.  **Read `_CLAUDE.md`** at vault root for folder map.

2.  **Collect Raw Material**:
    -   Use `vault.list` on major folders.
    -   Use `vault.searchByFrontmatter` to find notes modified in the last N days (check `mtime` with `vault.stat`).
    -   Read daily notes from the last N days.

3.  **Pattern Detection**:
    -   Use `query.unified` to find cross-references between recent notes.
    -   Identify recurring topics, unnamed workflows, and unresolved tensions.
    -   Check `_contradictions.md` for emerging conflicts.

4.  **Present Findings**:
    -   **Emerged Patterns**: Named patterns with evidence (3+ notes).
    -   **Evidence**: Specific notes with dates.
    -   **So What**: Why this matters (actionable implication).
    -   **Suggestion**: Formalize as protocol, create concept note, or investigate deeper.

5.  **Execute Solidification**:
    -   Use `vault.create` to scaffold new wiki pages for approved patterns.
    -   Update original notes using `vault.modify` or `vault.append`.

6.  **Log Results**: Update `Log.md` using `vault.append`.

## Rules

-   **Output Language**: Use user's language (from `_CLAUDE.md`).
-   **Minimum 3 Points**: Only call something a pattern if it has at least 3 independent data points.
-   **Cross-Domain Gold**: Prioritize patterns found in unrelated areas.
-   **Conciseness**: Name patterns in 5 words or less.
-   **Counter-Evidence**: Mention exceptions to any identified patterns.
