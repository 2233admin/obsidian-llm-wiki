---
aliases:
  - spec-dec
  - speculative-draft
tags:
  - inference
  - latency
  - optimization
created: 2025-04-01
---

# Speculative Decoding

The core insight: small draft models are fast at generating candidate tokens, large verifier models accept/reject them in parallel. You get effective decoding speedup without quality loss (in expectation).

```python
def speculative_decode(draft_model, verify_model, prompt, gamma=4, max_len=100):
    tokens = prompt
    for _ in range(max_len):
        # Draft gamma tokens with small model
        draft_tokens = []
        for _ in range(gamma):
            logits = draft_model.forward(tokens)
            next_tok = logits.argmax(dim=-1)
            draft_tokens.append(next_tok)
            tokens = torch.cat([tokens, next_tok.unsqueeze(0)])

        # Verify all at once with large model
        logits_large = verify_model.forward(tokens)
        accepted = min(gamma, logits_large.argmax(dim=-1) == draft_tokens)
        tokens = tokens[:len(prompt) + accepted]
        if accepted < gamma:
            break
    return tokens
```

The accepted/declined ratio is the key metric. Typical ratio is 0.7-0.85 for well-matched draft/verify pairs. The tricky part is training the draft model -- too weak and you waste compute, too strong and you just duplicate the verifier.

I've noticed [[attention-heads]] configuration affects the drafting behavior. Early-layer heads that fire strongly on short-range dependencies seem to produce better drafts for common n-gram patterns.

The memory bandwidth bound problem shows up here: the large model still has to do full KV cache access for verification. The parallelism gain is in the draft phase, but the bottleneck shifts to memory bandwidth for the verifier. [[kv-cache]] optimization is still critical.

There's an unexplored angle on [[mixture-of-experts]] here -- sparse MoE draft models might draft better than dense models at the same parameter count. Intuitively, special-purpose experts might produce more diverse candidates than a dense model that spreads capacity across everything.

[[retrieval-augmented-generation]] and speculative decoding might compose interestingly -- if you could speculative-draft the retrieval call instead of the token, you'd get compound speedup. Unclear if the latency tradeoff works out.
