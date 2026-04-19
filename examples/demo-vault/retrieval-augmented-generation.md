---
aliases:
  - RAG
  - retrieval-augmented
tags:
  - meta
  - memory
  - architecture
created: 2025-02-28
---

# Retrieval-Augmented Generation

The architectural pattern: fuse a retrieval index with a language model, so the model can access external knowledge at inference time rather than relying solely on parametric memory. Useful for knowledge-intensive tasks where your training cut-off is stale or the knowledge is proprietary.

```python
class RAGModel:
    def __init__(self, llm, retriever, top_k=5):
        self.llm = llm
        self.retriever = retriever
        self.top_k = top_k

    def generate(self, query, stream_callback=None):
        # Retrieve relevant context
        docs = self.retriever.search(query, k=self.top_k)
        context = "\n".join(doc.content for doc in docs)

        # Augment prompt
        prompt = f"Context:\n{context}\n\nQuestion: {query}\nAnswer:"
        return self.llm.generate(prompt, stream_callback=stream_callback)
```

The retrieval quality matters more than the LLM for many RAG applications. BM25 is fast and interpretable; dense retrieval (embeddings) captures semantic similarity better but is slower and less interpretable. Hybrid approaches are the current sweet spot.

Chunking strategy is underrated. Fixed-size chunking loses paragraph boundaries; semantic chunking (by topic shift) is better but slower to build. The chunk size interacts with the model's context window -- too large and you waste capacity on irrelevant context, too small and you miss cross-chunk relationships.

I've been thinking about RAG as a [[kv-cache]] extension: retrieval is like a very large, sparse, on-demand cache. The cache invalidation problem is real -- when the underlying document changes, the embedding index is stale. There's research on "read-write" memories that handle this, but production systems mostly just rebuild periodically.

[[in-context-learning]] and RAG interact interestingly. If you retrieve examples (not just facts) and include them in context, you get a hybrid of in-context learning and retrieval. The examples serve as both task specification and knowledge source.

[[evaluations]] for RAG are tricky because you need to separate retrieval quality from generation quality. I usually run retrieval recall separately (does the top-k contain the answer?) and generation quality on retrieved-only context.

[[karpathy-llm-wiki-concept]] frames this well: RAG is making your notes readable by your AI, just like the concept wiki makes thinking traceable.
