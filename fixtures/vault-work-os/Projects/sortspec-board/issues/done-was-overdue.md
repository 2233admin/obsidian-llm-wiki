---
type: issue
entity: project/sortspec-board/issue/done-was-overdue
state: done
assignee: agent/opus
priority: 1
due: 2026-06-01
status: reviewed
generated-by: human
last-verified: 2026-06-22
---

OVERDUE-suppression at the VIEW level: state:done with a past due (2026-06-01).
A terminal head is classified to `closed` and never enters open_actions, so it
carries NO OVERDUE flag even though its due date is in the past -- the §3 #5
"suppressed for done/canceled" requirement, proven at the view (not via a helper
proxy).
