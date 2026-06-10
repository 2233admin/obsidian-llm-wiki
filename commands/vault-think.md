---
name: vault-think
description: 10-principle structured thinking framework saved to vault
---

Apply a 10-principle structured thinking framework to a problem and save the analysis.

Usage: /vault-think [problem]

Steps:
1. State the problem in one sentence. If ambiguous, pick the most likely interpretation and say so
2. Apply each principle in order, 2-4 sentences each. Skip principles that clearly do not apply -- but state why in one sentence, do not silently omit:
   - **First principles** -- decompose to facts that cannot be decomposed further
   - **Inversion** -- how would this guaranteedly fail?
   - **Second-order effects** -- consequences of the consequences
   - **Opportunity cost** -- what does choosing this forgo?
   - **Margin of safety** -- how much error can the plan absorb?
   - **Circle of competence** -- which parts exceed what is actually known here?
   - **Occam's razor** -- is there a simpler explanation/solution being overlooked?
   - **Hanlon's razor** -- incompetence before malice as explanation
   - **Base rates** -- how often do similar situations historically succeed?
   - **Pre-mortem** -- assume it failed; what does the post-mortem say?
3. Give a verdict: one-paragraph recommendation, the single biggest risk, and what evidence would change the conclusion
4. Use `vault.write` (dryRun: false) to save at `Thinking/YYYY-MM-DD -- {problem-slug}.md` with:
   - `type: thinking` and `ai-first: true` frontmatter
   - `## For future Claude` preamble: the problem, the verdict, what was uncertain
   - One `##` section per applied principle, `## Verdict` last
   - Wikilinks where entities match vault notes

Report: note path created, verdict in one line, principles skipped and why.
