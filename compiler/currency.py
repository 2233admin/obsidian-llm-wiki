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


# --- note types (drive the stale threshold) --------------------------------

TYPE_FACT = "fact"
TYPE_DECISION = "decision"
TYPE_NOTE = "note"
VALID_TYPES = frozenset({TYPE_FACT, TYPE_DECISION, TYPE_NOTE})
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
}
DEFAULT_STALE_THRESHOLD_DAYS = 90

# source pointer schemes that count as "verifiable". Anything else -> UNSUPPORTED.
SOURCE_SCHEMES = ("commit:", "path:", "test:", "url:")


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
        raw=dict(fm),
    )


def stale_threshold_days(note_type: str) -> int:
    return STALE_THRESHOLD_DAYS.get(note_type, DEFAULT_STALE_THRESHOLD_DAYS)
