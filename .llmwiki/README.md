# .llmwiki

Project-local LLMwiki brain configuration.

LLMwiki owns this layer. External systems such as gbrain, Mem0, Zep, and
Obsidian plugins may feed it or be used as references, but they do not define
the project memory schema.

## Memory spine

- Canonical store: LLMwiki VaultBrain.
- Default local engine: PGLite with pgvector and pg_trgm.
- Default embedding model: `ollama:bge-m3`.
- Default embedding width: `1024`.
- Retrieval floor: keyword / trigram search must work even when embeddings are
  missing or Ollama is offline.
- Semantic retrieval: dense vectors are additive, not a hard dependency.

## Why not copy gbrain directly?

gbrain is useful as a reference for agent memory, facts, timeline, retention,
and hybrid retrieval patterns. Its local database on this machine was initialized
with a `768`-dimension embedding column, which cannot accept `bge-m3`'s `1024`
dimension output without rebuilding that database.

LLMwiki already defaults VaultBrain to `1024` dimensions and the memu adapter is
written around `bge-m3` / 1024-dimensional graph recall. Internalizing gbrain
therefore means adopting the useful workflow patterns, not inheriting the
current gbrain storage shape.

## Boundary

- `.llmwiki/` describes project-local memory policy and runtime expectations.
- `_llmwiki/` inside a vault remains vault-visible operational state such as
  source registries.
- `~/.gbrain/` remains external user-machine state.

