---
name: vault-expand
description: Explode a source note into 8-15 interlinked wiki pages plus a MOC
---

Explode one source file into 8-15 interlinked wiki pages with a map-of-content index.

Usage: /vault-expand [source-file]

Steps:
1. Use `vault.read` to read the source file in full
2. Identify 8-15 distinct concepts, entities, or claims worth their own page. Each must be independently understandable -- if two candidates only make sense together, merge them
3. For each concept, use `vault.write` (dryRun: false) to create `Wiki/{concept-slug}.md` with:
   - `type: wiki` and `ai-first: true` frontmatter
   - `## For future Claude` preamble: what this concept is and why it was extracted
   - Body explaining the concept using material from the source plus context
   - `[[wikilinks]]` to at least 2 other pages created in this run -- interlinking is mandatory, an orphan page means the expansion failed
   - A backlink to the source file: `Source: [[{source-file}]]`
4. Update or create a MOC page at `Wiki/MOC -- {source-slug}.md` via `vault.write` (dryRun: false) listing all new pages with one-line descriptions, grouped by theme
5. Verify: every new page has >= 2 outgoing wikilinks to sibling pages and a source backlink. Fix any orphans before reporting

Report: pages created (count + paths), MOC path, link density (total wikilinks / pages), any concepts considered but merged or dropped.
