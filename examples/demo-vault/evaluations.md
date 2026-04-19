---
aliases:
  - benchmarking
  - llm-eval
tags:
  - meta
  - evaluation
  - benchmarking
created: 2025-01-20
---

# Evaluations

Benchmarking LLMs is its own research problem. The standard ones (MMLU, HumanEval, GSM8K) have saturation issues -- top models score within noise of each other, which means you can't detect real improvements.

What I've been building toward: task-specific eval suites with calibrated difficulty curves. Instead of 5k examples at one difficulty level, I want 500 examples each at 5 difficulty levels, so I can see if a change helps struggling cases without hurting strong ones.

```python
def eval_report(model, eval_suite, threshold=0.8):
    results = {}
    for task_name, task_examples in eval_suite.items():
        scores = [model.predict(ex) for ex in task_examples]
        results[task_name] = {
            "mean": sum(scores) / len(scores),
            "pass@1": sum(s >= threshold for s in scores) / len(scores),
            "hard_cases": [e for e, s in zip(task_examples, scores) if s < 0.5]
        }
    return results
```

The "hard cases" output is where most of the signal lives. Knowing what your model gets wrong is more actionable than knowing overall accuracy.

[[in-context-learning]] creates an eval challenge -- if the model can learn from context, your few-shot prompt design matters as much as the model weights. We test both zero-shot and few-shot variants now. The delta between them is diagnostic.

[[retrieval-augmented-generation]] adds another dimension: the eval suite needs to account for retrieval quality, not just model quality. Separate controllables or you're flying blind.

[[training-data-curation]] decisions show up in evals before anywhere else. Benchmark saturation is often a sign that your eval suite is stale, not that your model is near ceiling.

I've started tagging eval runs with model config + training seed. Variance across seeds is larger than I'd like for small models (< 7B params). Important to report confidence intervals, not just means.

[[karpathy-llm-wiki-concept]] is a useful reminder: the act of writing down "what am I testing, why" is itself an eval of your mental model.
