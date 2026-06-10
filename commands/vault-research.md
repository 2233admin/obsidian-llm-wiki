---
name: vault-research
description: Web research dossier saved to vault
---

Research a topic and save a structured dossier to the vault.

Usage: /vault-research [topic]

Steps:
1. First check vault via `vault.search` for existing knowledge on this topic
2. Research the topic using available web tools (WebFetch, WebSearch)
3. Structure findings as:
   - **Summary** -- 2-3 paragraph overview
   - **Key Facts** -- bullet list with source URLs inline and recency markers `(as of YYYY-MM, source.com)`
   - **Key Players** -- people/orgs involved with wikilinks where they match vault entries
   - **Open Questions** -- what remains unclear or contested
   - **Further Reading** -- 3-5 relevant links
4. Use `vault.ingest` (dryRun: false) to save at `Research/YYYY-MM-DD -- {topic-slug}.md` with type: research, source URLs in frontmatter

Report: note path created, vault notes updated with new knowledge, open questions surfaced.
