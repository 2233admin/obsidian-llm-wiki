---
type: project
entity: project/cycle-board
status: active
generated-by: human
last-verified: 2026-06-24
---

8F cycle fixture: an ISOLATED project whose issues all share cycle: 2026-W26.
This project + its issues exist only to exercise the per-cycle completion view
(_pass6_cycle_status). It carries no initiative link and is referenced by no
other test, so it cannot perturb the pr5-board / sortspec-board / iii-pivot
assertions. Completion rule under test: done / (total - canceled); canceled
issues are excluded from the denominator (Linear-sensible).
