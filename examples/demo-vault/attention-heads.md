---
aliases:
  - multi-head-attention
  - scaled-dot-product
tags:
  - inference
  - attention
  - architecture
created: 2025-02-14
---

# Attention Heads

Still wrestling with why 12 heads outperform 1. The math says each head learns something different -- a subspace of Q/K/V space -- but empirically I keep seeing the first 3-4 heads dominate on token-prediction tasks. Something about redundancy I haven't fully internalized.

```python
import torch
import torch.nn.functional as F
import math

def scaled_dot_product_attention(Q, K, V, num_heads=12):
    d_k = Q.shape[-1] // num_heads
    scores = torch.matmul(Q, K.transpose(-2, -1)) / math.sqrt(d_k)
    weights = F.softmax(scores, dim=-1)
    # Split into heads
    B, H, T, _ = weights.shape
    return weights.view(B, H, T, -1).matmul(V).view(B, T, H * d_k)
```

The `math.sqrt(d_k)` scaling is critical or you get vanishing gradients on long sequences. Learned that the hard way debugging a 4k-context model last October.

There's an ongoing debate in the team about whether you can prune underperforming heads without degrading loss. Some papers say yes (Structural Sparsity), others show fragile gains. I've been running ablations on [[kv-cache]] efficiency and the results are mixed -- heads that look useless in isolation seem to compensate downstream.

What's interesting: [[speculative-decoding]] tends to draft more aggressively when the early heads are strong. Makes sense in retrospect -- accurate first-pass draft means fewer verifications needed.

TODO: revisit the Lottery Ticket Hypothesis framing for attention heads specifically. Probably worth a dedicated note on [[mixture-of-experts]] too, since sparse activation feels related to head specialization.

[[karpathy-llm-wiki-concept]] nails the framing here -- notes are attention over your own thinking, just like transformers are attention over tokens.
