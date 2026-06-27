# Work Loop — demand-driven execution heartbeat (Task 11)

The execution loop is **not a daemon** (§0 #4). It is a one-shot CLI heartbeat
that the harness fires **as-needed** — Claude Code `ScheduleWakeup` (in-process,
the chosen mechanism) or, equivalently, a Windows Task Scheduler entry running a
standalone `kb_meta work next`. vault-mind owns no scheduler; the scheduler is
the wheel.

## One tick

1. **Select + gate + lease** — one shot, exits immediately:

   ```
   python compiler/kb_meta.py work next <vault> --claim <agent> [--projected <tokens>]
   ```

   Returns JSON: `{ "selected": {note_id, entity, state} | null, "status",
   "remaining", "budget": {outcome, cap, spent, remaining}, "lease"? }`.

2. **Branch on `status`:**

   | status             | meaning                                  | action                       |
   |--------------------|------------------------------------------|------------------------------|
   | `selected`         | an item was picked and leased            | do the work, then debit (↓)  |
   | `idle`             | nothing actionable in the queue          | **STOP** — do not re-arm     |
   | `budget_exhausted` | the pool cap is reached (gate held)      | **STOP** — do not re-arm     |

3. **Do the work** for `selected.note_id`, capture the result as a
   `vault-capture` block (status:draft), and promote it through the git PR gate.
   Then record the run's token cost back into the pool ledger:

   ```
   python compiler/kb_meta.py work debit <vault> --project <slug> --cost <tokens> --apply
   ```

4. **Re-arm only while `status == "selected"`** (and `remaining > 0`). This is
   the demand-driven ("看情况按需要") cadence: the loop self-terminates when the
   queue drains or the budget is spent — no fixed-interval polling of an empty
   queue, no standing process.

## Why this stays inside §0

- **No runtime** — every tick is a process that runs once and exits; the cadence
  lives in the external scheduler wheel, not in vault-mind.
- **Atomic claim** — the lease is a base-head optimistic lock (`HEAD_MISMATCH`
  rejects a double-claim); a crashed run is reclaimed when its TTL expires.
- **Never overspends** — the budget gate stops *before* a run that would cross
  the cap; `work debit` credits actual cost *after*, so the ledger stays true.
- **Auditable, no side-channel** — work selection reads the authoritative truth;
  results return via capture→promote; machine state (leases) stays in the
  gitignored `.vault-mind/`. Every step is on the git record (§0 #6/#7).
