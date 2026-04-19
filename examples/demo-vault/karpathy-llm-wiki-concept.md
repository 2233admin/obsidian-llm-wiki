---
aliases:
  - llm-wiki-concept
  - knowledge-system
tags:
  - meta
  - knowledge-system
created: 2025-01-01
---

# Karpathy LLM Wiki: Notes as AI-Readable Structure

> Your language model is a compression algorithm over your text corpus. The better your notes, the better the compression -- and the better your model can reason over them. The structure you impose via wikilinks, tags, and frontmatter is the inductive bias that makes retrieval and inference tractable.

This is the seed note for the obsidian-llm-wiki concept. The insight: if you write notes the way you'd want an AI to read them -- with explicit relationships, not just keywords -- the AI can reconstruct your mental model, not just match tokens.

The problem with traditional note-taking: it's optimized for human retrieval (search, tags, folder hierarchy) but it's opaque to LLMs. Wikilinks add the missing graph structure.

What I've found works:

- **Bidirectional links**: if A links to B, B should link back or at least reference A. attention-heads.md and kv-cache.md have this property.
- **Explicit relationships**: `[[attention-heads]]` is better than "the attention mechanism has several heads". The latter requires the LLM to infer the reference.
- **Clustered topics**: tags let the LLM know what domain a note belongs to before reading it.
- **Code + prose**: code blocks give the LLM something concrete to anchor on.

The 3 tag clusters in this vault:
1. **inference** -- attention-heads, kv-cache, speculative-decoding, mixture-of-experts, in-context-learning
2. **training** -- training-data-curation, synthetic-data, evaluations
3. **meta** -- karpathy-llm-wiki-concept, retrieval-augmented-generation, evaluations

The deliberate defects in this vault are educational:
- mixture-of-experts.md references a non-existent [[sparse-mixture-experts]] note (the dangling wikilink -- drives /vault-curator)
- attention-heads.md and kv-cache.md both discuss attention mechanisms with significant overlap (near-duplicates -- drives /vault-janitor)
- training-data-curation.md has an mtime from October 2024 (stale -- drives /vault-historian)

These are what make `/vault-curator`, `/vault-janitor`, and `/vault-historian` skills worth demoing.

[[evaluations]] is the meta-skill for this whole system. You can't improve what you can't measure.

[[retrieval-augmented-generation]] is the most direct application of wiki-structure to inference -- your notes become the retrieval index.

[[synthetic-data]] and [[speculative-decoding]] are where the rubber meets the road: synthetic data shows how to generate training signal, speculative decoding shows how to spend it efficiently at inference time.
