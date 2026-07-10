---
name: vault-autoresearch
description: 3-round autonomous research loop with intermediate notes and synthesis
---

Run a 3-round autonomous research loop on a topic, saving intermediate notes each round and a final synthesis.

Usage: /vault-autoresearch [topic]

Steps:
1. First check vault via `vault.search` for existing knowledge on this topic
2. **Round 1 -- Survey**: Use `WebSearch` with broad queries to map the topic landscape. Identify major facets, key players, recent developments. Write intermediate note via `vault.write` (dryRun: false) to `Research/YYYY-MM-DD -- {topic-slug} -- round-1.md` with findings and the 3-5 most promising sub-directions discovered
3. **Round 2 -- Deep dive**: For each of the 3-5 sub-directions from Round 1, run targeted searches and `WebFetch` the strongest sources. Write `Research/YYYY-MM-DD -- {topic-slug} -- round-2.md` with per-direction findings and source URLs
4. **Round 3 -- Cross-examination**: Search specifically for contradictions, counterarguments, and dissenting views against Round 1-2 findings. Note which claims survived and which got weakened. Write `Research/YYYY-MM-DD -- {topic-slug} -- round-3.md`
5. Write final synthesis via `vault.write` (dryRun: false) to `Research/YYYY-MM-DD -- {topic-slug} -- synthesis.md` with:
   - `type: research` and `ai-first: true` frontmatter
   - `## For future Claude` preamble: what was researched, what to trust, what to re-verify
   - `## Findings` section with confidence levels per claim (high / medium / contested)
   - `## Contradictions` section from Round 3
   - `## Sources` section with all URLs verbatim and recency markers `(as of YYYY-MM, source.com)`
   - Wikilinks to the three round notes

Report: 4 note paths created, confidence breakdown (counts of high/medium/contested claims), strongest contradiction found.
