"""Currency layer -- schema + config for the anti-drift compile passes.

North star: stop memory drift across multiple users / multiple agents. An agent
must open its mouth on *compiled current-truth with staleness markers*, never on
one expired snapshot.

This module is the schema landing for that layer. It is purely additive and
zero-dependency -- it does not change any existing compile behaviour. It layers
five verifiable-currency fields on top of the existing AI-Output convention
(see docs/ai-output-convention.md) and REUSES that convention's `status` field
(draft | reviewed | stale | superseded) for review/lifecycle state. No new
status vocabulary -- build-on-existing, not a second stove.

New frontmatter fields (kebab-case, matching the AI-Output convention):

    entity:        grouping key for supersession (e.g. k-atana/iii)
    type:          fact | decision | note  -- drives the stale threshold
    source:        verifiable pointer -- commit:<sha> | path:<rel> | test:<id> | url:<...>
                   (empty / unparseable -> UNSUPPORTED)
    last-verified: ISO date the claim was last checked against its source
    supersedes:    path / id of the note this one tops

Review state reuses the existing `status` field: draft == unreviewed,
reviewed == human-vetted. The derived `stale` / `superseded` markers reuse the
existing status values too; the compile passes that *apply* them live in Task 2.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# --- new frontmatter field names -------------------------------------------

F_ENTITY = "entity"
F_TYPE = "type"
F_SOURCE = "source"
F_LAST_VERIFIED = "last-verified"
F_SUPERSEDES = "supersedes"
F_STATUS = "status"  # reused from the AI-Output convention, not introduced here
F_OWNER = "owner"    # Task 7B: optional -- who is responsible for an action
F_DUE = "due"        # Task 7B: optional ISO date -- action deadline


# --- note types (drive the stale threshold) --------------------------------

TYPE_FACT = "fact"
TYPE_DECISION = "decision"
TYPE_NOTE = "note"
TYPE_PROJECT = "project"  # Task 7A: a project's status is a high-drift entity
VALID_TYPES = frozenset({TYPE_FACT, TYPE_DECISION, TYPE_NOTE, TYPE_PROJECT})
TYPE_DEFAULT = TYPE_NOTE


# --- currency markers (derived; reuse existing status words where they exist)

MARK_OK = "OK"
MARK_STALE = "STALE"
MARK_UNSUPPORTED = "UNSUPPORTED"
MARK_SUPERSEDED = "SUPERSEDED"


# --- CONFIG (defaults; tunable -- §3 of the build brief) -------------------
# Stale threshold per note type, in days. A decision rots faster than a fact.
STALE_THRESHOLD_DAYS = {
    TYPE_DECISION: 14,
    TYPE_FACT: 90,
    TYPE_NOTE: 90,
    TYPE_PROJECT: 30,  # Task 7A: an active project untouched 30d -> "still real?"
}
DEFAULT_STALE_THRESHOLD_DAYS = 90

# Task 7A: a project in a terminal status is done, not drifting -- its age is
# expected, so the staleness guard never flags it. Ongoing statuses
# (active / paused / planned / ...) still age out at the project threshold.
PROJECT_TERMINAL_STATUSES = frozenset({"completed", "archived"})


def is_terminal_project_status(status) -> bool:
    return bool(status) and str(status).strip().lower() in PROJECT_TERMINAL_STATUSES


# Task 7B: action lifecycle (on sub-entities project/<slug>/action/<name>).
# A done/cancelled action drops out of the open list (its open note is superseded
# and surfaced in _supersession.md, not deleted). A blocked action is surfaced
# under Blockers. Everything else is an open action.
ACTION_DONE_STATUSES = frozenset({"done", "completed", "cancelled", "canceled", "closed"})
ACTION_BLOCKED_STATUS = "blocked"

# source pointer schemes that count as "verifiable". Anything else -> UNSUPPORTED.
SOURCE_SCHEMES = ("commit:", "path:", "test:", "url:")


# --- Task 8A: work-state contract (PR1) ------------------------------------
#
# Two independent axes (Linear-style, §1): the workflow axis `state` is distinct
# from the review axis `status`. This block lands the *state contract* only --
# canonical states, legacy mapping, priority/due validation, and the assignee
# (actor identity) resolver. It is purely additive: it adds new constants and
# functions and does NOT touch current-truth selection, ranking, persona, or the
# currency score algorithm (§0 #6). No view/render output is produced here (PR1
# does not touch any view -- that is PR5/8B).

# New frontmatter field names for the work axis (kebab-case, §1).
F_STATE = "state"            # workflow axis: backlog|todo|in-progress|done|canceled
F_LEGACY_STATUS = "status"   # legacy work notes used `status` for both axes
F_ASSIGNEE = "assignee"      # work identity (who is responsible) -- NOT generated-by
F_PRIORITY = "priority"      # 0 none | 1 urgent | 2 high | 3 medium | 4 low
F_ESTIMATE = "estimate"      # story points, optional
F_GENERATED_BY = "generated-by"  # provenance identity (who wrote it) != assignee

# The 5 canonical persisted work states. `blocked` is NOT persisted: it is a
# derived effective_state computed later (8C) from real `blocked-by` relations,
# so writers must never write it. New notes use these 5; old notes are mapped in
# via work_state().
STATE_BACKLOG = "backlog"
STATE_TODO = "todo"
STATE_IN_PROGRESS = "in-progress"
STATE_DONE = "done"
STATE_CANCELED = "canceled"
CANONICAL_STATES = frozenset({
    STATE_BACKLOG, STATE_TODO, STATE_IN_PROGRESS, STATE_DONE, STATE_CANCELED,
})
DEFAULT_STATE = STATE_BACKLOG

# Derived (never persisted) effective-state value, computed in 8C from real
# blocked-by relations. Surfaced here only so callers share one spelling.
STATE_BLOCKED = "blocked"

# Legacy `status`/`state` words -> canonical state (§1 back-compat). Already-
# canonical inputs pass straight through (they are in CANONICAL_STATES). The
# legacy `blocked` word maps to in-progress + a legacy_blocked flag (handled in
# work_state); old notes need no edit, new notes must use blocked-by for real
# blocking.
_LEGACY_STATE_MAP = {
    "open": STATE_TODO,
    "in progress": STATE_IN_PROGRESS,
    "in_progress": STATE_IN_PROGRESS,
    "completed": STATE_DONE,
    "done": STATE_DONE,
    "cancelled": STATE_CANCELED,
    "canceled": STATE_CANCELED,
    "archived": STATE_CANCELED,
    # legacy `closed` was a done-word in ACTION_DONE_STATUSES (Task 7); keep
    # parity so a `status: closed` action still counts as done under work_state.
    "closed": STATE_DONE,
    # project lifecycle words (type: project) -> work state
    "active": STATE_IN_PROGRESS,
    "paused": STATE_TODO,
    "planned": STATE_BACKLOG,
}

# The legacy `status: blocked` word -> in-progress + legacy_blocked flag.
LEGACY_BLOCKED_WORD = "blocked"

# A sentinel returned by resolve_assignee when no assignee can be determined.
UNASSIGNED = "UNASSIGNED"


def work_state(cm) -> str:
    """Map any note's `state` (or legacy `status`) to one of the 5 canonical
    work states. `cm` is a CurrencyMeta (or any object/dict exposing the raw
    frontmatter). Resolution order, per §1:

      1. explicit `state` (canonical -> pass through; legacy word -> mapped)
      2. legacy `status` word, mapped via the back-compat table
      3. DEFAULT_STATE (backlog) when neither is present/recognized

    The legacy `blocked` word is NOT a canonical state: it maps to in-progress
    (real blocking is expressed via blocked-by; see legacy_blocked()).
    """
    raw = _work_raw(cm)
    # explicit state field wins
    s = _scalar(raw, F_STATE)
    mapped = _map_state_word(s)
    if mapped is not None:
        return mapped
    # fall back to the legacy combined `status` field
    legacy = _scalar(raw, F_LEGACY_STATUS)
    mapped = _map_state_word(legacy)
    if mapped is not None:
        return mapped
    return DEFAULT_STATE


def _map_state_word(word: Optional[str]) -> Optional[str]:
    """Map a single raw word to a canonical state, or None if it carries no
    work-state signal. Already-canonical words pass through. `blocked` maps to
    in-progress (the legacy_blocked flag is surfaced separately)."""
    if not word:
        return None
    w = word.strip().lower()
    if not w:
        return None
    if w in CANONICAL_STATES:
        return w
    if w == LEGACY_BLOCKED_WORD:
        return STATE_IN_PROGRESS
    return _LEGACY_STATE_MAP.get(w)


def legacy_blocked(cm) -> bool:
    """True when the note carries a legacy `status: blocked` (or `state: blocked`)
    word AND does not already declare a canonical state that overrides it. Such a
    note canonicalizes to in-progress; the Blockers view (7B/8C) surfaces it as
    `[LEGACY-BLOCKED:NO-RELATION]` so old notes need zero edits while new notes
    must express real blocking via blocked-by."""
    raw = _work_raw(cm)
    s = _scalar(raw, F_STATE)
    if s is not None:
        # an explicit, recognized canonical state overrides a legacy blocked word
        if s.strip().lower() in CANONICAL_STATES:
            return False
        return s.strip().lower() == LEGACY_BLOCKED_WORD
    legacy = _scalar(raw, F_LEGACY_STATUS)
    return bool(legacy) and legacy.strip().lower() == LEGACY_BLOCKED_WORD


# --- priority / due validation ---------------------------------------------
#
# priority: 0 none | 1 urgent | 2 high | 3 medium | 4 low. Sort rank puts urgent
# first, then high/medium/low, with `none`/missing last. is_urgent is STRICTLY
# priority == 1 (never <= 1), so `0` (none) is not urgent (§3 P0 #5, 8B).
PRIORITY_RANK = {1: 0, 2: 1, 3: 2, 4: 3, 0: 4, None: 4}
VALID_PRIORITIES = frozenset({0, 1, 2, 3, 4})
URGENT_PRIORITY = 1


def work_priority(cm) -> Optional[int]:
    """Read `priority` as an int in 0..4, or None when absent/unparseable/out of
    range. Never raises -- an old note with no priority is just None (-> ranked
    last via PRIORITY_RANK[None])."""
    raw = _work_raw(cm)
    v = raw.get(F_PRIORITY)
    if isinstance(v, bool):  # guard: bool is an int subclass
        return None
    if isinstance(v, int):
        return v if v in VALID_PRIORITIES else None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
        try:
            n = int(v)
        except ValueError:
            return None
        return n if n in VALID_PRIORITIES else None
    return None


def priority_rank(cm) -> int:
    """Sort rank for a note's priority -- lower sorts first. Missing/invalid
    priority ranks alongside `none` (last)."""
    return PRIORITY_RANK.get(work_priority(cm), PRIORITY_RANK[None])


def is_urgent(cm) -> bool:
    """Urgent IFF priority == 1, strictly (never <= 1). priority 0 (none) is not
    urgent; absent priority is not urgent (§3 P0 #5)."""
    return work_priority(cm) == URGENT_PRIORITY


def work_estimate(cm) -> Optional[int]:
    """Read `estimate` (story points) as a non-negative int, or None when absent/
    unparseable/negative. Never raises -- a note with no estimate is just None and
    is ignored by the 8B per-project estimate rollup. Booleans are rejected (bool
    is an int subclass) to mirror work_priority's guard."""
    raw = _work_raw(cm)
    v = raw.get(F_ESTIMATE)
    if isinstance(v, bool):  # guard: bool is an int subclass
        return None
    if isinstance(v, int):
        return v if v >= 0 else None
    if isinstance(v, str):
        v = v.strip()
        if not v:
            return None
        try:
            n = int(v)
        except ValueError:
            return None
        return n if n >= 0 else None
    return None


def parse_due(cm) -> "Optional[object]":
    """Parse the `due` field to a datetime.date, or None when absent/unparseable.
    Reused by the overdue check (8B); kept here so the state contract owns due
    validation. Returns a date object (import-local to keep the module's import
    surface unchanged for callers that only need states)."""
    raw = _work_raw(cm)
    d = _scalar(raw, F_DUE)
    if not d:
        return None
    from datetime import date as _date
    try:
        return _date.fromisoformat(d.strip())
    except (ValueError, AttributeError):
        return None


# --- assignee (actor identity) resolver ------------------------------------


def resolve_assignee(cm, config: Optional[dict] = None) -> str:
    """Resolve the work assignee (who is responsible), per §1.

    Precedence:
      1. explicit `assignee`
      2. `owner` (back-compat alias for assignee on older notes)
      3. config `writer-actors` map applied to `generated-by`
         (e.g. {'au-90-opus': 'agent/opus'}) -- a stable actor so an agent that
         changes machines does not produce two assignees
      4. UNASSIGNED

    NEVER derives the assignee from `generated-by` directly -- only through the
    explicit writer-actors mapping (§1: the actor is who is responsible, not who
    happened to write the note). The writer-actors map exists precisely so the
    mapping is intentional, not a silent generated-by leak.
    """
    raw = _work_raw(cm)
    assignee = _scalar(raw, F_ASSIGNEE)
    if assignee:
        return assignee
    owner = _scalar(raw, F_OWNER)
    if owner:
        return owner
    actors = (config or {}).get("writer-actors") or {}
    gen = _scalar(raw, F_GENERATED_BY)
    if gen and gen in actors:
        mapped = actors[gen]
        if mapped:
            return str(mapped)
    return UNASSIGNED


def assignee_warning(cm) -> Optional[str]:
    """Return a schema warning when both `assignee` and `owner` are present and
    differ (the note declares two conflicting work identities), else None.

    Writers should write only `assignee`; `owner` is the legacy alias. When both
    exist and agree there is no conflict. resolve_assignee still prefers assignee,
    so the resolved value is deterministic regardless -- this surfaces the
    ambiguity for triage."""
    raw = _work_raw(cm)
    assignee = _scalar(raw, F_ASSIGNEE)
    owner = _scalar(raw, F_OWNER)
    if assignee and owner and assignee != owner:
        return (
            f"assignee/owner conflict: assignee={assignee!r} owner={owner!r} "
            f"(write only assignee; resolved to assignee)"
        )
    return None


def _work_raw(cm) -> dict:
    """Accept either a CurrencyMeta (use its .raw frontmatter) or a plain dict,
    so the work-state helpers work on both normalize()d notes and bare
    frontmatter. Returns {} for anything else (never raises)."""
    if isinstance(cm, dict):
        return cm
    raw = getattr(cm, "raw", None)
    if isinstance(raw, dict):
        return raw
    return {}


@dataclass
class CurrencyMeta:
    """Normalized currency view of a note's frontmatter. Never raises on
    missing fields -- absent values become None / safe defaults so old notes
    keep compiling."""

    entity: Optional[str]
    type: str
    source: Optional[str]
    last_verified: Optional[str]
    supersedes: Optional[str]
    status: Optional[str]
    owner: Optional[str] = None
    due: Optional[str] = None
    raw: dict = field(default_factory=dict)

    @property
    def has_source(self) -> bool:
        return bool(self.source) and self.source.strip() != ""

    @property
    def source_scheme(self) -> Optional[str]:
        """Return the verifiable scheme (without colon) or None if the source
        is empty / not one of the known schemes -> caller treats as UNSUPPORTED."""
        if not self.has_source:
            return None
        for scheme in SOURCE_SCHEMES:
            if self.source.startswith(scheme):
                return scheme[:-1]
        return None

    @property
    def source_target(self) -> Optional[str]:
        """The part after the scheme, e.g. 'path:raw/x.md' -> 'raw/x.md'."""
        scheme = self.source_scheme
        if scheme is None:
            return None
        return self.source[len(scheme) + 1:].strip() or None


def _scalar(fm: dict, key: str) -> Optional[str]:
    """Read a frontmatter value as a trimmed scalar string, or None.

    The robust parser (_md_parse.parse_frontmatter) turns an empty `key:` into
    [] and a list value into a list; for these single-value currency fields we
    collapse anything non-scalar / empty to None."""
    v = fm.get(key)
    if isinstance(v, str):
        v = v.strip()
        return v or None
    if isinstance(v, list):
        return None
    return None if v is None else str(v)


def normalize(fm: dict) -> CurrencyMeta:
    """Apply safe defaults to a parsed-frontmatter dict. Missing/garbage type
    falls back to `note`; everything else falls back to None."""
    t = _scalar(fm, F_TYPE) or TYPE_DEFAULT
    if t not in VALID_TYPES:
        t = TYPE_DEFAULT
    return CurrencyMeta(
        entity=_scalar(fm, F_ENTITY),
        type=t,
        source=_scalar(fm, F_SOURCE),
        last_verified=_scalar(fm, F_LAST_VERIFIED),
        supersedes=_scalar(fm, F_SUPERSEDES),
        status=_scalar(fm, F_STATUS),
        owner=_scalar(fm, F_OWNER),
        due=_scalar(fm, F_DUE),
        raw=dict(fm),
    )


def stale_threshold_days(note_type: str) -> int:
    return STALE_THRESHOLD_DAYS.get(note_type, DEFAULT_STALE_THRESHOLD_DAYS)
