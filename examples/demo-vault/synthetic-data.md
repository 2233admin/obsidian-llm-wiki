---
aliases:
  - synth-data
  - augmented-data
tags:
  - training
  - synthetic
  - augmentation
created: 2025-04-10
---

# Synthetic Data

Generating training data with models instead of collecting it from humans. The main use case: domains where human data is scarce, expensive, or noisy (medical, legal, code in low-resource languages, edge cases).

The standard pipeline: seed with real examples, use a stronger model to generate variations, filter with a classifier, repeat. This is basically self-play for data.

```python
def synthesize_examples(task, seed_examples, generator, filter_model, n=1000):
    """Iterative self-play data generation."""
    current = seed_examples
    for _ in range(3):  # 3 rounds
        prompts = [format_example(ex, task) for ex in current]
        generated = generator.batch_generate(prompts, n=len(prompts) * 10)
        scored = [(g, filter_model.score(g)) for g in generated]
        current = [g for g, s in scored if s > 0.9][:len(seed_examples)]
    return current
```

Quality filtering is critical. Generated data has modes that don't match real distribution -- the model tends to produce "average" examples, under-representing tails. Importance weighting based on difficulty (measured by a reference model's confidence) helps.

The diversity-accuracy tradeoff shows up here: high-temperature generation is diverse but low-quality, low-temperature is accurate but mode-collapse-prone. The sweet spot is non-obvious and task-dependent.

[[training-data-curation]] and synthetic data are natural complements. Synthetic data is expensive to generate, so you want to generate it for high-value examples, not ones you'd get from random web crawl. The curation step determines where to apply synthetic augmentation.

[[evaluations]] on synthetic-trained models need extra scrutiny. Synthetic data can teach to the generator's biases, which means the eval suite needs to be robust to generator-specific artifacts. I've caught this by testing on held-out real data, not just held-out synthetic.

[[mixture-of-experts]] might help with synthetic data generalization -- if different experts specialize to different synthetic-data modes, the ensemble might be more robust than a dense model trained on the same data.

The [[karpathy-llm-wiki-concept]] framing is relevant here too: synthetic data generation is like [[in-context-learning]] but at dataset scale. You're prompting the generator model to produce examples that match the task distribution, same as in-context prompts match the few-shot distribution.
