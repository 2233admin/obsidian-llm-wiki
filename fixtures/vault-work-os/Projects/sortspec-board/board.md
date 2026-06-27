---
type: project
entity: project/sortspec-board
status: active
generated-by: human
last-verified: 2026-06-24
---

Sort-determinism + OVERDUE-suppression board. A dedicated project whose open
actions discriminate the 8B sort_key components that pr5-board cannot:
  * the urgent&overdue-first component vs the priority-rank component (two p1
    actions, one overdue one not -- component-0 must order them, not the entity
    tiebreak);
  * the final `entity` lexicographic tiebreak (two actions with an identical
    sort tuple differing only by entity);
  * OVERDUE suppression at the VIEW level (a done action with a past due is
    classified to `closed` and never surfaces an OVERDUE flag).
Kept separate from pr5-board so its exact open-action set stays stable.
