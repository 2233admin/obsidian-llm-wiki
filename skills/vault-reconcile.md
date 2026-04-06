---
name: vault-reconcile
description: >
  Resolve knowledge conflicts and contradictions in the vault.
  Walks through unresolved entries in _contradictions.md.
---

# /vault-reconcile

# Requires: vault-mind MCP server

Systematically resolve knowledge conflicts (Claim A vs Claim B) in your vault.

## Steps

1.  **Read `_contradictions.md`** using `vault.read`.

2.  **Identify Unresolved Conflicts**:
    -   Parse sections marked with `[ ]`.
    -   Each conflict must show:
        -   **Claim A** + Source Note
        -   **Claim B** + Source Note

3.  **For Each Conflict**:
    -   Present the evidence from both sides clearly.
    -   Prompt the user for a resolution path:
        -   **Option 1: Accept A** (and mark B as outdated).
        -   **Option 2: Accept B** (and mark A as outdated).
        -   **Option 3: Both correct** (but under different conditions/context).
        -   **Option 4: More data needed** (add a TODO for further research).

4.  **Execute Resolution**:
    -   Update `_contradictions.md` by checking the box `[x]` and appending the reasoning/resolution.
    -   Update relevant concept notes using `vault.modify` or `vault.append`.
    -   If one claim is rejected, suggest updating the source note to reflect the correction.

5.  **Summarize Actions**: List which conflicts were resolved and which remain.

## Rules

-   **Never Guess**: If the user is unsure, select "More data needed."
-   **Traceability**: Always include the link to the `_contradictions.md` entry in any derived notes.
-   **Atomic Changes**: Update one note at a time and verify success.
-   **Language**: All output (prompts, summaries, labels) in user's language (from `_CLAUDE.md`).
