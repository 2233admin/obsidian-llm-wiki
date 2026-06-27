---
type: issue
entity: project/sortspec-board/issue/tie-mango
state: todo
assignee: agent/codex
priority: 3
status: reviewed
generated-by: human
last-verified: 2026-06-23
---

Entity-tiebreak pair (1 of 2): p3, no due, not urgent, not overdue -> sort tuple
(1, rank-of-p3, 1, DATE_MAX, entity). Identical to tie-apple below in every sort
component EXCEPT entity, so the final lexicographic `entity` tiebreak alone
decides their order ("tie-apple" before "tie-mango").
