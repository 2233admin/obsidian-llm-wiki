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

Run: `python compiler/kb_meta.py currency fixtures/vault-project-iii research --today 2026-06-25`
