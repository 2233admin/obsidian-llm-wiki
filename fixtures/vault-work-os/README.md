# fixtures/vault-work-os — Task 8P (authoritative work update protocol)

Standalone fixture (NOT a real vault). Exercises the §3 P0 green bar for the
work-update transaction: capture is a proposal, promote is the commit, compile
reads only committed work truth.

Notes (note-id = repo-relative path, the optimistic-lock token):

| note | role | state | status | base-head |
|---|---|---|---|---|
| `Projects/iii-pivot/issues/db-migration.md` | **H1** authoritative head | in-progress | reviewed | — |
| `00-Inbox/AI-Output/db-migration-done-capture.md` | **C1** draft candidate | done | draft | H1 |
| `00-Inbox/AI-Output/db-migration-canceled-capture.md` | **C2** draft candidate | canceled | draft | H1 |
| `Projects/iii-pivot/issues/schema-freeze.md` | dependency H1 is blocked-by | done | reviewed | — |
| `Projects/iii-pivot/issues/issue-a.md` | **A** blocked-by B | in-progress | reviewed | — |
| `Projects/iii-pivot/issues/issue-b.md` | **B** A's blocker | in-progress | reviewed | — |
| `00-Inbox/AI-Output/issue-b-done-capture.md` | draft done for B (does NOT resolve A) | done | draft | B |
| `00-Inbox/AI-Output/loose-thought-capture.md` | **8D** capture with NO entity | — | draft | — |
| `Projects/iii-pivot/issues/api-rename.md` | api-rename head | in-progress | reviewed | — |
| `Projects/iii-pivot/issues/api-rename.reviewed.1.md` | reviewed snapshot, `promotes:` the capture | done | reviewed | — |
| `00-Inbox/AI-Output/api-rename-done-capture.md` | **8D** CONSUMED capture (absent from triage) | done | draft | api-rename |
| `Projects/pr5-board/board.md` | **8B** project node (its own board) | active | — | — |
| `Projects/pr5-board/issues/ship-auth.md` | **8B** p1 + overdue + agent → `[URGENT][OVERDUE]` (sorts first) | in-progress | reviewed | — |
| `Projects/pr5-board/issues/polish-docs.md` | **8B** p3, no due/flags | todo | reviewed | — |
| `Projects/pr5-board/issues/triage-inbox.md` | **8B** no assignee/owner → `[UNASSIGNED]` | todo | reviewed | — |
| `Projects/sortspec-board/board.md` | **8B-sort** project node | active | — | — |
| `Projects/sortspec-board/issues/zeta-urgent-overdue.md` | p1+overdue → sorts FIRST despite latest entity | in-progress | reviewed | — |
| `Projects/sortspec-board/issues/alpha-urgent-future.md` | p1, future due (not overdue) → after zeta despite earliest entity | in-progress | reviewed | — |
| `Projects/sortspec-board/issues/tie-mango.md` | p3 no-due, sort tuple identical to tie-apple except entity | todo | reviewed | — |
| `Projects/sortspec-board/issues/tie-apple.md` | p3 no-due, entity tiebreak → before tie-mango | todo | reviewed | — |
| `Projects/sortspec-board/issues/done-was-overdue.md` | done + past due → classified `closed`, NO view OVERDUE | done | reviewed | — |

Task 8B issue PROPERTIES (`_project-status.md`, DERIVED): the `project/pr5-board`
project's three open issues exercise the per-issue flags and per-project rollup.
`urgent ⇔ priority == 1` (strictly, not `<= 1`); `[OVERDUE]` iff `due < --as-of`
and the work state is not done/canceled; `[UNASSIGNED]` iff `resolve_assignee ==
UNASSIGNED` (owner stays an assignee alias — this REPLACES 7B's `UNOWNED`). Open
actions sort by `(urgent&overdue, PRIORITY_RANK, overdue, due, entity)`, so
`ship-auth` (urgent+overdue) sorts first; the project section surfaces the summed
open estimate (5 + 2 + 1 = 8 pts; missing estimates ignored).

The `project/sortspec-board` project DISCRIMINATES the sort components pr5-board
cannot: `zeta-urgent-overdue` and `alpha-urgent-future` are BOTH p1 (equal
priority rank), so only the urgent&overdue component (zeta overdue, alpha not)
can order them — zeta sorts before alpha despite "zeta" > "alpha" and equal rank.
`tie-apple`/`tie-mango` are p3, no-due, identical in every sort component except
entity, pinning the final lexicographic `entity` tiebreak (apple before mango).
`done-was-overdue` is state:done with a past due — it classifies to `closed` and
never enters open_actions, so OVERDUE is suppressed at the VIEW (not just via the
`work_state` helper proxy).

H1 carries the full field set (assignee:agent/opus, priority:1, estimate:3,
blocked-by:[schema-freeze]). C1 is SPARSE — it sets only `state: done`, so
`promote(C1)` must materialize a complete H2 that INHERITS the rest from H1.
schema-freeze is a reviewed `state: done` head, so it RESOLVES H1's dependency
(H1 is NOT blocked).

Task 8C blocker graph: **A** is `blocked-by: [B]`; **B** is reviewed but still
in-progress, so A's derived `effective_state == 'blocked'` (Blockers, not Open).
The draft `state: done` capture for B is a candidate, never a head, so it does
NOT resolve A; only `promote(issue-b-done-capture)` (reviewed done) returns A to
Open. `blocks` (B blocks A) and `related` are DERIVED from `blocked-by` — never
persisted.

Green bar (`tests/test_work_os.py`, `WorkProtocol*` cases):

1. C1's draft `state: done` is NOT in the authoritative index and does not change
   open/closed counts (it is a candidate, not a head).
2. `promote(C1)` materializes a complete H2 inheriting assignee/priority/estimate/
   blocked-by from H1, stamped `status: reviewed` + `supersedes: H1` +
   `promotes: C1`. `apply=False` writes nothing; `apply=True` writes H2 and leaves
   H1 + C1 byte-identical.
3. After H2 exists, `promote(C2)` (base-head still H1) returns `HEAD_MISMATCH` and
   writes nothing — never silent last-write-wins.

Task 8D triage (`_triage.md`, DERIVED): scans `00-Inbox/AI-Output/**` for
UNCONSUMED captures and routes them into three sections. A capture is CONSUMED
when its note-id appears in some note's `promotes:` (accepted) or `rejects:`
(rejected) field; a consumed capture disappears from the view (source bytes
unchanged).

- **Unclassified** — `loose-thought-capture.md` (no entity).
- **Pending Review** — `issue-b-done-capture.md` (has entity, cleanly promotable).
- **Conflicts** — the two `db-migration-*` captures (competing promotions for the
  same entity); also stale base-head (HEAD_MISMATCH) and multi-head
  CURRENT-TRUTH-CONFLICT, exercised by dedicated test vaults.
- **Absent (consumed)** — `api-rename-done-capture.md`: the reviewed snapshot
  `api-rename.reviewed.1.md` carries `promotes:` it.

Run:
    PYTHONUTF8=1 python -m unittest tests.test_work_os -v
