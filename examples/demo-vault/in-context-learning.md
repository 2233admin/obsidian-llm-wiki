---
aliases:
  - few-shot
  - icm
  - in-context
tags:
  - inference
  - meta
  - learning
created: 2025-01-05
---

# In-Context Learning

The phenomenon where language models improve at a task given examples in the prompt, without weight updates. Still not fully explained -- the leading theories involve gradient descent as inference, task-vector composition, and implicit Bayesian inference.

```python
def apply_icp(model, task_description, examples, test_input):
    """In-context prediction: prepend examples, let model condition."""
    prompt = task_description + "\n\nExamples:\n"
    for ex_in, ex_out in examples:
        prompt += f"Input: {ex_in}\nOutput: {ex_out}\n"
    prompt += f"\nInput: {test_input}\nOutput:"
    return model.generate(prompt)
```

The key hyperparameters: number of examples (k), their ordering (recency bias means later examples matter more), and the diversity of the example set. k=4-8 is usually sweet spot; beyond 16 I see saturation or degradation, especially on shorter-context models.

Demonstration construction matters more than I expected. Randomly sampled examples can introduce noise; curated examples that cover edge cases of the target distribution work better. There's a skill to writing good demonstrations.

Why does ICL work? The main candidates:

1. **Implicit finetuning**: forward pass approximates what finetuning would do
2. **Task vector composition**: examples activate overlapping circuits
3. **Bayesian program induction**: model infers the latent program generating the examples

My current bet is on 1 + 2. The [[attention-heads]] analysis is interesting here -- different heads seem to specialize in retrieving example-to-label mappings vs. generalizing across examples.

[[evaluations]] of ICL capability need to test generalization: does the model do well on examples drawn from the same distribution as the demonstrations, or does it extrapolate? The failure modes are different.

There's a known connection to [[mixture-of-experts]] -- MoE models tend to show stronger ICL because the routing mechanism can select relevant experts for each in-context example. Unclear if this is causal or confounded.

[[synthetic-data]] generation for ICL is interesting: you can generate (task_description, examples, test) triplets programmatically for structured problems (translation, math, code) and use them to amplify ICL performance.

The framing here applies directly -- writing good in-context examples is like writing good notes: clear structure, explicit relationships, minimal noise.
