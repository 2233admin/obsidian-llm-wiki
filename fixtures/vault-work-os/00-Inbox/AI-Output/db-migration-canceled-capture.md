---
type: issue
entity: project/iii-pivot/issue/db-migration
state: canceled
status: draft
base-head: Projects/iii-pivot/issues/db-migration.md
generated-by: us-01-codex
last-verified: 2026-06-25
---

C2 -- a SECOND draft capture for the same entity, also based on H1
(base-head=H1), proposing state:canceled instead. After C1 is promoted to H2,
the authoritative head is no longer H1, so promoting C2 (still pinned to H1)
must return HEAD_MISMATCH and write nothing -- never silent last-write-wins.
