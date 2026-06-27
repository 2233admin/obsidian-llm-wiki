"""Task 11A -- Work Driver: deterministic next-work selection.

Reads the authoritative work index (entity-bearing WorkNotes) and picks the
next executable item: an actionable state (todo / in-progress) that is not
blocked, ordered by priority then the stable note_id tie-break so two runs never
disagree (green bar 1: same truth -> same pick, stable under input order).

Zero-dependency on kb_meta; sits beside work_protocol. No runtime / daemon
(§0 #4): a caller invokes this once per `work next` heartbeat and exits. The
lease (base-head optimistic lock) that makes the claim atomic lands beside this.
"""

from __future__ import annotations

import currency
import work_protocol

ACTIONABLE_STATES = frozenset({currency.STATE_TODO, currency.STATE_IN_PROGRESS})


def is_actionable(note, notes) -> bool:
    """True when `note` is an open, unblocked unit of work the driver may pick.
    `notes` is the full work index, needed to resolve blocked-by relations."""
    if currency.work_state(note.cm) not in ACTIONABLE_STATES:
        return False
    ent = note.entity
    if ent and work_protocol.has_unresolved_blocker(notes, ent):
        return False
    return True


def _sort_key(note):
    # priority first (the canonical 8B rank), then the stable optimistic-lock
    # token as the tie-break so two runs never disagree.
    return (currency.priority_rank(note.cm), note.note_id)


def select_next(notes, *, today=None):
    """Return the next executable WorkNote, or None when nothing is actionable.

    Deterministic: the result depends only on the note set, never on input
    order. `today` is accepted for forthcoming due-aware ordering and currently
    unused.
    """
    cands = [n for n in notes if is_actionable(n, notes)]
    if not cands:
        return None
    return min(cands, key=_sort_key)
