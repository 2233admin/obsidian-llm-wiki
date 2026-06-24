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

H1 carries the full field set (assignee:agent/opus, priority:1, estimate:3,
blocked-by:[schema-freeze]). C1 is SPARSE — it sets only `state: done`, so
`promote(C1)` must materialize a complete H2 that INHERITS the rest from H1.

Green bar (`tests/test_work_os.py`, `WorkProtocol*` cases):

1. C1's draft `state: done` is NOT in the authoritative index and does not change
   open/closed counts (it is a candidate, not a head).
2. `promote(C1)` materializes a complete H2 inheriting assignee/priority/estimate/
   blocked-by from H1, stamped `status: reviewed` + `supersedes: H1` +
   `promotes: C1`. `apply=False` writes nothing; `apply=True` writes H2 and leaves
   H1 + C1 byte-identical.
3. After H2 exists, `promote(C2)` (base-head still H1) returns `HEAD_MISMATCH` and
   writes nothing — never silent last-write-wins.

Run:
    PYTHONUTF8=1 python -m unittest tests.test_work_os -v
