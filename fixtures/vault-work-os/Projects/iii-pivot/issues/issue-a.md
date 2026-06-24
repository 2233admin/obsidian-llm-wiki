---
type: issue
entity: project/iii-pivot/issue/issue-a
state: in-progress
assignee: agent/opus
priority: 2
blocked-by: [project/iii-pivot/issue/issue-b]
status: reviewed
generated-by: human
last-verified: 2026-06-22
---

A -- a reviewed, in-progress authoritative head that is blocked-by B
(issue-b). Because B is still in-progress (an UNRESOLVED blocker), A's derived
effective_state is `blocked` (active state + unresolved blocker), so A shows in
the Blockers view, not Open. When B is reviewed-promoted to done, A returns to
Open. A draft `state:done` for B does NOT resolve A.
