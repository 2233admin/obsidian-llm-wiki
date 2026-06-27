---
type: issue
entity: project/sortspec-board/issue/alpha-urgent-future
state: in-progress
assignee: agent/opus
priority: 1
due: 2026-12-31
status: reviewed
generated-by: human
last-verified: 2026-06-22
---

Sort discriminator: p1 (URGENT) but due 2026-12-31 (FUTURE -> NOT overdue) ->
sort component-0 == 1. Same priority rank as zeta above (both p1), and its entity
("alpha...") sorts FIRST alphabetically -- yet it must sort AFTER zeta, proving
the urgent&overdue component dominates both priority rank and the entity tiebreak.
