---
aliases:
  - MoE
tags:
  - inference
  - architecture
  - scale
created: 2025-03-22
---

# Mixture of Experts

The core idea: instead of activating all parameters for every token, only activate a subset ("experts") per token via a routing function. Dense transformers are compute-inefficient at scale; MoE lets you increase capacity without proportionally increasing FLOPs.

```python
class MoELayer(torch.nn.Module):
    def __init__(self, d_model, n_experts=8, top_k=2):
        super().__init__()
        self.gate = torch.nn.Linear(d_model, n_experts)
        self.experts = torch.nn.ModuleList([
            torch.nn.Linear(d_model, d_model) for _ in range(n_experts)
        ])
        self.top_k = top_k

    def forward(self, x):
        logits = self.gate(x)
        weights, indices = torch.topk(logits, self.top_k, dim=-1)
        weights = F.softmax(weights, dim=-1)
        out = torch.zeros_like(x)
        for i, expert in enumerate(self.experts):
            mask = (indices == i).any(dim=-1)
            out[mask] = expert(x[mask])
        return out * weights.sum(dim=-1, keepdim=True)
```

Load balancing is the hard part. Naive routing collapses to 1-2 experts getting most traffic while others sit idle. Auxiliary losses that penalize load imbalance are standard, but they interact with the main training objective in non-obvious ways.

There's also the expert specialization question -- do experts naturally emerge as domain-specific (one for code, one for math, etc.) or does routing just select based on surface features? Evidence is mixed. I've seen emergent specialization in some runs and not others.

[[attention-heads]] and MoE interact in interesting ways. The attention mechanism attends to all tokens regardless of expert routing, which means some cross-expert information flow happens via attention even if expert FFN paths are sparse. The [[kv-cache]] implications are still being worked out.

I suspect [[speculative-decoding]] composes well with MoE -- draft models could use smaller, faster experts, while verification uses the full expert ensemble. The latency/quality tradeoff would be favorable for certain tasks.

One failure mode I keep hitting: the routing function is a bottleneck for [[in-context-learning]]. If examples activate different experts than the test query, the in-context signal is weaker. Mixtral (the open MoE model) shows this in some evals.

The distinction between sparse (top-k routing) and soft (weighted average over all experts) MoE is worth clarifying -- soft MoE is mathematically cleaner but computationally heavier. TODO: revisit.

[[synthetic-data]] generation for MoE is tricky -- the auxiliary load-balancing loss can overfit to synthetic data distribution in ways that don't generalize to real text.
