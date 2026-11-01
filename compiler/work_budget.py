"""Task 11B -- budget / quota ledger: the spawn-gate that never overspends.

A work item, or its project container as a shared pool, may declare a token
budget in markdown frontmatter:

    budget: <int>          # the cap (tokens / units of quota)
    budget-spent: <int>    # running total, default 0

Both live in markdown -- the cap is intent (§0 #1: markdown is the only truth)
and the spend tally is auditable history maintained via capture->promote after
each run (§0 #7: no hidden side-channel; the lease registry is the only thing in
the gitignored machine layer, never the budget). Before the driver claims an
item -- the lease is the spawn authorization -- it checks the pool: if the
projected next run would cross the cap it STOPS *before* spawning, so the ledger
can reach the cap but never exceed it (green bar 3: "to the threshold, exit
before spawn, never overspend").

Quota is opt-in: an item under no declared budget is unbounded (OK). Pooling
(§7 配额池化) is a shared cap several items draw from -- the project-container
budget, which any issue under ``project/<slug>/`` resolves to when it declares
none of its own. A pooled cap reached by one item gates the rest, which is the
point: a ceiling is what turns parallel agents toward collaboration.

Pure / deterministic / zero-dep: the caller passes the projected cost; this
module makes no token-meter or wall-clock call of its own.
"""

from __future__ import annotations

import dataclasses
import re

OUTCOME_OK = "OK"
OUTCOME_EXHAUSTED = "EXHAUSTED"

CAP_KEY = "budget"
SPENT_KEY = "budget-spent"


def _as_int(value, default: int = 0) -> int:
    """Coerce a frontmatter scalar (int or str) to int; blank / unparsable /
    None -> default. Negative values clamp to 0 (a budget is never below zero)."""
    if value is None or value == "":
        return default
    try:
        n = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return n if n >= 0 else 0


@dataclasses.dataclass
class BudgetResult:
    outcome: str
    cap: int | None = None
    spent: int = 0
    projected: int = 0

    @property
    def remaining(self) -> int:
        """Quota left before the cap. Unbounded pools report -1 (no ceiling)."""
        if self.cap is None:
            return -1
        return max(0, self.cap - self.spent)


def read_budget(note) -> tuple[int | None, int]:
    """Read (cap, spent) declared directly on `note`. cap is None when the note
    declares no `budget` key (the item carries no budget of its own)."""
    raw = note.raw or {}
    cap = raw.get(CAP_KEY)
    cap = _as_int(cap, default=0) if cap not in (None, "") else None
    return cap, _as_int(raw.get(SPENT_KEY), default=0)


def pool_slug(entity: str | None) -> str | None:
    """The project slug an entity belongs to: ``project/<slug>/...`` -> ``slug``;
    the container entity ``project/<slug>`` -> ``slug``; otherwise None."""
    if not entity:
        return None
    parts = entity.split("/")
    if len(parts) >= 2 and parts[0] == "project":
        return parts[1]
    return None


def resolve_pool(note, notes) -> tuple[int | None, int]:
    """Resolve the budget pool that gates `note`.

    An item's own declared `budget` wins. Otherwise it draws on its project
    container's pool (the note whose entity is ``project/<slug>``), so a shared
    cap gates every issue under it. When neither declares a budget the item is
    unbounded -> (None, 0).
    """
    own_cap, own_spent = read_budget(note)
    if own_cap is not None:
        return own_cap, own_spent
    slug = pool_slug(note.entity)
    if slug is not None:
        container = next((n for n in notes if n.entity == f"project/{slug}"), None)
        if container is not None:
            cap, spent = read_budget(container)
            if cap is not None:
                return cap, spent
    return None, 0


def check(cap: int | None, spent: int, *, projected: int = 0) -> BudgetResult:
    """The spawn-gate. Unbounded (cap is None) -> OK. Otherwise EXHAUSTED when
    the pool is already at/over the cap, or when admitting a run of `projected`
    cost would push spend *past* the cap. Spending up to exactly the cap is
    allowed (== is not over); only > overspends."""
    if cap is None:
        return BudgetResult(OUTCOME_OK, cap=None, spent=spent, projected=projected)
    over = spent >= cap or (spent + max(0, projected)) > cap
    outcome = OUTCOME_EXHAUSTED if over else OUTCOME_OK
    return BudgetResult(outcome, cap=cap, spent=spent, projected=max(0, projected))


def debit(spent: int, cost: int) -> int:
    """Add a run's actual `cost` to the running spend total. Negative cost is a
    programming error (spend only ever grows) -> rejected."""
    if cost < 0:
        raise ValueError(f"budget cost must be non-negative, got {cost}")
    return _as_int(spent, 0) + cost


# `$` is matched per-line (re.MULTILINE); trailing run is horizontal whitespace
# only ([^\S\r\n]) so it never swallows the newline into the next line.
_SPENT_LINE_RE = re.compile(r"^(budget-spent:[^\S\r\n]*)(\d+)[^\S\r\n]*$", re.MULTILINE)
_CAP_LINE_RE = re.compile(r"^(budget:[^\S\r\n]*)(\d+)[^\S\r\n]*$", re.MULTILINE)


def record_spend(text: str, cost: int) -> str:
    """Write a run's `cost` back into a pool note's ledger -- the after-run half
    of the budget loop (the gate is the before-spawn half). Surgical + byte-
    preserving: only the `budget-spent` value changes; everything else in the
    note is left identical, so the derived/source contract holds and a promote
    diff is a one-line ledger bump.

    Increments an existing `budget-spent: N` line to N+cost; if the note declares
    a `budget:` cap but no spent line yet, inserts `budget-spent: <cost>` right
    after the cap. A note that declares no `budget:` is not a pool -> ValueError
    (the driver must only debit pool notes). Negative cost -> ValueError.
    """
    if cost < 0:
        raise ValueError(f"budget cost must be non-negative, got {cost}")
    m = _SPENT_LINE_RE.search(text)
    if m:
        new = _as_int(m.group(2)) + cost
        return text[:m.start()] + f"{m.group(1)}{new}" + text[m.end():]
    cap = _CAP_LINE_RE.search(text)
    if cap:
        return text[:cap.end()] + f"\nbudget-spent: {cost}" + text[cap.end():]
    raise ValueError("note declares no `budget:` -- not a pool, cannot debit")
