# fixtures/vault-project-iii — Task 7A (project status drift guard)

Standalone fixture (NOT a real vault). Exercises the project-staleness guard:
`kb_meta currency` scans the vault-global `Projects/` folder (WORK_DIRS) and
ages out projects that are still ongoing but untouched past the project
threshold (30d), while leaving terminal (completed/archived) projects alone.

`research/wiki/` exists only to satisfy `cmd_currency`'s topic check; the
project notes live at vault root under `Projects/` and are scanned globally.

Seeds (compile date = 2026-06-25):

| note | type | status | last-verified | age | expected |
|---|---|---|---|---|---|
| `Projects/iii-pivot.md` | project | active | 2026-04-26 | 60d | **STALE** (60 > 30) |
| `Projects/fresh-proj.md` | project | active | 2026-06-20 | 5d | OK |
| `Projects/done-proj.md` | project | completed | 2025-12-01 | ~200d | OK (terminal, skipped) |

## Task 7B — project current-truth view

Sub-entities under `Projects/iii-pivot/` (namespaced `project/iii-pivot/...`)
exercise the `_project-status.md` view:

| note | entity suffix | status | expected in view |
|---|---|---|---|
| `actions/wire-auth.md` | action/wire-auth | open (due past, no owner) | OPEN, [OVERDUE] [UNOWNED] |
| `actions/login-form-open.md` | action/login-form | open | SUPERSEDED (not open) |
| `actions/login-form-done.md` | action/login-form | done (supersedes the open) | closed count (current-truth) |
| `actions/db-migration.md` | action/db-migration | blocked | BLOCKERS |
| `decisions/db-choice.md` | decision/db-choice | accepted | RECENT DECISIONS |

Run: `python compiler/kb_meta.py currency fixtures/vault-project-iii research --today 2026-06-25 --apply`
then read the DERIVED `research/wiki/_project-status.md`.
