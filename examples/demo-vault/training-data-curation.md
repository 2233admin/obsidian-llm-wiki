---
aliases:
  - data-filtering
  - quality-filtering
tags:
  - training
  - data
  - curation
  - architecture
created: 2024-10-12
---

# Training Data Curation

The dirty secret is that data quality matters more than architecture. I've spent weeks on transformer variants that get beaten by a better-curated training set on the same compute budget.

Pipeline we settled on:
1. Language detection (fasttext-based, ~97% accuracy)
2. Quality classifier (small BERT-style model, trained on human preferences)
3. Deduplication (MinHash, simhash for near-dupes)
4. Toxicity filter (perspective API + lightweight local classifier)
5. Per-domain sampling weights (determined by downstream evals)

```python
# Simplified quality scoring
def quality_score(text, classifier_model, length_penalty=0.1):
    base_score = classifier_model.predict_proba([text])[0]
    length_factor = min(len(text) / 1000, 1.0) * length_penalty
    return base_score + length_factor
```

The sampling weights are the hardest part. Weights that optimize [[evaluations]] performance on standard benchmarks might not generalize to domain-specific tasks. Learned that the hard way when a math-heavy training mix crushed benchmark numbers but made the model worse at code generation.

There's a persistent question about synthetic vs. natural data. Synthetic data has gotten good results for specialized domains, but I've seen cases where it introduces subtle biases that don't show up in auto-eval but survive into human preference surveys. The bias-variance tradeoff is real.

Curation has diminishing returns -- after a certain quality threshold, you're filtering out edge cases that might be important for robustness. The Pareto frontier moves depending on your downstream task.

[[mixture-of-experts]] models seem more tolerant of noisy data, possibly because each expert sees a filtered view via routing. Might be worth testing MoE vs. dense models specifically on curation-quality curves.
