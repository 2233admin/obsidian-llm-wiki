---
aliases:
  - key-value-cache
  - kv-cache
tags:
  - inference
  - memory
  - optimization
created: 2025-03-08
---

# KV Cache

The key-value cache is where inference efficiency lives. Without it, you'd recompute attention over all previous tokens for every new token -- O(n²) per step instead of O(1) with cached keys and values.

```python
class KVCache:
    def __init__(self):
        self.k_buf = []
        self.v_buf = []

    def update(self, k, v):
        self.k_buf.append(k)
        self.v_buf.append(v)
        return torch.cat(self.k_buf, dim=2), torch.cat(self.v_buf, dim=2)

    def prune(self, keep_last_n=2048):
        self.k_buf = self.k_buf[-keep_last_n:]
        self.v_buf = self.v_buf[-keep_last_n:]
```

The pruning problem is non-trivial. Naive keep-last-n loses information in long documents -- if the relevant context is in position 100 and you only keep 2048 tokens, you're fine, but cross-document tasks (RAG, agent loops) break. I've been experimenting with importance-based eviction using attention weights from the previous step, but it's slower than the speedup it provides.

Batching across requests with shared prefixes is the real win. If 8 users all started with the same system prompt, you cache once and attend to it without recompute. vLLM does this with paged attention -- worth digging into their sliding window approach.

[[attention-heads]] matter here too -- some heads seem to specialize in prefix content vs. local context. Pruning heads aggressively could interact badly with prefix-heavy prompts.

Also thinking about [[speculative-decoding]] interaction -- if you're verifying 4 speculative tokens per step, you need to extend the KV cache 4x per decode. The memory pressure is real.

[[training-data-curation]] matters indirectly: cleaner training data means the model generalizes better with smaller caches. Noise in the tail of distributions seems to force larger context windows.
