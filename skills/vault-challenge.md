---
name: vault-challenge
description: >
  The vault argues back. Uses your own history and recorded contradictions to challenge assumptions.
  Uses the vault-mind MCP server to pull evidence.
---

# /vault-challenge [topic or decision]

# Requires: vault-mind MCP server

The vault challenges your current proposal by searching for counter-evidence in your own history and existing contradictions.

## Steps

1.  **Read `_CLAUDE.md`** to locate relevant history folders.

2.  **Identify the Claim**: What is the user assuming or deciding?

3.  **Search for Conflicts (Parallel Call)**:
    -   **History Agent**: Search past daily notes and `Log.md` for similar attempts.
    -   **Conflict Agent**: Call `vault.read` on `_contradictions.md` to see if this topic is already a known point of tension.
    -   **Pattern Agent**: Search for structural failures in related domains.

4.  **Analyze Evidence**:
    -   Check if the user is proposing something they previously decided against.
    -   Check for active, unresolved contradictions related to the topic.

5.  **Build the Challenge**:
    -   **Your Own Words**: Quote past notes that contradict the current plan.
    -   **What Happened Last Time**: Concrete outcomes from past events.
    -   **Existing Contradictions**: Highlight if the topic is currently "unresolved" in the vault.
    -   **Steel-Man Counter**: The strongest argument against the current direction.

6.  **Log the Challenge**: Use `vault.append` to add the challenge outcome to the daily note or `Log.md`.

## Rules

-   **Output Language**: Use the user's language (from `_CLAUDE.md`).
-   **No Yes-Men**: If there is evidence, present it forcefully but fairly.
-   **Source Attribution**: Always link back to the source notes in the vault.
-   **When No Evidence**: Say so clearly. "The vault has no recorded history against this."
