"""Task 9 / PR 9A: the LOCAL PROJECT REGISTRY (zero-dependency, stdlib only).

> vault-mind recognises the LOCAL machine first. A project's LOGICAL identity
> (`entity: project/<slug>`) lives in the shared, committed `Projects/<slug>.md`
> note; the MACHINE PATH lives ONLY in the gitignored
> `<vault>/.vault-mind/local-bindings.json`. A machine path is NEVER written into
> any shared markdown note (Task 9 §0 #9).

This solves the user's #1 gap: projects scattered locally, forgotten, never
uploaded -- they must be manageable even with NO git, NO remote, NO board. A
project with none of those still gets detected and can be adopted.

Design invariants (locked, do NOT deviate):
  * zero-dep stdlib only -- NO PyYAML. Config + bindings are JSON.
  * `<vault>/.vault-mind/` is entirely gitignored (workspace roots AND bindings
    are machine-specific paths).
  * dry-run is the DEFAULT for any write (adopt writes nothing unless apply=True).
  * scan is READ-ONLY and one-shot (§0 #11 NO daemon): it walks dirs and reads
    marker EXISTENCE only; it never writes during a scan.
  * any file written is LF-only bytes (mirrors kb_meta.save_meta).

NO DB, NO embeddings, NO network, NO LLM. Markdown + JSON are the only state.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional

# currency.py is the Task 8A state contract (TYPE_PROJECT etc.) + frontmatter
# normalizer; _md_parse is the robust frontmatter parser kb_meta also uses.
# Import works whether this module is imported from compiler/ or run as a script.
import sys as _sys

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in _sys.path:
    _sys.path.insert(0, str(_HERE))

import currency as _currency  # noqa: E402
from _md_parse import parse_frontmatter as _parse_frontmatter  # noqa: E402


# --- project markers --------------------------------------------------------
# A directory is a PROJECT if it DIRECTLY contains any of these markers. '*.sln'
# is a glob (any .sln file); the rest are exact basenames. A project with NO
# .git / NO remote / NO board is still detected (the whole point of 9A).
PROJECT_MARKERS = [
    ".git",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "*.sln",
    "CMakeLists.txt",
]

# Noise dirs never descended into when scanning roots (vendored/derived/VCS
# internals). A detected project's OWN subdirs are also never descended into.
SKIP_DIRS = frozenset({
    "node_modules", ".git", ".venv", "__pycache__", "dist", "build",
    "target", "vendor", ".obsidian",
})

# The machine-local config dir under each vault -- entirely gitignored.
VAULT_MIND_DIR = ".vault-mind"
BINDINGS_FILE = "local-bindings.json"
WORKSPACE_CONFIG_FILE = "workspace.json"

# Shared, committed project notes live here (logical identity only, NO path).
PROJECTS_DIR = "Projects"

# Default bounded scan depth: a root, plus up to this many nested levels.
DEFAULT_MAX_DEPTH = 3


# --- slug (match the existing compile/_slugify style) ----------------------

def slugify(name: str) -> str:
    """Slugify a directory basename: lowercase, non-alnum -> '-', collapse runs,
    trim. Mirrors compile._slugify / wikilink_converter.slugify so a project's
    slug is stable across the codebase. Capped at 80 chars."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug)
    return slug.strip("-")[:80]


# --- scanning (READ-ONLY, one-shot) ----------------------------------------

def _dir_markers(dirpath: Path) -> list[str]:
    """Return the markers a directory DIRECTLY contains (sorted, deterministic).
    Reads marker EXISTENCE only -- never opens/parses file contents. '*.sln' is
    matched as a glob; the rest are exact basenames."""
    found: list[str] = []
    try:
        names = set(os.listdir(dirpath))
    except OSError:
        return found
    for marker in PROJECT_MARKERS:
        if marker == "*.sln":
            if any(n.lower().endswith(".sln") for n in names):
                found.append(marker)
        elif marker in names:
            found.append(marker)
    return found


def _has_git_remote(dirpath: Path) -> bool:
    """True iff the directory's .git/config declares any [remote ...] section.

    READ-ONLY: reads the git config text (no git subprocess, §0 #11 no daemon /
    no shelling out). A bare/missing config -> no remote. Detection of has_git is
    separate (the .git marker); this only answers "does it have a remote"."""
    cfg = dirpath / ".git" / "config"
    if not cfg.exists():
        return False
    try:
        text = cfg.read_text("utf-8-sig", errors="replace")
    except OSError:
        return False
    return re.search(r'(?m)^\s*\[\s*remote\b', text) is not None


def scan_roots(roots, max_depth: int = DEFAULT_MAX_DEPTH) -> list[dict]:
    """Walk each root to a bounded depth and detect projects. READ-ONLY.

    A directory is a PROJECT when it DIRECTLY contains any PROJECT_MARKER. We do
    NOT descend INTO a detected project (its subdirs are not separate projects),
    and we skip the SKIP_DIRS noise everywhere. A project with no .git / no
    remote / no board is still detected.

    Returns a list of dicts (sorted by path) -- one per detected project:
        {path: <abs POSIX>, slug, markers: [...], has_git: bool, has_remote: bool}

    `roots` is an iterable of directory paths (str/Path). Missing roots are
    skipped silently. `max_depth` bounds how deep below each root we walk: 0 =
    the root dir itself only, 1 = root + immediate children, etc."""
    detected: dict[str, dict] = {}  # keyed by abs-posix path -> dedupe overlapping roots

    for root in roots:
        root_path = Path(root)
        try:
            root_path = root_path.resolve()
        except OSError:
            continue
        if not root_path.is_dir():
            continue
        _scan_one_root(root_path, max_depth, detected)

    return [detected[k] for k in sorted(detected)]


def _scan_one_root(root_path: Path, max_depth: int, detected: dict) -> None:
    """Bounded DFS from one root. Mutates `detected` (abs-posix -> record).
    Stops descending into a detected project and into SKIP_DIRS."""
    # stack of (dir, depth). depth 0 = the root itself.
    stack: list[tuple[Path, int]] = [(root_path, 0)]
    while stack:
        cur, depth = stack.pop()
        markers = _dir_markers(cur)
        if markers:
            key = cur.as_posix()
            if key not in detected:
                detected[key] = {
                    "path": key,
                    "slug": slugify(cur.name),
                    "markers": markers,
                    "has_git": ".git" in markers,
                    "has_remote": _has_git_remote(cur) if ".git" in markers else False,
                }
            # do NOT descend into a detected project (its subdirs are not
            # separate projects).
            continue
        if depth >= max_depth:
            continue
        try:
            children = sorted(
                c for c in cur.iterdir()
                # `is_dir()` follows symlinks; a dir-symlink could point OUT of
                # the root, pulling an unrelated tree into the registry (path
                # traversal). Skip symlinks so scan stays bounded within the root
                # (and a self-referential loop can't recurse).
                if c.is_dir() and not c.is_symlink() and c.name not in SKIP_DIRS
            )
        except OSError:
            continue
        # push in reverse so the sorted order is preserved on the LIFO stack.
        for child in reversed(children):
            stack.append((child, depth + 1))


# --- machine-local registry (gitignored JSON) ------------------------------

def _vault_mind_dir(vault) -> Path:
    return Path(vault) / VAULT_MIND_DIR


def bindings_path(vault) -> Path:
    return _vault_mind_dir(vault) / BINDINGS_FILE


def workspace_config_path(vault) -> Path:
    return _vault_mind_dir(vault) / WORKSPACE_CONFIG_FILE


def load_bindings(vault) -> dict:
    """Load `<vault>/.vault-mind/local-bindings.json`. Shape:
        { "project/<slug>": { "path": "<abs posix>" }, ... }
    Missing / unreadable / malformed -> {} (the registry is rebuildable by
    re-adopting; a corrupt file must not crash the read)."""
    p = bindings_path(vault)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text("utf-8-sig"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_bindings(vault, mapping: dict) -> Path:
    """Write the bindings map to `<vault>/.vault-mind/local-bindings.json` as
    LF-only bytes (mirrors kb_meta.save_meta). Keys are sorted for a byte-stable,
    diff-minimal, idempotent file. Returns the path written."""
    p = bindings_path(vault)
    p.parent.mkdir(parents=True, exist_ok=True)
    ordered = {k: mapping[k] for k in sorted(mapping)}
    tmp = p.with_suffix(p.suffix + ".tmp")
    try:
        # Write bytes (NOT text mode): json.dumps emits LF, but a text-mode write
        # translates to CRLF on Windows -> platform-dependent on-disk state.
        # Bytes keep it LF-only, byte-stable across OSes (mirrors save_meta).
        tmp.write_bytes(
            json.dumps(ordered, indent=2, ensure_ascii=False).encode("utf-8")
        )
        tmp.replace(p)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    return p


def load_roots(vault) -> list[str]:
    """Read the configured workspace roots from
    `<vault>/.vault-mind/workspace.json` -> { "workspace-roots": [...] }.
    Missing / unreadable / malformed -> []. (Roots are machine-specific paths,
    so the whole .vault-mind/ dir is gitignored.)"""
    p = workspace_config_path(vault)
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text("utf-8-sig"))
    except (OSError, ValueError):
        return []
    roots = data.get("workspace-roots") if isinstance(data, dict) else None
    if not isinstance(roots, list):
        return []
    return [str(r) for r in roots if isinstance(r, str) and r.strip()]


# --- registered vs new ------------------------------------------------------

def _normpath(p: str) -> str:
    """Normalize a path to abs-posix for stable comparison across separators."""
    try:
        return Path(p).resolve().as_posix()
    except OSError:
        return Path(p).as_posix()


def registered(detected: list[dict], bindings: dict) -> dict:
    """Split detected projects into already-registered vs new, by PATH match.

    A detected project is "registered" when some binding's `path` resolves to the
    same abs-posix path. Returns
        {"registered": [...detected...], "new": [...detected...]}
    preserving the input order within each bucket."""
    bound_paths = {
        _normpath(v["path"]) for v in bindings.values()
        if isinstance(v, dict) and isinstance(v.get("path"), str)
    }
    reg, new = [], []
    for d in detected:
        if _normpath(d["path"]) in bound_paths:
            reg.append(d)
        else:
            new.append(d)
    return {"registered": reg, "new": new}


# --- adopt (dry-run default) -----------------------------------------------

def _project_note_path(vault, slug: str) -> Path:
    return Path(vault) / PROJECTS_DIR / f"{slug}.md"


def _render_project_note(slug: str, entity: str, today: str, body: str = "") -> str:
    """Render the SHARED, committed project note for an adopted project.

    Carries ONLY the logical identity + currency stamping -- entity, type, status,
    last-verified -- exactly like a 7C-stamped project note (and the fixture
    Projects notes). It contains NO machine path: the path lives only in the
    gitignored local-bindings.json (§0 #9). `status: active` makes it a live,
    non-terminal project so it flows into project-currency as a project entity.
    LF-only; deterministic field order for a byte-stable, idempotent file."""
    lines = [
        "---",
        f"{_currency.F_ENTITY}: {entity}",
        f"{_currency.F_TYPE}: {_currency.TYPE_PROJECT}",
        f"{_currency.F_STATUS}: active",
        f"{_currency.F_LAST_VERIFIED}: {today}",
        "---",
    ]
    text = "\n".join(lines) + "\n"
    body = (body or "").replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if body:
        text += "\n" + body + "\n"
    return text


def _existing_note_body(path: Path) -> str:
    """Return the body (after the leading frontmatter) of an existing note, so a
    re-adopt preserves any human-authored prose. No frontmatter -> whole text."""
    try:
        text = path.read_text("utf-8-sig", errors="replace")
    except OSError:
        return ""
    m = re.match(r"\A---\r?\n.*?\r?\n---\r?\n", text, re.DOTALL)
    return text[m.end():] if m else text


def adopt(vault, path, entity: str, apply: bool = False,
          today: Optional[str] = None) -> dict:
    """Adopt a local project into the registry. DRY-RUN by default.

    On apply (apply=True) this does TWO writes:
      1. the machine-local binding entity -> {"path": <abs posix>} into
         `<vault>/.vault-mind/local-bindings.json` (the path lives ONLY here);
      2. the SHARED note `Projects/<slug>.md` with frontmatter
         entity / type:project / status:active / last-verified, stamped like 7C
         with NO machine path in it.

    Idempotent: re-adopting the same project writes a byte-identical note and
    binding (the body of a pre-existing note is preserved). apply=False writes
    NOTHING and returns the plan only.

    Re-pointing an EXISTING entity to a DIFFERENT path is intentional (the entity
    is the logical id; this is how a project moves), so the new path wins and the
    prior binding is replaced -- but never silently: the plan's `warnings` lists
    the discarded->new rebind. Re-adopting the same path warns nothing.

    `entity` is the logical identity `project/<slug>`; the slug for the note
    filename is derived from the entity leaf (so the shared note name matches the
    logical id, independent of the machine dir basename). `today` pins the
    last-verified stamp (ISO date) for deterministic, byte-assertable notes;
    defaults to date.today() when None.

    Returns a plan dict: {entity, slug, path (abs posix), binding, note_path,
    note_text, apply, warnings: [...], written: [...]}.
    """
    from datetime import date as _date

    abs_path = _normpath(str(path))
    entity = entity.strip()
    # slug from the entity leaf -> the shared note's name matches the logical id.
    leaf = entity.rstrip("/").split("/")[-1] or slugify(Path(abs_path).name)
    slug = slugify(leaf)
    today = today or _date.today().isoformat()

    note_path = _project_note_path(vault, slug)
    body = _existing_note_body(note_path) if note_path.exists() else ""
    note_text = _render_project_note(slug, entity, today, body)

    binding = {"path": abs_path}

    # A re-adopt that re-points an existing entity to a DIFFERENT path is
    # intentional (the entity IS the logical id, so re-pointing is how you move a
    # project), but it must NOT be silent: surface it as a warning so the caller
    # sees the prior path is being discarded. Re-adopting the SAME path is a pure
    # idempotent no-op and warns nothing.
    warnings: list[str] = []
    existing = load_bindings(vault).get(entity)
    if isinstance(existing, dict) and isinstance(existing.get("path"), str):
        old_path = _normpath(existing["path"])
        if old_path != abs_path:
            warnings.append(
                f"rebinding {entity}: {old_path} -> {abs_path} "
                "(previous binding discarded)"
            )

    plan = {
        "entity": entity,
        "slug": slug,
        "path": abs_path,
        "binding": {entity: binding},
        "note_path": note_path.as_posix(),
        "note_text": note_text,
        "apply": apply,
        "warnings": warnings,
        "written": [],
    }

    if not apply:
        return plan

    # (1) machine-local binding -- the ONLY place the path is recorded. Re-pointing
    # an entity to a new path intentionally replaces the prior binding (warned
    # above); re-adopting the same path is byte-identical (idempotent).
    bindings = load_bindings(vault)
    bindings[entity] = binding
    bpath = save_bindings(vault, bindings)
    plan["written"].append(bpath.as_posix())

    # (2) shared, committed project note -- logical identity only, NO path.
    note_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = note_path.with_suffix(note_path.suffix + ".tmp")
    try:
        # Write bytes (NOT text mode): note_text is pure LF; text-mode write
        # applies OS newline translation (CRLF on Windows), defeating the
        # byte-stable / idempotent contract. Bytes keep it byte-identical.
        tmp.write_bytes(note_text.encode("utf-8"))
        tmp.replace(note_path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    plan["written"].append(note_path.as_posix())

    return plan


# --- top-level scan report (READ-ONLY) -------------------------------------

def scan_report(vault, extra_roots=None, max_depth: int = DEFAULT_MAX_DEPTH) -> dict:
    """Full READ-ONLY scan report for a vault. Reads roots from the machine-local
    config (load_roots) plus any `extra_roots` (for testing / ad-hoc roots),
    scans them, and splits the detected projects into registered vs new against
    the current bindings. Writes NOTHING.

    Returns {detected: [...], new: [...], registered: [...], roots: [...]}.
    """
    roots = list(load_roots(vault))
    if extra_roots:
        roots += [str(r) for r in extra_roots]
    detected = scan_roots(roots, max_depth=max_depth)
    split = registered(detected, load_bindings(vault))
    return {
        "detected": detected,
        "new": split["new"],
        "registered": split["registered"],
        "roots": roots,
    }
