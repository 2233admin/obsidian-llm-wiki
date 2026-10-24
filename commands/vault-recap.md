---
name: vault-recap
description: Generate a period review from vault activity
---

Generate a period review from vault activity.

Usage: /vault-recap [week|month|quarter] or /vault-recap [start-date] [end-date]

Steps:
1. Use `vault.search` to find notes modified in the period. Check Daily/, Projects/, Decisions/, Meetings/ folders.
2. Synthesize:
   - **What happened**: key events, decisions made, projects moved
   - **What was learned**: insights from the period
   - **What changed**: views or plans that shifted
   - **What's pending**: open decisions, stalled items, follow-ups
   - **Metrics** (if available): tasks completed, decisions made, notes created
3. Use `vault.create` (dryRun: false) to save at `Reviews/YYYY-MM-DD -- {period}-recap.md` with type: review frontmatter

Report: note path, key highlights surfaced.
