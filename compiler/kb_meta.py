#!/usr/bin/env python3
"""KB metadata engine -- zero-dependency CLI for knowledge base management.

Usage:
    python kb_meta.py init <vault> <topic>
    python kb_meta.py diff <vault> <topic>
    python kb_meta.py update-hash <vault> <topic> <file>
    python kb_meta.py update-index <vault> <topic>
    python kb_meta.py check-links <vault> <topic>
    python kb_meta.py vitality <vault> <topic>
    python kb_meta.py log-access <vault> <topic> <article>
    python kb_meta.py currency <vault> <topic> [--today YYYY-MM-DD] [--apply]

All commands output JSON to stdout for machine consumption.
"""

import hashlib
import json
import os
import re
import sys
from datetime import date, datetime
from pathlib import Path

# Currency layer (Task 1 schema landing) + robust frontmatter parser.
# These live next to this file; import works whether kb_meta.py is invoked as a
# script (cwd-relative) or imported as a module from compiler/.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import currency as _currency  # noqa: E402
import work_protocol as _work_protocol  # noqa: E402
from _md_parse import parse_frontmatter as robust_parse_frontmatter  # noqa: E402


def meta_path(vault: str, topic: str) -> Path:
    return Path(vault) / topic / "_meta.json"


def load_meta(vault: str, topic: str) -> dict:
    p = meta_path(vault, topic)
    if p.exists():
        return json.loads(p.read_text("utf-8-sig"))
    return {"topic": topic, "created": today(), "sources": {}, "access_log": {}}


def save_meta(vault: str, topic: str, meta: dict) -> None:
    p = meta_path(vault, topic)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(meta, indent=2, ensure_ascii=False), "utf-8")
        tmp.replace(p)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def now_iso() -> str:
    from datetime import timezone
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def file_hash(path: Path) -> str:
    h = hashlib.blake2b(digest_size=8)
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_frontmatter(text: str) -> dict:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    fm = {}
    for line in text[4:end].split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        colon = line.find(":")
        if colon == -1:
            continue
        key = line[:colon].strip()
        val = line[colon + 1:].strip()
        if val.startswith('"') and val.endswith('"'):
            val = val[1:-1]
        elif val.startswith("'") and val.endswith("'"):
            val = val[1:-1]
        fm[key] = val
    return fm


def extract_wikilinks(text: str) -> list[str]:
    pattern = r"\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]"
    return [
        m.group(1).split("#")[0].strip()
        for m in re.finditer(pattern, text)
        if not m.group(1).strip().startswith("#")
    ]


def walk_md(base: Path) -> list[Path]:
    results = []
    for root, dirs, files in os.walk(base):
        skip = (".obsidian", "node_modules", ".git", "schema", ".trash")
        dirs[:] = sorted(
            d for d in dirs if d not in skip and not d.startswith("_")
        )
        for f in sorted(files):
            if f.endswith(".md"):
                results.append(Path(root) / f)
    results.sort()
    return results


# --- Commands ---

def cmd_init(vault: str, topic: str) -> dict:
    meta = load_meta(vault, topic)
    if "created" not in meta:
        meta["created"] = today()
    if "sources" not in meta:
        meta["sources"] = {}
    if "access_log" not in meta:
        meta["access_log"] = {}
    save_meta(vault, topic, meta)
    return {"ok": True, "topic": topic, "meta_path": str(meta_path(vault, topic))}


def cmd_diff(vault: str, topic: str) -> dict:
    meta = load_meta(vault, topic)
    raw_dir = Path(vault) / topic / "raw"
    if not raw_dir.exists():
        return {"new": [], "changed": [], "deleted": [], "unchanged": []}

    current_files = {}
    for f in walk_md(raw_dir):
        rel = f.relative_to(Path(vault) / topic).as_posix()
        current_files[rel] = file_hash(f)

    known = meta.get("sources", {})
    new, changed, unchanged = [], [], []
    for rel, h in sorted(current_files.items()):
        if rel not in known:
            new.append(rel)
        elif known[rel].get("hash") != h:
            changed.append(rel)
        else:
            unchanged.append(rel)

    deleted = [r for r in sorted(known) if r not in current_files]

    return {"new": new, "changed": changed, "deleted": deleted, "unchanged": unchanged}


def cmd_update_hash(vault: str, topic: str, file_rel: str) -> dict:
    file_rel = Path(file_rel).as_posix()
    meta = load_meta(vault, topic)
    full = Path(vault) / topic / file_rel
    if not full.exists():
        return {"error": f"File not found: {file_rel}"}
    h = file_hash(full)
    meta.setdefault("sources", {})[file_rel] = {
        "hash": h,
        "compiled_at": now_iso(),
    }
    save_meta(vault, topic, meta)
    return {"ok": True, "file": file_rel, "hash": h}


def cmd_update_index(vault: str, topic: str) -> dict:
    base = Path(vault) / topic
    wiki = base / "wiki"
    if not wiki.exists():
        return {"error": "wiki/ directory not found"}

    def scan_dir(subdir: str) -> list[dict]:
        d = wiki / subdir
        if not d.exists():
            return []
        rows = []
        for f in sorted(d.iterdir()):
            if not f.name.endswith(".md") or f.name.startswith("_"):
                continue
            text = f.read_text("utf-8-sig", errors="replace")
            # extract first non-heading, non-frontmatter paragraph as one-liner
            lines = text.split("\n")
            one_liner = ""
            in_fm = False
            for line in lines:
                if line.strip() == "---":
                    in_fm = not in_fm
                    continue
                if in_fm:
                    continue
                if line.startswith("#"):
                    continue
                stripped = line.strip()
                if stripped:
                    one_liner = stripped[:150]
                    break
            rows.append({
                "file": f"{subdir}/{f.stem}",
                "one_liner": one_liner,
            })
        return rows

    summaries = scan_dir("summaries")
    concepts = scan_dir("concepts")
    queries = scan_dir("queries")

    # count raw sources
    raw_dir = base / "raw"
    source_count = len(walk_md(raw_dir)) if raw_dir.exists() else 0

    # build index content
    def table_rows(items):
        return "\n".join(f"| [[{r['file']}]] | {r['one_liner']} |" for r in items) if items else ""

    index_content = (
        f"# {topic} Knowledge Base\n\n"
        f"> Auto-maintained index. Do not edit manually.\n"
        f"> Sources: {source_count} | Articles: {len(summaries)}"
        f" | Concepts: {len(concepts)}"
        f" | Last compiled: {today()}\n\n"
        f"## Summaries\n| File | One-liner |\n|------|-----------|\n{table_rows(summaries)}\n\n"
        f"## Concepts\n| File | One-liner |\n|------|-----------|\n{table_rows(concepts)}\n\n"
        f"## Queries\n| File | One-liner |\n|------|-----------|\n{table_rows(queries)}\n"
    )

    # --- ADDITIVE: entities/ scan + STALE/UNSUPPORTED visibility (Task 2) ----
    # Appended AFTER the existing sections so the Summaries/Concepts/Queries
    # blocks above stay byte-identical. The Entities section appears only when
    # an entities/ dir exists with notes; the Stale / Unsupported sections appear
    # only when the currency passes find entries. When nothing is stale/
    # unsupported and there is no entities/ dir, the output is unchanged.
    entities = scan_dir("entities")
    extra = ""
    if entities:
        extra += (
            f"\n## Entities\n| File | One-liner |\n|------|-----------|\n"
            f"{table_rows(entities)}\n"
        )

    stale_rows: list[str] = []
    unsupported_rows: list[str] = []
    try:
        cur = cmd_currency(vault, topic, apply=False)
        for entity, info in sorted(cur.get("entities", {}).items()):
            reason = "; ".join(info.get("reasons", []))
            cell = f"| {entity} | {info['note_id']} | {reason} |"
            if "STALE" in info.get("marker", ""):
                stale_rows.append(cell)
            if "UNSUPPORTED" in info.get("marker", ""):
                unsupported_rows.append(cell)
    except Exception:
        pass  # currency passes are additive; never break the base index.

    if stale_rows:
        extra += (
            "\n## Stale\n| Entity | Note | Reason |\n|--------|------|--------|\n"
            + "\n".join(stale_rows) + "\n"
        )
    if unsupported_rows:
        extra += (
            "\n## Unsupported\n| Entity | Note | Reason |\n|--------|------|--------|\n"
            + "\n".join(unsupported_rows) + "\n"
        )

    index_content = index_content + extra

    index_path = wiki / "_index.md"
    tmp = index_path.with_suffix(".tmp")
    try:
        tmp.write_text(index_content, "utf-8")
        tmp.replace(index_path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise

    return {
        "ok": True,
        "summaries": len(summaries),
        "concepts": len(concepts),
        "queries": len(queries),
        "source_count": source_count,
    }


def cmd_check_links(vault: str, topic: str) -> dict:
    base = Path(vault) / topic
    wiki = base / "wiki"
    if not wiki.exists():
        return {"broken": [], "total_links": 0}

    broken = []
    total = 0
    # pre-collect wiki subdirs once (avoid re-scanning per link)
    wiki_subdirs = [d for d in wiki.iterdir() if d.is_dir() and not d.name.startswith("_")]
    for f in walk_md(wiki):
        text = f.read_text("utf-8-sig", errors="replace")
        links = extract_wikilinks(text)
        rel_from = f.relative_to(base).as_posix()
        for link in links:
            total += 1
            candidates = [
                base / link,
                base / (link + ".md"),
                wiki / link,
                wiki / (link + ".md"),
            ]
            for subdir in wiki_subdirs:
                candidates.append(subdir / link)
                candidates.append(subdir / (link + ".md"))
            if not any(c.exists() for c in candidates):
                broken.append({"from": rel_from, "to": link})

    return {"broken": broken, "total_links": total}


def cmd_vitality(vault: str, topic: str) -> dict:
    meta = load_meta(vault, topic)
    base = Path(vault) / topic / "wiki"
    if not base.exists():
        return {"accessed": [], "never_accessed": [], "total": 0}

    access_log = meta.get("access_log", {})
    accessed, never_accessed = [], []

    for f in walk_md(base):
        if f.name.startswith("_"):
            continue
        rel = f.relative_to(Path(vault) / topic).as_posix()
        if rel not in access_log:
            never_accessed.append(rel)
        else:
            last = access_log[rel].get("last_access", "")
            count = access_log[rel].get("count", 0)
            accessed.append({"path": rel, "last_access": last, "count": count})

    # sort accessed by last_access ascending (oldest = most stale first)
    accessed.sort(key=lambda x: x["last_access"])

    return {
        "accessed": accessed,
        "never_accessed": sorted(never_accessed),
        "total": len(accessed) + len(never_accessed),
    }


def cmd_log_access(vault: str, topic: str, article: str) -> dict:
    meta = load_meta(vault, topic)
    log = meta.setdefault("access_log", {})
    entry = log.setdefault(article, {"count": 0})
    entry["count"] = entry.get("count", 0) + 1
    entry["last_access"] = now_iso()
    save_meta(vault, topic, meta)
    return {"ok": True, "article": article, "count": entry["count"]}


# --- Currency passes (Task 2): supersession / staleness / unsupported -------
#
# Three derived passes that run AFTER the existing compile. NO LLM, NO network,
# NO git probe. They read note frontmatter via the robust parser, normalize via
# currency.py, and emit DERIVED, recomputable, gitignored artifacts. Source
# notes are NEVER mutated -- markers live only in the derived view/log.

# Derived output filenames (gitignored, recomputed every run).
CURRENT_TRUTH_FILE = "_current-truth.md"
SUPERSESSION_FILE = "_supersession.md"
# Machine-readable report consumed by the Node connector (Task 3). byNote maps a
# vault-root-relative note_id -> its currency verdict, so vault.search/read can
# inline markers without recomputing anything on the Node side.
CURRENCY_REPORT_FILE = "_currency.json"
# Task 7B: per-project current-truth view (DERIVED). Compiled from the entity
# graph: a `type: project` entity plus its project/<slug>/... actions & decisions.
PROJECT_STATUS_FILE = "_project-status.md"

# A sentinel that sorts BEFORE every real ISO date, so a missing last-verified
# is treated as "infinitely old" and loses every recency comparison.
_OLDEST_DATE = ""


class CurrencyNote:
    """A scanned note carrying its normalized currency metadata + location.

    note_id is the POSIX path relative to the vault root (stable, location-aware
    so wiki/ and 00-Inbox/ notes for the same entity coexist in one group)."""

    __slots__ = ("note_id", "path", "cm", "body_first_line", "markers", "reasons")

    def __init__(self, note_id: str, path: Path, cm, body_first_line: str) -> None:
        self.note_id = note_id
        self.path = path
        self.cm = cm
        self.body_first_line = body_first_line
        self.markers: list[str] = []
        self.reasons: list[str] = []

    @property
    def sort_key(self):
        # Recency: higher last_verified wins. Tiebreak: reviewed > draft >
        # missing, then alphabetical note_id (stable). Negate via tuple order in
        # the caller; here we expose comparable parts.
        lv = self.cm.last_verified or _OLDEST_DATE
        status_rank = {"reviewed": 2, "draft": 1}.get(self.cm.status or "", 0)
        return (lv, status_rank, self.note_id)


def _first_body_line(text: str) -> str:
    """First non-empty, non-frontmatter, non-heading line of a note body."""
    body = text
    m = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", text, re.DOTALL)
    if m:
        body = text[m.end():]
    for line in body.splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            return s[:200]
    return ""


# Task 7A: vault-global work-state folders also scanned for entity-bearing notes
# (project / decision / meeting-action), so project status drift is visible.
# Configurable; absent folders are skipped. Only notes carrying `entity` are kept.
WORK_DIRS = ("Projects", "Decisions", "Meetings")


def _scan_entity_notes(vault: str, topic: str) -> list[CurrencyNote]:
    """Scan <topic>/wiki/**, <vault>/00-Inbox/**, and the vault-global work
    folders (WORK_DIRS) for notes carrying an `entity` field. Returns notes
    sorted by note_id for deterministic output."""
    vault_root = Path(vault)
    roots = [vault_root / topic / "wiki", vault_root / "00-Inbox"]
    roots += [vault_root / d for d in WORK_DIRS]
    notes: list[CurrencyNote] = []
    seen: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        for f in walk_md(root):
            note_id = f.relative_to(vault_root).as_posix()
            if note_id in seen:
                continue
            try:
                text = f.read_text("utf-8-sig", errors="replace")
            except OSError:
                continue
            fm = robust_parse_frontmatter(text)
            cm = _currency.normalize(fm)
            if not cm.entity:
                continue
            seen.add(note_id)
            notes.append(CurrencyNote(note_id, f, cm, _first_body_line(text)))
    notes.sort(key=lambda n: n.note_id)
    return notes


def _resolve_supersedes(target: str, group: list[CurrencyNote]) -> CurrencyNote | None:
    """Resolve a `supersedes` pointer to a note in this entity's group.

    Tries, in order: exact note_id, posix-normalized match, filename-stem match.
    Returns None if the pointer is dangling / external (logged by caller)."""
    if not target:
        return None
    t = target.strip().replace("\\", "/")
    for n in group:
        if n.note_id == t:
            return n
    # tolerate leading ./ or differing prefixes -> suffix match
    for n in group:
        if n.note_id.endswith("/" + t) or n.note_id == t.lstrip("./"):
            return n
    # filename / stem match (e.g. supersedes: iii.md or iii)
    t_stem = Path(t).name
    t_stem_noext = t_stem[:-3] if t_stem.endswith(".md") else t_stem
    for n in group:
        if n.path.name == t_stem or n.path.stem == t_stem_noext:
            return n
    return None


def _pass1_supersession(notes: list[CurrencyNote]) -> tuple[dict, list, list]:
    """Group by entity; select current-truth; mark the rest SUPERSEDED.

    Returns (current_truth_by_entity, superseded_records, warnings).
    superseded_records: list of dicts {entity, note_id, topped_by, reason,
    status, last_verified, body}. current_truth_by_entity: entity -> CurrencyNote.
    """
    groups: dict[str, list[CurrencyNote]] = {}
    for n in notes:
        groups.setdefault(n.cm.entity, []).append(n)

    current_truth: dict[str, CurrencyNote] = {}
    superseded: list[dict] = []
    warnings: list[str] = []

    for entity in sorted(groups):
        group = sorted(groups[entity], key=lambda n: n.note_id)

        # Task 8P (P0-2): the authoritative work index never selects a `status:
        # draft` capture as current-truth. A draft is a candidate proposal (it
        # lives in _triage), so when an entity also has an authoritative note
        # (reviewed snapshot or legacy work/knowledge note) the drafts are
        # quarantined here -- the head is chosen ONLY among authoritative notes,
        # so a draft `state:done` can never become current-truth or move the
        # _pass4 open/closed count. Guard: if EVERY note in the group is a draft
        # (a never-reviewed knowledge note), keep the group intact so the generic
        # currency / STALE / UNSUPPORTED passes are unchanged (§0 #8 regression).
        authoritative = [n for n in group
                         if _work_protocol.is_authoritative_work_note(n.cm)]
        if authoritative:
            group = authoritative

        # Build explicit supersession map: superseded_note -> topping note.
        superseded_by: dict[str, CurrencyNote] = {}
        for n in group:
            tgt = n.cm.supersedes
            if not tgt:
                continue
            victim = _resolve_supersedes(tgt, group)
            if victim is None:
                warnings.append(
                    f"{entity}: {n.note_id} supersedes dangling target '{tgt}'"
                )
                continue
            if victim.note_id == n.note_id:
                continue  # self-reference, ignore
            superseded_by[victim.note_id] = n

        # Detect circular supersession; fall back to recency for the whole group.
        circular = False
        for vid, topper in superseded_by.items():
            if topper.note_id in superseded_by and superseded_by[topper.note_id].note_id == vid:
                circular = True
                break
        if circular:
            warnings.append(f"{entity}: circular supersedes -> falling back to recency")
            superseded_by = {}

        # Candidates = notes NOT explicitly superseded.
        survivors = [n for n in group if n.note_id not in superseded_by]
        if not survivors:
            # all superseded (cycle/fail-safe) -> use full group by recency
            survivors = group

        # current-truth = highest recency among survivors.
        winner = max(survivors, key=lambda n: n.sort_key)
        current_truth[entity] = winner

        # Everything that is not the winner is superseded (explicit or recency).
        for n in group:
            if n.note_id == winner.note_id:
                continue
            topper = superseded_by.get(n.note_id)
            if topper is not None:
                reason = f"explicitly by {topper.note_id}"
                topped_by = topper.note_id
            else:
                reason = f"recency (current-truth verified {winner.cm.last_verified or '?'})"
                topped_by = winner.note_id
            n.markers.append(_currency.MARK_SUPERSEDED)
            n.reasons.append(reason)
            superseded.append({
                "entity": entity,
                "note_id": n.note_id,
                "topped_by": topped_by,
                "reason": reason,
                "status": n.cm.status,
                "last_verified": n.cm.last_verified,
                "body": n.body_first_line,
            })

    return current_truth, superseded, warnings


def _parse_iso(d: str | None):
    if not d:
        return None
    try:
        return date.fromisoformat(d.strip())
    except (ValueError, AttributeError):
        return None


def _pass2_3_stale_unsupported(
    vault: str, topic: str, current_truth: dict, meta: dict, today_date: date,
) -> None:
    """On each current-truth note: PASS 3 (unsupported) then PASS 2 (staleness).

    Mutates each note's markers/reasons in place. Order per the brief: a note
    that is UNSUPPORTED skips the staleness check; a note with a valid source is
    checked for STALE via hash-change first, then age."""
    sources = meta.get("sources", {})
    topic_root = Path(vault) / topic

    for entity in sorted(current_truth):
        n = current_truth[entity]
        cm = n.cm

        # PASS 3: unsupported.
        if not cm.has_source:
            # Task 7C: a project is anchored by its own activity, not a commit --
            # an empty source is not "unsupported"; fall through to age-staleness.
            if cm.type != _currency.TYPE_PROJECT:
                n.markers.append(_currency.MARK_UNSUPPORTED)
                n.reasons.append("source field is empty")
                continue
        elif cm.source_scheme is None:
            n.markers.append(_currency.MARK_UNSUPPORTED)
            n.reasons.append(f"unrecognized source scheme: {cm.source!r}")
            continue

        # PASS 2: staleness. Hash-change signal first (path: scheme only).
        stale = False
        reason = ""
        if cm.source_scheme == "path":
            target_rel = cm.source_target or ""
            # normalize to topic-relative rel key used in _meta.json sources.
            rel_key = target_rel
            if rel_key.startswith(topic + "/"):
                rel_key = rel_key[len(topic) + 1:]
            target_path = topic_root / rel_key
            if not target_path.exists():
                stale, reason = True, f"source path unreachable: {target_rel}"
            else:
                recorded = sources.get(rel_key, {}).get("hash")
                if recorded is None:
                    stale, reason = True, f"source hash never recorded: {target_rel}"
                else:
                    current_hash = file_hash(target_path)
                    if current_hash != recorded:
                        stale, reason = True, f"source changed: {target_rel}"

        # Age signal (all schemes) -- only if not already stale by hash.
        if not stale:
            lv = _parse_iso(cm.last_verified)
            threshold = _currency.stale_threshold_days(cm.type)
            # Task 7A: a project in a terminal status (completed/archived) is
            # done, not drifting -- its age is expected, so skip age-staleness.
            project_terminal = (
                cm.type == _currency.TYPE_PROJECT
                and _currency.is_terminal_project_status(cm.status)
            )
            if project_terminal:
                pass
            elif lv is None:
                stale, reason = True, "last-verified missing/unparseable"
            else:
                age_days = (today_date - lv).days
                if age_days > threshold:
                    stale = True
                    reason = f"age {age_days}d > {threshold}d threshold ({cm.type})"

        if stale:
            n.markers.append(_currency.MARK_STALE)
            n.reasons.append(reason)
        else:
            n.markers.append(_currency.MARK_OK)


def _render_current_truth(topic: str, current_truth: dict, today_date: date) -> str:
    """Grep-friendly per-entity current-truth view (DERIVED)."""
    lines = [
        f"# {topic} -- current truth",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Do not edit; do not commit. Markers live here, never in source notes.",
        f"> Compiled: {today_date.isoformat()}",
        "",
    ]
    for entity in sorted(current_truth):
        n = current_truth[entity]
        cm = n.cm
        # markers excluding the bookkeeping OK -> show explicit verdict tags
        verdict = [m for m in n.markers if m != _currency.MARK_OK]
        marker_str = " + ".join(verdict) if verdict else _currency.MARK_OK
        reason_str = "; ".join(n.reasons) if n.reasons else ""
        lines.append(f"## {entity}")
        lines.append(f"- current-truth: {n.body_first_line}")
        lines.append(f"- note: {n.note_id}")
        lines.append(f"- source: {cm.source or '(none)'}")
        lines.append(f"- last-verified: {cm.last_verified or '(none)'}")
        lines.append(f"- status: {cm.status or '(none)'}")
        marker_line = f"- marker: {marker_str}"
        if reason_str:
            marker_line += f" ({reason_str})"
        lines.append(marker_line)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _render_supersession(topic: str, current_truth: dict, superseded: list) -> str:
    """Supersession log (DERIVED): superseded note -> what topped it."""
    lines = [
        f"# {topic} -- supersession log",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Superseded notes are NOT deleted; they are surfaced here only.",
        "",
    ]
    by_entity: dict[str, list[dict]] = {}
    for rec in superseded:
        by_entity.setdefault(rec["entity"], []).append(rec)

    for entity in sorted(by_entity):
        ct = current_truth.get(entity)
        lines.append(f"## {entity}")
        if ct is not None:
            lines.append(
                f"- current-truth: {ct.note_id} "
                f"(verified {ct.cm.last_verified or '?'}, status {ct.cm.status or '?'})"
            )
        lines.append("- superseded:")
        for rec in sorted(by_entity[entity], key=lambda r: r["note_id"]):
            lines.append(
                f"  - {rec['note_id']} -> topped by {rec['topped_by']} "
                f"[{rec['reason']}] (status {rec['status'] or '?'}, "
                f"verified {rec['last_verified'] or '?'}): {rec['body']}"
            )
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def _pass4_project_status(current_truth: dict, today_date: date) -> dict:
    """Task 7B: compile per-project current-truth from the entity graph.

    A project is a `type: project` entity `project/<slug>`; its actions and
    decisions are entities namespaced under `project/<slug>/...`. Reuses the
    current-truth + staleness already computed by passes 1-3 -- the only new
    grouping is the entity-name prefix. Adds no new pass over the source notes.

    Returns project_entity -> {note_id, status, marker, reasons, open_actions,
    blockers, decisions, closed_count}."""
    out: dict = {}
    projects = [e for e in sorted(current_truth)
                if current_truth[e].cm.type == _currency.TYPE_PROJECT]
    for pe in projects:
        pn = current_truth[pe]
        prefix = pe + "/"
        open_actions, blockers, decisions = [], [], []
        closed = 0
        for eid in sorted(current_truth):
            if not eid.startswith(prefix):
                continue
            sn = current_truth[eid]
            # Task 8P/8A contract: classify actions off the canonical WORK axis
            # (currency.work_state), NOT raw cm.status. work_state maps done/
            # completed/canceled/archived -> done|canceled and the legacy
            # `blocked` word -> in-progress + a legacy_blocked flag, so a capture
            # that says "done" via the work axis is counted consistently and a
            # blocked action is detected via legacy_blocked (work_state alone
            # canonicalizes blocked to in-progress). Drafts never reach here --
            # they were quarantined from current-truth selection in
            # _pass1_supersession, so a non-authoritative draft cannot move a count.
            wstate = _currency.work_state(sn.cm)
            entry = {
                "entity": eid,
                "note_id": sn.note_id,
                "body": sn.body_first_line,
                "status": sn.cm.status,
                "owner": sn.cm.owner,
                "due": sn.cm.due,
                "last_verified": sn.cm.last_verified,
            }
            if "/decision/" in eid:
                decisions.append(entry)
                continue
            # everything else under the project is an action
            if _currency.legacy_blocked(sn.cm):
                blockers.append(entry)
            elif wstate in (_currency.STATE_DONE, _currency.STATE_CANCELED):
                closed += 1
            else:
                flags = []
                due_d = _parse_iso(sn.cm.due) if sn.cm.due else None
                if due_d is not None and due_d < today_date:
                    flags.append(f"OVERDUE: due {sn.cm.due}")
                if not sn.cm.owner:
                    flags.append("UNOWNED")
                entry["flags"] = flags
                open_actions.append(entry)
        decisions.sort(key=lambda d: (d["last_verified"] or "", d["entity"]), reverse=True)
        verdict = [m for m in pn.markers if m != _currency.MARK_OK]
        out[pe] = {
            "note_id": pn.note_id,
            "status": pn.cm.status,
            "marker": " + ".join(verdict) if verdict else _currency.MARK_OK,
            "reasons": list(pn.reasons),
            "open_actions": open_actions,
            "blockers": blockers,
            "decisions": decisions,
            "closed_count": closed,
        }
    return out


def _render_project_status(project_status: dict, today_date: date) -> str:
    """Per-project current-truth view (DERIVED)."""
    lines = [
        "# project status -- current truth (DERIVED)",
        "",
        "> DERIVED, recomputable, gitignored. Regenerated by `kb_meta currency`.",
        "> Do not edit; do not commit. Compiled from the entity graph",
        "> (project/<slug> + project/<slug>/... actions & decisions).",
        f"> Compiled: {today_date.isoformat()}",
        "",
    ]
    for pe in sorted(project_status):
        p = project_status[pe]
        lines.append(f"## {pe}")
        status_line = f"- status: {p['status'] or '(none)'}"
        if p["marker"] and p["marker"] != _currency.MARK_OK:
            r = "; ".join(p["reasons"])
            status_line += f"  [{p['marker']}" + (f": {r}" if r else "") + "]"
        lines.append(status_line)
        lines.append(f"- note: {p['note_id']}")
        lines.append(f"- open actions: {len(p['open_actions'])}")
        for a in p["open_actions"]:
            tag = ("  " + "  ".join(f"[{f}]" for f in a.get("flags", []))) if a.get("flags") else ""
            lines.append(f"  - {a['entity']} -- {a['body']}{tag}")
        if p["blockers"]:
            lines.append(f"- blockers: {len(p['blockers'])}")
            for b in p["blockers"]:
                lines.append(f"  - {b['entity']} -- {b['body']}")
        if p["decisions"]:
            lines.append("- recent decisions:")
            for d in p["decisions"]:
                lines.append(f"  - {d['entity']} -- {d['body']} (verified {d['last_verified'] or '?'})")
        if p["closed_count"]:
            lines.append(f"- closed/superseded actions: {p['closed_count']} (see _supersession.md)")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def cmd_currency(vault: str, topic: str, today_str: str | None = None,
                 apply: bool = False) -> dict:
    """Run the three currency passes and emit derived artifacts.

    Dry-run by default (no writes). --apply writes the derived view + log under
    wiki/ and refreshes the index with STALE/UNSUPPORTED visibility."""
    base = Path(vault) / topic
    wiki = base / "wiki"
    if not wiki.exists():
        return {"error": "wiki/ directory not found"}

    today_date = _parse_iso(today_str) or date.today()
    meta = load_meta(vault, topic)

    notes = _scan_entity_notes(vault, topic)
    current_truth, superseded, warnings = _pass1_supersession(notes)
    _pass2_3_stale_unsupported(vault, topic, current_truth, meta, today_date)

    current_truth_md = _render_current_truth(topic, current_truth, today_date)
    supersession_md = _render_supersession(topic, current_truth, superseded)
    project_status = _pass4_project_status(current_truth, today_date)
    project_status_md = _render_project_status(project_status, today_date)

    # Summaries for machine consumption (returned even in dry-run).
    entities_out = {}
    stale_ids, unsupported_ids = [], []
    for entity in sorted(current_truth):
        n = current_truth[entity]
        verdict = [m for m in n.markers if m != _currency.MARK_OK]
        marker = " + ".join(verdict) if verdict else _currency.MARK_OK
        entities_out[entity] = {
            "note_id": n.note_id,
            "marker": marker,
            "reasons": list(n.reasons),
            "last_verified": n.cm.last_verified,
            "source": n.cm.source,
        }
        if _currency.MARK_STALE in n.markers:
            stale_ids.append(n.note_id)
        if _currency.MARK_UNSUPPORTED in n.markers:
            unsupported_ids.append(n.note_id)

    # Machine-readable report for the Node connector (Task 3): every scanned note
    # keyed by note_id, current-truth notes with their OK/STALE/UNSUPPORTED verdict
    # and superseded notes flagged SUPERSEDED. The connector reads this verbatim.
    by_note: dict = {}
    for entity, info in entities_out.items():
        by_note[info["note_id"]] = {
            "marker": info["marker"],
            "reasons": info["reasons"],
            "entity": entity,
            "currentTruth": True,
        }
    for r in superseded:
        by_note[r["note_id"]] = {
            "marker": _currency.MARK_SUPERSEDED,
            "reasons": [r["reason"]],
            "entity": r["entity"],
            "currentTruth": False,
        }
    report_json = json.dumps(
        {"topic": topic, "compiled": today_date.isoformat(), "byNote": by_note},
        indent=2, ensure_ascii=False,
    )

    written = []
    if apply:
        artifacts = [
            (CURRENT_TRUTH_FILE, current_truth_md),
            (SUPERSESSION_FILE, supersession_md),
            (CURRENCY_REPORT_FILE, report_json),
        ]
        # Task 7B: only emit the project view when there are project entities,
        # so non-project vaults get no extra derived file.
        if project_status:
            artifacts.append((PROJECT_STATUS_FILE, project_status_md))
        for fname, content in artifacts:
            p = wiki / fname
            tmp = p.with_suffix(".tmp")
            try:
                tmp.write_text(content, "utf-8")
                tmp.replace(p)
            except Exception:
                tmp.unlink(missing_ok=True)
                raise
            written.append(str(p))
        # refresh index additively with STALE/UNSUPPORTED visibility.
        cmd_update_index(vault, topic)

    return {
        "ok": True,
        "topic": topic,
        "today": today_date.isoformat(),
        "apply": apply,
        "entities": entities_out,
        "current_truth": {e: current_truth[e].note_id for e in sorted(current_truth)},
        "superseded": [
            {"entity": r["entity"], "note_id": r["note_id"], "topped_by": r["topped_by"],
             "reason": r["reason"]}
            for r in superseded
        ],
        "stale": sorted(stale_ids),
        "unsupported": sorted(unsupported_ids),
        "warnings": warnings,
        "written": written,
        "by_note": by_note,
        "current_truth_md": current_truth_md,
        "supersession_md": supersession_md,
        "project_status": project_status,
        "project_status_md": project_status_md,
    }


# --- CLI ---

def main():
    args = sys.argv[1:]
    if len(args) < 1:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = args[0]

    def _currency_cli():
        # positional: <vault> <topic>; flags: --today YYYY-MM-DD, --apply
        pos = [a for a in args[1:] if not a.startswith("--")]
        today_str = None
        apply = False
        i = 1
        while i < len(args):
            if args[i] == "--today" and i + 1 < len(args):
                today_str = args[i + 1]
                i += 2
                continue
            if args[i] == "--apply":
                apply = True
            i += 1
        return cmd_currency(pos[0], pos[1], today_str=today_str, apply=apply)

    dispatch = {
        "init": lambda: cmd_init(args[1], args[2]),
        "diff": lambda: cmd_diff(args[1], args[2]),
        "update-hash": lambda: cmd_update_hash(args[1], args[2], args[3]),
        "update-index": lambda: cmd_update_index(args[1], args[2]),
        "check-links": lambda: cmd_check_links(args[1], args[2]),
        "vitality": lambda: cmd_vitality(args[1], args[2]),
        "log-access": lambda: cmd_log_access(args[1], args[2], args[3]),
        "currency": _currency_cli,
    }

    if cmd not in dispatch:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    try:
        result = dispatch[cmd]()
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except IndexError:
        print(f"Missing arguments for '{cmd}'. See usage.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
