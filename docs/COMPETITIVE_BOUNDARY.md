# Competitive Boundary

LLMwiki is not a LightRAG clone, a RAG-Anything clone, or a desktop wiki app.
It is a Git-readable reviewed memory layer for agents and humans.

## Position

```text
multimodal import -> retrieval engine -> reviewed Markdown memory -> agent skills
```

LLMwiki owns the reviewed Markdown memory layer. It should integrate good
retrieval and import engines instead of rebuilding them.

## Map

| Neighbor | Role | Boundary decision |
|---|---|---|
| LightRAG | Fast graph-aware retrieval backend | Integrate |
| RAG-Anything | Multimodal document ingestion | Integrate |
| Docling / MinerU | PDF, Office, image, table parsing | Integrate |
| GraphRAG | Entity/community graph retrieval pattern | Learn and integrate selectively |
| gbrain / Mem0 / Zep | Agent memory, facts, timeline, retention | Learn and build the Markdown-native subset |
| nashsu/llm_wiki | Desktop wiki compiler product | Learn workflow, do not copy desktop surface |
| Obsidian / Dendron / Quartz | Human-readable knowledge workflow | Preserve compatibility |

## Build

- Host-neutral `/vault-*` skills.
- `AI-Output -> review -> promote` lifecycle.
- Git-readable provenance and citations.
- Markdown-native facts and timeline.
- Review queue with constrained actions.
- Source hash cache and ingest manifest.
- Doctor checks for stale, duplicate, orphaned, and unreviewed knowledge.

## Integrate

- LightRAG as a retrieval backend.
- RAG-Anything, Docling, or MinerU as import backends.
- Optional rerankers and retrieval evaluation tools.
- Optional graph analytics when they improve citations or review decisions.

## Ignore

- Desktop shell.
- Chat UI.
- Browser clipper as a first-party product.
- Video/audio player UI.
- Full multimodal parser implementation.
- Full vector database implementation.

## Next Features

1. Persistent ingest queue.
2. Source hash cache.
3. Typed facts and timeline query.
4. Constrained review queue.
5. Judge-backed evaluation gates.

## Adapter Contract

Retrieval adapters must be thin. They expose external engines through the
existing `VaultMindAdapter` interface and return `SearchResult` objects with
source, path, content, score, and metadata. They must degrade to unavailable
when the engine is not configured.

The first retrieval adapter is `lightrag`, enabled by `LIGHTRAG_URL`. It calls
an external LightRAG HTTP server and participates in `query.unified` through the
same RRF path as filesystem, qmd, memu, gitnexus, obsidian, and vaultbrain.

The first multimodal bridge is `raganything`, enabled by `RAGANYTHING_URL`. It
expects a small HTTP wrapper around RAG-Anything:

- `GET /health` returns 2xx when ready.
- `POST /query` accepts `{query, top_k, max_results}` and returns `results`,
  `chunks`, `sources`, `response`, or `answer`.
- `POST /process_document` accepts `{file_path, source_path, parser, doc_id,
  output_format}` and returns `markdown`, `content`, `text`, or `content_list`.

`multimodal.ingest` sends a vault-relative source file to that bridge, then
writes reviewed-provenance Markdown into `00-Inbox/Multimodal/*.md` by default.
When VaultBrain is active, the generated note is immediately indexed.

The rule is simple: use engines for finding and parsing; build the layer that
makes knowledge reviewable, durable, and safe to promote.
