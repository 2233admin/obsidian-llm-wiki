---
name: vault-synthesize
description: Scan vault for unnamed patterns and write synthesis notes
---

Scan the vault for unnamed cross-source patterns and write synthesis notes.

Steps:
1. Use `vault.search` to find notes created in the last 30 days across major topic areas
2. Look for: recurring themes appearing in 3+ notes, concept evolution (same term used differently over time), entity convergence (2+ separate chains of thought converging on same person/project/idea), orphan rescue (isolated notes that actually belong to a pattern)
3. For each pattern found, use `vault.create` (dryRun: false) to write a synthesis note at `Synthesis/YYYY-MM-DD -- {pattern-slug}.md` with:
   - `type: synthesis` frontmatter
   - `ai-first: true` frontmatter
   - `## For future Claude` preamble summarizing the pattern
   - `## Pattern` section explaining what converged
   - `## Evidence` section with wikilinks to source notes
   - `## Implications` section

Report: patterns found, synthesis notes created, notes that were linked.
