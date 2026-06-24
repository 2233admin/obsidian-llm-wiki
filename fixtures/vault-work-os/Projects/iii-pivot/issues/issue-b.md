---
type: issue
entity: project/iii-pivot/issue/issue-b
state: in-progress
assignee: agent/codex
priority: 2
status: reviewed
generated-by: human
last-verified: 2026-06-22
---

B -- the reviewed authoritative head that A is blocked-by. B is still
state:in-progress, so it is an UNRESOLVED blocker for A. Only a reviewed-promoted
state:done head for B resolves A; the draft `state:done` capture for B
(issue-b-done-capture.md) is a candidate, never a head, so it must NOT resolve A.
