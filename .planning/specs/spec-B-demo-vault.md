# spec-B: Demo Vault (10 fake AI-about-AI notes)

**Assigned worker:** creature `demo-author` on MiniMax-M2.7-highspeed via KT
**Budget:** 45 min. Reject if exceeds 75 min.

## Goal

Produce `examples/demo-vault/` -- 10 markdown files with cross-references that a Claude Code user can point persona skills at and get rich, legible answers in 30 seconds.

## Input contract

- Read `/d/projects/obsidian-llm-wiki/.planning/REQUIREMENTS.md` D-01..02
- Read `/d/projects/obsidian-llm-wiki/compiler/concept_graph.py` to understand what the compiler expects (wikilinks, frontmatter tags, H1 titles)
- Assume reader is a technical AI engineer (HN / X audience)
- Target TAM: people writing notes *about* AI who want their AI to read them back

## Output contract

```
.compile/specB-demo-vault/
  README.md                                     # how to point MCP server at this
  attention-heads.md                            # anchor note
  kv-cache.md
  speculative-decoding.md
  training-data-curation.md
  evaluations.md
  in-context-learning.md
  mixture-of-experts.md
  retrieval-augmented-generation.md
  synthetic-data.md
  karpathy-llm-wiki-concept.md                 # meta-reference node
  .compile/graph.json                          # pre-compiled, committable
```

11 md files + 1 graph.json + 1 README.md = 13 artifacts.

## Content requirements per note

- **Frontmatter**: `aliases`, `tags` (at least 2), `created` (mix of 2024/2025/2026 dates)
- **Length**: 150-400 words each. Not shorter (won't feel real). Not longer (slow to skim).
- **Tone**: technical, first-person, note-to-self. NOT blog-post polish. Deliberate ellipses and "TODO: revisit" allowed.
- **Wikilinks**: each note has 2-4 `[[other-note]]` refs. Total internal edges: 24-36.
- **Tag clusters**: 3 clusters of at least 3 notes each (e.g. `inference`, `training`, `meta`)
- **At least 1 code block** per note (Python or pseudocode)

## Deliberate defects (reject if missing)

1. **Exactly 1 dangling wikilink**: one note references `[[sparse-mixture-experts]]` -- a file that does NOT exist. This drives the `/vault-curator` demo.
2. **Exactly 2 near-duplicate notes**: two notes with overlapping topic (e.g. both discuss attention; title stems differ but they cover 60%+ same ground). Drives `/vault-janitor` demo.
3. **Exactly 1 stale note**: one file has `mtime` set 18 months back (use `touch -t 202410011200 <file>` in build step). Drives `/vault-historian` demo.
4. **Exactly 3 tag clusters**: so `/vault-architect` graph output has visible structure, not a hairball.

## Anchor note (non-negotiable seed)

`karpathy-llm-wiki-concept.md` must:
- Link to at least 5 other notes
- Have H1 `# Karpathy LLM Wiki: notes as AI-readable structure`
- Contain a blockquote of the core Karpathy idea (1-2 sentences, paraphrased)
- Tag: `meta`, `knowledge-system`

This is the landing note users hit first.

## Reject signals

- REJECT any note that reads like it was generated from a template (same structure / same sentence shapes across notes)
- REJECT any code block that is fake pseudocode wrapped in python tags (must be valid python OR clearly labeled as pseudocode)
- REJECT if total internal wikilink edges < 20 or > 40 (sparse or hairball)
- REJECT if any note under 100 words or over 500 words
- REJECT if < 3 tag clusters or > 5 (bounded variety)
- REJECT if dangling link count != 1
- REJECT if tag list in frontmatter uses emoji

## Build step (for graph.json)

After writing the 10 notes, worker runs:
```
cd /d/projects/obsidian-llm-wiki
py -3.11 compiler/concept_graph.py .compile/specB-demo-vault --output .compile/specB-demo-vault/.compile/graph.json
```
and pastes the stderr output into `.compile/specB-demo-vault/README.md` as evidence.

## Acceptance checklist

- [ ] 10 md files + 1 graph.json + 1 README.md
- [ ] 20-40 internal wikilink edges (report count in README)
- [ ] Exactly 1 dangling wikilink (spot: `[[sparse-mixture-experts]]`)
- [ ] 3 tag clusters (list them in README)
- [ ] 1 stale note (mtime check: `stat` output in README)
- [ ] 2 near-duplicates (name them in README)
- [ ] `karpathy-llm-wiki-concept.md` exists and links to 5+ others
- [ ] All notes 150-400 words (worker runs `wc -w` and reports)
- [ ] graph.json builds without errors

## Completion signal

Worker sends to channel `hms_review`:
```json
{"spec": "B", "status": "draft", "output_dir": ".compile/specB-demo-vault/", "edges": 27, "dangling": 1, "duplicates": 2, "stale": 1, "self_check_passed": true}
```
