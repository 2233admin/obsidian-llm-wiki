---
name: vault-reconcile
description: Find and resolve contradictions across vault notes
---

Find contradictions across vault notes and resolve or flag them.

Steps:
1. Use `vault.search` with key terms to find notes that might conflict
2. For each pair of potentially conflicting claims:
   - Evaluate by: recency (newer wins), authority (cited source vs. inference), plausibility (which is more internally consistent), evolution (genuine change of view vs. error)
   - If auto-resolvable: update the older/weaker note with `vault.modify`, add a `## History` section noting what changed and why
   - If ambiguous: create a conflict note at `_Conflicts/{slug}.md` with both claims and the open question
3. Report: contradictions found, auto-resolved count, flagged-for-review count

Focus on: factual claims, dates/timelines, relationship status, project status, decisions that may have been superseded.
