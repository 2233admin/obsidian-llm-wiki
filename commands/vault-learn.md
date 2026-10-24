---
name: vault-learn
description: Extract teachable principles from an experience or project
---

Extract teachable principles from an experience or project.

Usage: /vault-learn [note path or topic]

Steps:
1. Read the source note with `vault.read` or search with `vault.search`
2. Extract 3-5 transferable lessons:
   - Name the principle (1 short phrase)
   - Evidence: what happened that demonstrates this principle
   - Generalization: in what other contexts does this apply?
   - Confidence: stated / high / medium / speculation
3. Use `vault.create` (dryRun: false) to save at `Knowledge/{principle-slug}.md` with type: principle frontmatter and `ai-first: true`
4. Link back to source note with wikilink in the principle note's `## Sources` section
