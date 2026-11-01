"""Source-versioned contribution manifests and projection rebuild.

Implements maintained-wiki-compilation (OpenSpec 5.1-5.6) inside the compiler:

- Emit stable contribution ids + versioned manifests per Source revision
- Rebuild affected projections from the complete active contribution set
- Atomic generation swap with unaffected byte stability
- Safe source revise / disable / remove with shared-support preservation
- Legacy unknown-provenance detection, report tooling, and a full-rebuild gate

Machine state lives under ``<topic>/wiki/_llmwiki/contributions/``.
Generated projections remain under ``wiki/concepts``, ``wiki/summaries``, and
``wiki/_contradictions.md``.

Zero new dependencies. Atomic writes follow kb_meta/compile patterns (tmp + replace).
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

COMPILER_SCHEMA_VERSION = "compiler/1"
STORE_SCHEMA_VERSION = 1
PUBLIC_MANIFEST_SCHEMA_VERSION = 1
PROVENANCE_MARKER = "llmwiki-contribution-provenance"

CONTRIBUTION_KINDS = (
    "claim",
    "relationship",
    "concept_membership",
    "summary_input",
    "contradiction_observation",
)

STORE_DIRNAME = "_llmwiki"
CONTRIBUTIONS_DIRNAME = "contributions"
STORE_FILENAME = "store.json"
GENERATIONS_DIRNAME = "generations"
CURRENT_GENERATION_FILENAME = "current-generation.json"
GENERATION_MANIFEST_FILENAME = "manifest.json"

_SLUG_RE = re.compile(r"[^\w\s-]", re.UNICODE)
_SPACE_RE = re.compile(r"[\s_]+")
_DASH_RE = re.compile(r"-{2,}")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ContributionError(Exception):
    """Base error for contribution-manifest operations."""

    code = "CONTRIBUTION_ERROR"

    def __init__(self, message: str, *, data: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.data = dict(data or {})


class DestructiveRetractionBlocked(ContributionError):
    """Raised when source-scoped retraction would touch unknown-provenance pages."""

    code = "LEGACY_UNKNOWN_PROVENANCE"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = _SLUG_RE.sub("", slug)
    slug = _SPACE_RE.sub("-", slug)
    slug = _DASH_RE.sub("-", slug)
    return slug.strip("-")[:80] or "untitled"


def canonical_json(value: Any) -> str:
    """Deterministic JSON encoding (sorted object keys, compact separators)."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def sha256_digest(payload: str | bytes) -> str:
    data = payload if isinstance(payload, bytes) else payload.encode("utf-8")
    return "sha256:" + hashlib.sha256(data).hexdigest()


def source_id_from_path(source_path: str) -> str:
    """Stable Source identity derived from the vault-relative source path."""
    normalized = source_path.replace("\\", "/").strip().lstrip("./")
    if not normalized:
        raise ContributionError("source path must be non-empty")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return f"source/{digest}"


def source_revision_from_bytes(content: bytes | str) -> str:
    data = content if isinstance(content, bytes) else content.encode("utf-8")
    return sha256_digest(data)


def make_contribution_id(kind: str, source_id: str, stable_key: str) -> str:
    """Deterministic contribution id stable across recompiles of the same content."""
    if kind not in CONTRIBUTION_KINDS:
        raise ContributionError(f"unsupported contribution kind: {kind}")
    if not source_id or not stable_key:
        raise ContributionError("source_id and stable_key are required")
    material = f"{kind}|{source_id}|{stable_key}"
    digest = hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]
    return f"{kind}/{digest}"


def make_manifest_id(source_id: str, source_revision: str) -> str:
    rev = source_revision.removeprefix("sha256:")[:16]
    sid = source_id.removeprefix("source/")
    return f"manifest/{sid}/{rev}"


def public_manifest_view(record: Mapping[str, Any]) -> dict[str, Any]:
    """Return the shared schema surface (no contributions payload)."""
    return {
        "schemaVersion": int(record["schemaVersion"]),
        "manifestId": str(record["manifestId"]),
        "sourceId": str(record["sourceId"]),
        "sourceRevision": str(record["sourceRevision"]),
        "compilerSchemaVersion": str(record["compilerSchemaVersion"]),
        "active": bool(record["active"]),
        "contributionIds": list(record["contributionIds"]),
        "affectedConceptKeys": list(record["affectedConceptKeys"]),
        "contentDigest": str(record["contentDigest"]),
        "createdAt": str(record["createdAt"]),
    }


def _write_bytes_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    try:
        tmp.write_bytes(data)
        tmp.replace(path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def write_text_atomic(path: Path, content: str) -> None:
    """Atomic text write using LF-only bytes (platform-stable)."""
    _write_bytes_atomic(path, content.encode("utf-8"))


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def topic_wiki_root(topic_root: Path) -> Path:
    return topic_root / "wiki"


def store_dir(topic_root: Path) -> Path:
    return topic_wiki_root(topic_root) / STORE_DIRNAME / CONTRIBUTIONS_DIRNAME


def store_path(topic_root: Path) -> Path:
    return store_dir(topic_root) / STORE_FILENAME


def generations_dir(topic_root: Path) -> Path:
    return store_dir(topic_root) / GENERATIONS_DIRNAME


def current_generation_path(topic_root: Path) -> Path:
    return store_dir(topic_root) / CURRENT_GENERATION_FILENAME


def load_current_generation(topic_root: Path) -> dict[str, Any]:
    path = current_generation_path(topic_root)
    if not path.exists():
        return {"schemaVersion": 1, "projections": {}}
    raw = json.loads(path.read_text("utf-8-sig"))
    if not isinstance(raw, dict) or not isinstance(raw.get("projections"), dict):
        raise ContributionError("current generation pointer must contain projections")
    return raw


def read_published_projection(topic_root: Path, relative_path: str) -> bytes | None:
    """Read through the atomic generation pointer, falling back to the legacy mirror.

    New readers get one consistent affected-closure generation. The historical
    ``wiki/`` paths remain a compatibility mirror for Obsidian and older hosts.
    """
    rel = relative_path.replace("\\", "/").lstrip("/")
    pointer = load_current_generation(topic_root)
    entry = pointer.get("projections", {}).get(rel)
    if isinstance(entry, Mapping):
        if entry.get("state") == "deleted":
            return None
        generation_id = entry.get("generationId")
        if isinstance(generation_id, str):
            published = generations_dir(topic_root) / generation_id / "projections" / Path(rel)
            if published.exists():
                return published.read_bytes()
    legacy = topic_wiki_root(topic_root) / Path(rel)
    return legacy.read_bytes() if legacy.exists() else None


# ---------------------------------------------------------------------------
# Store load / save
# ---------------------------------------------------------------------------


def empty_store(topic: str = "") -> dict[str, Any]:
    return {
        "schemaVersion": STORE_SCHEMA_VERSION,
        "topic": topic,
        "manifests": {},
        "managedProjections": {},
        "updatedAt": _now_iso(),
    }


def load_store(topic_root: Path) -> dict[str, Any]:
    path = store_path(topic_root)
    if not path.exists():
        return empty_store(topic_root.name)
    raw = json.loads(path.read_text("utf-8-sig"))
    if not isinstance(raw, dict):
        raise ContributionError("contribution store must be an object")
    raw.setdefault("manifests", {})
    raw.setdefault("managedProjections", {})
    raw.setdefault("schemaVersion", STORE_SCHEMA_VERSION)
    raw.setdefault("topic", topic_root.name)
    return raw


def save_store(topic_root: Path, store: Mapping[str, Any]) -> None:
    payload = dict(store)
    payload["updatedAt"] = _now_iso()
    payload["schemaVersion"] = STORE_SCHEMA_VERSION
    data = json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8") + b"\n"
    _write_bytes_atomic(store_path(topic_root), data)


# ---------------------------------------------------------------------------
# Contribution + manifest construction
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ContributionRecord:
    id: str
    kind: str
    concept_keys: tuple[str, ...]
    payload: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "conceptKeys": list(self.concept_keys),
            "payload": dict(self.payload),
        }


def contribution_from_dict(value: Mapping[str, Any]) -> ContributionRecord:
    kind = str(value["kind"])
    if kind not in CONTRIBUTION_KINDS:
        raise ContributionError(f"unsupported contribution kind: {kind}")
    keys = tuple(sorted({slugify(str(k)) for k in value.get("conceptKeys", []) if str(k).strip()}))
    return ContributionRecord(
        id=str(value["id"]),
        kind=kind,
        concept_keys=keys,
        payload=dict(value.get("payload") or {}),
    )


def build_contributions_for_source(
    *,
    source_id: str,
    source_path: str,
    source_revision: str,
    concepts: Sequence[Mapping[str, Any]] = (),
    claims: Sequence[Mapping[str, Any]] = (),
    relationships: Sequence[Mapping[str, Any]] = (),
    summary_sections: Sequence[Mapping[str, Any]] = (),
    contradictions: Sequence[Mapping[str, Any]] = (),
) -> list[ContributionRecord]:
    """Build deterministic contribution records for one Source revision."""
    records: list[ContributionRecord] = []
    concept_keys: set[str] = set()

    for concept in concepts:
        name = str(concept.get("name", "")).strip()
        definition = str(concept.get("definition", "")).strip()
        if not name or not definition:
            continue
        key = slugify(name)
        concept_keys.add(key)
        cid = make_contribution_id("concept_membership", source_id, key)
        records.append(
            ContributionRecord(
                id=cid,
                kind="concept_membership",
                concept_keys=(key,),
                payload={
                    "name": name,
                    "slug": key,
                    "definition": definition,
                    "sourcePath": source_path,
                    "sourceRevision": source_revision,
                },
            )
        )

    for claim in claims:
        content = str(claim.get("content", "")).strip()
        if not content:
            continue
        conf = float(claim.get("confidence", 0.5))
        related = [slugify(str(x)) for x in claim.get("conceptKeys", []) if str(x).strip()]
        if not related:
            # Attach claim to all concepts named in this source extraction, else a bucket.
            related = sorted(concept_keys) or ["_unscoped"]
        stable = content.casefold()
        cid = make_contribution_id("claim", source_id, stable)
        records.append(
            ContributionRecord(
                id=cid,
                kind="claim",
                concept_keys=tuple(sorted(set(related))),
                payload={
                    "content": content,
                    "confidence": conf,
                    "sourcePath": source_path,
                    "sourceRevision": source_revision,
                },
            )
        )

    for rel in relationships:
        frm = str(rel.get("from", "")).strip()
        to = str(rel.get("to", "")).strip()
        rtype = str(rel.get("type", "related-to")).strip() or "related-to"
        if not frm or not to:
            continue
        from_key = slugify(frm)
        to_key = slugify(to)
        stable = f"{from_key}|{rtype.casefold()}|{to_key}"
        cid = make_contribution_id("relationship", source_id, stable)
        records.append(
            ContributionRecord(
                id=cid,
                kind="relationship",
                concept_keys=tuple(sorted({from_key, to_key})),
                payload={
                    "from": frm,
                    "to": to,
                    "fromKey": from_key,
                    "toKey": to_key,
                    "type": rtype,
                    "sourcePath": source_path,
                    "sourceRevision": source_revision,
                },
            )
        )

    for section in summary_sections:
        heading = str(section.get("heading", "Overview")).strip() or "Overview"
        text = str(section.get("text", "")).strip()
        if not text:
            continue
        stable = f"{slugify(heading)}|{text.casefold()}"
        cid = make_contribution_id("summary_input", source_id, stable)
        records.append(
            ContributionRecord(
                id=cid,
                kind="summary_input",
                concept_keys=tuple(sorted(concept_keys)),
                payload={
                    "heading": heading,
                    "text": text,
                    "sourcePath": source_path,
                    "sourceRevision": source_revision,
                },
            )
        )

    for obs in contradictions:
        claim_a = str(obs.get("claimA", "")).strip()
        claim_b = str(obs.get("claimB", "")).strip()
        if not claim_a or not claim_b:
            continue
        severity = str(obs.get("severity", "nuanced")).strip() or "nuanced"
        resolution = obs.get("resolution")
        stable = f"{claim_a.casefold()}|{claim_b.casefold()}|{severity}"
        cid = make_contribution_id("contradiction_observation", source_id, stable)
        keys = [slugify(str(x)) for x in obs.get("conceptKeys", []) if str(x).strip()]
        records.append(
            ContributionRecord(
                id=cid,
                kind="contradiction_observation",
                concept_keys=tuple(sorted(set(keys))) if keys else ("_contradictions",),
                payload={
                    "claimA": claim_a,
                    "claimB": claim_b,
                    "severity": severity,
                    "resolution": resolution,
                    "sourcePathA": obs.get("sourcePathA"),
                    "sourcePathB": obs.get("sourcePathB"),
                    "sourceIdA": obs.get("sourceIdA"),
                    "sourceIdB": obs.get("sourceIdB"),
                },
            )
        )

    records.sort(key=lambda r: (r.kind, r.id))
    return records


def build_manifest(
    *,
    source_id: str,
    source_revision: str,
    contributions: Sequence[ContributionRecord],
    created_at: str | None = None,
    active: bool = True,
) -> dict[str, Any]:
    """Build a store-local manifest record (public fields + contributions)."""
    ordered = sorted(contributions, key=lambda r: (r.kind, r.id))
    contribution_ids = [r.id for r in ordered]
    concept_keys = sorted(
        {
            key
            for r in ordered
            for key in r.concept_keys
            if key and key != "_unscoped" and key != "_contradictions"
        }
    )
    payload = [r.to_dict() for r in ordered]
    digest = sha256_digest(canonical_json(payload))
    record = {
        "schemaVersion": PUBLIC_MANIFEST_SCHEMA_VERSION,
        "manifestId": make_manifest_id(source_id, source_revision),
        "sourceId": source_id,
        "sourceRevision": source_revision,
        "compilerSchemaVersion": COMPILER_SCHEMA_VERSION,
        "active": active,
        "contributionIds": contribution_ids,
        "affectedConceptKeys": concept_keys,
        "contentDigest": digest,
        "createdAt": created_at or _now_iso(),
        "contributions": payload,
    }
    return record


# ---------------------------------------------------------------------------
# Active set / closure
# ---------------------------------------------------------------------------


def list_active_manifests(store: Mapping[str, Any]) -> list[dict[str, Any]]:
    manifests = [
        dict(m)
        for m in store.get("manifests", {}).values()
        if m.get("active") is True
    ]
    manifests.sort(key=lambda m: (m["sourceId"], m["sourceRevision"], m["manifestId"]))
    return manifests


def collect_active_contributions(store: Mapping[str, Any]) -> list[ContributionRecord]:
    records: list[ContributionRecord] = []
    for manifest in list_active_manifests(store):
        for raw in manifest.get("contributions", []):
            records.append(contribution_from_dict(raw))
    records.sort(key=lambda r: (r.kind, r.id))
    return records


def compute_affected_topic_closure(
    *concept_key_sets: Iterable[str],
) -> frozenset[str]:
    """Union of concept keys from activated and deactivated manifests."""
    keys: set[str] = set()
    for group in concept_key_sets:
        for key in group:
            k = slugify(str(key)) if str(key).strip() else ""
            if k and k not in {"_unscoped", "_contradictions"}:
                keys.add(k)
    return frozenset(sorted(keys))


def deactivate_manifests_for_source(
    store: dict[str, Any],
    source_id: str,
    *,
    source_revision: str | None = None,
) -> list[dict[str, Any]]:
    """Deactivate active manifests for a source (optionally one revision)."""
    deactivated: list[dict[str, Any]] = []
    for mid, manifest in store["manifests"].items():
        if manifest.get("sourceId") != source_id:
            continue
        if source_revision is not None and manifest.get("sourceRevision") != source_revision:
            continue
        if not manifest.get("active"):
            continue
        updated = dict(manifest)
        updated["active"] = False
        store["manifests"][mid] = updated
        deactivated.append(updated)
    deactivated.sort(key=lambda m: m["manifestId"])
    return deactivated


# ---------------------------------------------------------------------------
# Projection rendering (deterministic)
# ---------------------------------------------------------------------------


def _concept_display_name(concept_key: str, memberships: Sequence[ContributionRecord]) -> str:
    for rec in memberships:
        name = str(rec.payload.get("name", "")).strip()
        if name:
            return name
    return concept_key


def render_concept_projection(
    concept_key: str,
    contributions: Sequence[ContributionRecord],
) -> str:
    memberships = [c for c in contributions if c.kind == "concept_membership" and concept_key in c.concept_keys]
    claims = [c for c in contributions if c.kind == "claim" and concept_key in c.concept_keys]
    relationships = [
        c for c in contributions if c.kind == "relationship" and concept_key in c.concept_keys
    ]
    memberships.sort(key=lambda c: c.id)
    claims.sort(key=lambda c: c.id)
    relationships.sort(key=lambda c: c.id)

    name = _concept_display_name(concept_key, memberships)
    lines: list[str] = [f"# {name}", ""]

    if memberships:
        # Prefer first deterministic membership definition; note multi-source support.
        lines.append(str(memberships[0].payload.get("definition", "")).strip())
        lines.append("")
        if len(memberships) > 1:
            lines.append("## Alternate definitions")
            for rec in memberships[1:]:
                src = rec.payload.get("sourcePath", rec.id)
                lines.append(f"- ({src}) {str(rec.payload.get('definition', '')).strip()}")
            lines.append("")

    if claims:
        lines.append("## Claims")
        for rec in claims:
            src = rec.payload.get("sourcePath", "")
            content = str(rec.payload.get("content", "")).strip()
            lines.append(f"- {content} (`{src}`)")
        lines.append("")

    if relationships:
        lines.append("## Relationships")
        for rec in relationships:
            frm = rec.payload.get("from", "?")
            to = rec.payload.get("to", "?")
            rtype = rec.payload.get("type", "->")
            src = rec.payload.get("sourcePath", "")
            lines.append(f"- **{frm}** {rtype} **{to}** (`{src}`)")
        lines.append("")

    lines.append("## Sources")
    source_paths = sorted(
        {
            str(c.payload.get("sourcePath"))
            for c in list(memberships) + list(claims) + list(relationships)
            if c.payload.get("sourcePath")
        }
    )
    for path in source_paths:
        lines.append(f"- `{path}`")
    if not source_paths:
        lines.append("- _(none)_")
    lines.append("")

    body = "\n".join(lines)
    digest = sha256_digest(body)
    lines.append(f"<!-- {PROVENANCE_MARKER}: v1 digest={digest} -->")
    lines.append("")
    return "\n".join(lines)


def render_summary_projection(
    source_path: str,
    contributions: Sequence[ContributionRecord],
) -> str:
    sections = [
        c
        for c in contributions
        if c.kind == "summary_input" and c.payload.get("sourcePath") == source_path
    ]
    sections.sort(key=lambda c: (str(c.payload.get("heading", "")), c.id))
    relationships = [
        c
        for c in contributions
        if c.kind == "relationship" and c.payload.get("sourcePath") == source_path
    ]
    relationships.sort(key=lambda c: c.id)

    title = Path(str(source_path)).stem
    lines = [
        f"# Summary: {title}",
        "",
        f"> Source: `{source_path}`",
        "",
    ]
    if not sections:
        lines.append("_(no summary inputs)_")
        lines.append("")
    for rec in sections:
        heading = str(rec.payload.get("heading", "Overview"))
        text = str(rec.payload.get("text", "")).strip()
        lines.append(f"## {heading}")
        lines.append("")
        lines.append(text)
        lines.append("")
    if relationships:
        lines.append("## Relationships")
        lines.append("")
        for rec in relationships:
            lines.append(
                f"- **{rec.payload.get('from', '?')}** "
                f"{rec.payload.get('type', '->')} "
                f"**{rec.payload.get('to', '?')}**"
            )
        lines.append("")

    body = "\n".join(lines)
    digest = sha256_digest(body)
    lines.append(f"<!-- {PROVENANCE_MARKER}: v1 digest={digest} -->")
    lines.append("")
    return "\n".join(lines)


def render_contradictions_projection(contributions: Sequence[ContributionRecord]) -> str:
    observations = [c for c in contributions if c.kind == "contradiction_observation"]
    observations.sort(key=lambda c: (str(c.payload.get("severity", "")), c.id))
    lines = [
        "# Contradictions",
        "",
        "> Auto-detected conflicts between source claims. Rebuilt from active contribution manifests.",
        "",
    ]
    if not observations:
        lines.append("_(none)_")
        lines.append("")
    for rec in observations:
        p = rec.payload
        lines.extend(
            [
                "---",
                f"**Severity**: {p.get('severity', 'nuanced')}  ",
                f"**Claim A** (`{p.get('sourcePathA', '')}`): {p.get('claimA', '')}  ",
                f"**Claim B** (`{p.get('sourcePathB', '')}`): {p.get('claimB', '')}  ",
                f"**Resolution**: {p.get('resolution') or 'unresolved'}  ",
                f"**Contribution**: `{rec.id}`",
                "",
            ]
        )
    body = "\n".join(lines)
    digest = sha256_digest(body)
    lines.append(f"<!-- {PROVENANCE_MARKER}: v1 digest={digest} -->")
    lines.append("")
    return "\n".join(lines)


def rebuild_projections_from_active(
    store: Mapping[str, Any],
    *,
    affected_concepts: frozenset[str] | None = None,
    rebuild_summaries_for: frozenset[str] | None = None,
    rebuild_contradictions: bool = True,
) -> dict[str, str]:
    """Render projection path -> content from the complete active contribution set.

    Paths are relative to ``wiki/`` (posix).
    """
    active = collect_active_contributions(store)
    by_concept: dict[str, list[ContributionRecord]] = {}
    for rec in active:
        for key in rec.concept_keys:
            if key in {"_unscoped", "_contradictions"}:
                continue
            by_concept.setdefault(key, []).append(rec)

    targets = (
        set(affected_concepts)
        if affected_concepts is not None
        else set(by_concept.keys())
    )
    projections: dict[str, str] = {}

    for concept_key in sorted(targets):
        related = by_concept.get(concept_key, [])
        if not related:
            # Retract: empty projection marker means delete later.
            projections[f"concepts/{concept_key}.md"] = ""
            continue
        projections[f"concepts/{concept_key}.md"] = render_concept_projection(
            concept_key, related
        )

    summary_sources: set[str] = set()
    if rebuild_summaries_for is None:
        for rec in active:
            if rec.kind == "summary_input":
                path = rec.payload.get("sourcePath")
                if path:
                    summary_sources.add(str(path))
    else:
        summary_sources = set(rebuild_summaries_for)

    for source_path in sorted(summary_sources):
        slug = slugify(Path(source_path).stem)
        content = render_summary_projection(source_path, active)
        projections[f"summaries/{slug}.md"] = content

    if rebuild_contradictions:
        projections["_contradictions.md"] = render_contradictions_projection(active)

    return projections


# ---------------------------------------------------------------------------
# Atomic generation swap
# ---------------------------------------------------------------------------


@dataclass
class SwapResult:
    generation_id: str
    written: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)


def atomic_generation_swap(
    topic_root: Path,
    projections: Mapping[str, str],
    *,
    generation_id: str | None = None,
    dry_run: bool = False,
) -> SwapResult:
    """Stage and atomically publish one affected projection closure.

    Empty content means delete the projection if present.
    Files not listed are left byte-stable (not opened for write).

    The canonical publication is a single atomically replaced generation
    pointer whose entries all reference the fully staged immutable generation.
    ``wiki/`` is updated transactionally as a compatibility mirror; failures
    restore every touched path before the pointer can move.
    """
    wiki = topic_wiki_root(topic_root)
    gen_id = generation_id or (
        datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        + "-"
        + hashlib.sha256(canonical_json(dict(sorted(projections.items()))).encode("utf-8")).hexdigest()[:8]
    )
    result = SwapResult(generation_id=gen_id)
    stage_root = generations_dir(topic_root) / gen_id
    if dry_run:
        for rel, content in sorted(projections.items()):
            final = wiki / Path(rel)
            if content == "":
                if final.exists():
                    result.deleted.append(rel)
                else:
                    result.unchanged.append(rel)
                continue
            if final.exists() and final.read_text("utf-8-sig", errors="replace") == content:
                result.unchanged.append(rel)
            else:
                result.written.append(rel)
        return result

    if stage_root.exists():
        shutil.rmtree(stage_root)
    stage_root.mkdir(parents=True, exist_ok=True)

    staged: list[tuple[str, Path, Path | None, str]] = []
    for rel, content in sorted(projections.items()):
        final = wiki / Path(rel)
        if content == "":
            staged.append((rel, final, None, ""))
            continue
        stage_path = stage_root / "projections" / Path(rel)
        stage_path.parent.mkdir(parents=True, exist_ok=True)
        stage_path.write_bytes(content.encode("utf-8"))
        staged.append((rel, final, stage_path, content))

    generation_manifest = {
        "schemaVersion": 1,
        "generationId": gen_id,
        "createdAt": _now_iso(),
        "projections": {
            rel: {
                "state": "deleted" if content == "" else "active",
                **({} if content == "" else {"digest": sha256_digest(content)}),
            }
            for rel, _final, _stage_path, content in staged
        },
    }
    write_text_atomic(
        stage_root / GENERATION_MANIFEST_FILENAME,
        json.dumps(generation_manifest, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
    )

    # Preserve exact prior bytes so an exception cannot leave a partially
    # published compatibility mirror.
    prior: list[tuple[Path, bytes | None]] = [
        (final, final.read_bytes() if final.exists() else None)
        for _rel, final, _stage_path, _content in staged
    ]
    try:
        for rel, final, stage_path, content in staged:
            if content == "":
                if final.exists():
                    final.unlink()
                    result.deleted.append(rel)
                else:
                    result.unchanged.append(rel)
                continue
            encoded = content.encode("utf-8")
            if final.exists() and final.read_bytes() == encoded:
                result.unchanged.append(rel)
                continue
            final.parent.mkdir(parents=True, exist_ok=True)
            # Copy from the immutable generation; do not consume its staged file.
            write_text_atomic(final, content)
            result.written.append(rel)

        previous = load_current_generation(topic_root)
        projection_pointer = dict(previous.get("projections") or {})
        for rel, _final, _stage_path, content in staged:
            projection_pointer[rel] = {
                "generationId": gen_id,
                "state": "deleted" if content == "" else "active",
                **({} if content == "" else {"digest": sha256_digest(content)}),
            }
        pointer = {
            "schemaVersion": 1,
            "generationId": gen_id,
            "publishedAt": _now_iso(),
            "projections": dict(sorted(projection_pointer.items())),
        }
        write_text_atomic(
            current_generation_path(topic_root),
            json.dumps(pointer, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        )
    except Exception:
        for final, before in reversed(prior):
            if before is None:
                final.unlink(missing_ok=True)
            else:
                _write_bytes_atomic(final, before)
        shutil.rmtree(stage_root, ignore_errors=True)
        raise
    return result


def _update_managed_projections(
    store: dict[str, Any],
    projections: Mapping[str, str],
    *,
    generation_id: str,
) -> None:
    managed = dict(store.get("managedProjections") or {})
    for rel, content in projections.items():
        if content == "":
            managed.pop(rel, None)
            continue
        managed[rel] = {
            "digest": sha256_digest(content),
            "generationId": generation_id,
            "updatedAt": _now_iso(),
        }
    store["managedProjections"] = managed


# ---------------------------------------------------------------------------
# Legacy provenance
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LegacyProjection:
    path: str
    status: str = "unknown-provenance"
    reason: str = "missing contribution provenance"


def detect_unknown_provenance(topic_root: Path, store: Mapping[str, Any] | None = None) -> list[LegacyProjection]:
    """Identify wiki projections without complete contribution provenance."""
    wiki = topic_wiki_root(topic_root)
    store = store if store is not None else load_store(topic_root)
    managed = store.get("managedProjections") or {}
    findings: list[LegacyProjection] = []

    concept_dir = wiki / "concepts"
    if concept_dir.exists():
        for path in sorted(concept_dir.glob("*.md")):
            if path.name.startswith("_"):
                continue
            rel = f"concepts/{path.name}"
            findings.extend(_legacy_check(path, rel, managed))

    summary_dir = wiki / "summaries"
    if summary_dir.exists():
        for path in sorted(summary_dir.glob("*.md")):
            rel = f"summaries/{path.name}"
            findings.extend(_legacy_check(path, rel, managed))

    contradictions = wiki / "_contradictions.md"
    if contradictions.exists():
        findings.extend(_legacy_check(contradictions, "_contradictions.md", managed))

    findings.sort(key=lambda f: f.path)
    return findings


def _legacy_check(path: Path, rel: str, managed: Mapping[str, Any]) -> list[LegacyProjection]:
    text = path.read_text("utf-8-sig", errors="replace")
    has_marker = PROVENANCE_MARKER in text
    managed_meta = managed.get(rel)
    if managed_meta and has_marker:
        expected = str(managed_meta.get("digest", ""))
        # Marker digest is of body without marker line; accept managed bookkeeping.
        if expected:
            return []
    if has_marker and managed_meta:
        return []
    if has_marker and not managed_meta:
        return [
            LegacyProjection(
                path=rel,
                reason="provenance marker present but not tracked in contribution store",
            )
        ]
    if managed_meta and not has_marker:
        return [
            LegacyProjection(
                path=rel,
                reason="managed projection missing provenance marker",
            )
        ]
    return [
        LegacyProjection(
            path=rel,
            reason="projection has no contribution provenance",
        )
    ]


def report_legacy_provenance(topic_root: Path, store: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Machine-readable report for unknown-provenance projections."""
    findings = detect_unknown_provenance(topic_root, store)
    return {
        "schemaVersion": STORE_SCHEMA_VERSION,
        "status": "unknown-provenance" if findings else "clean",
        "count": len(findings),
        "diagnosticCode": "LEGACY_UNKNOWN_PROVENANCE" if findings else None,
        "projections": [
            {"path": f.path, "status": f.status, "reason": f.reason} for f in findings
        ],
        "remediation": (
            "Run a full rebuild from registered Evidence before destructive source-scoped retraction."
            if findings
            else None
        ),
    }


def backfill_managed_from_disk(
    topic_root: Path,
    store: dict[str, Any] | None = None,
    *,
    only_with_marker: bool = True,
) -> dict[str, Any]:
    """Report-oriented backfill helper: register marked projections as managed.

    Does not invent contribution attribution. Returns a report of adopted paths.
    """
    store = store if store is not None else load_store(topic_root)
    wiki = topic_wiki_root(topic_root)
    adopted: list[str] = []
    skipped: list[str] = []
    managed = dict(store.get("managedProjections") or {})

    candidates: list[Path] = []
    concept_dir = wiki / "concepts"
    if concept_dir.exists():
        candidates.extend(sorted(concept_dir.glob("*.md")))
    summary_dir = wiki / "summaries"
    if summary_dir.exists():
        candidates.extend(sorted(summary_dir.glob("*.md")))
    contradictions = wiki / "_contradictions.md"
    if contradictions.exists():
        candidates.append(contradictions)

    for path in candidates:
        if path.name.startswith("_") and path.name != "_contradictions.md":
            continue
        rel = str(path.relative_to(wiki)).replace("\\", "/")
        text = path.read_text("utf-8-sig", errors="replace")
        if only_with_marker and PROVENANCE_MARKER not in text:
            skipped.append(rel)
            continue
        managed[rel] = {
            "digest": sha256_digest(text),
            "generationId": "backfill",
            "updatedAt": _now_iso(),
        }
        adopted.append(rel)

    store["managedProjections"] = managed
    save_store(topic_root, store)
    return {
        "adopted": adopted,
        "skippedUnknown": skipped,
        "managedCount": len(managed),
    }


def ensure_safe_for_destructive_retraction(
    topic_root: Path,
    affected_concepts: frozenset[str],
    store: Mapping[str, Any] | None = None,
    *,
    force_full_rebuild: bool = False,
    summary_paths: Iterable[str] = (),
    rewrite_contradictions: bool = True,
) -> dict[str, Any]:
    """Gate destructive source-scoped retraction against legacy projections.

    When legacy projections intersect the affected concept closure (or specific
    summary / contradictions targets), require an explicit full rebuild gate
    rather than deleting inferred content.
    """
    if force_full_rebuild:
        return {"allowed": True, "gate": "force_full_rebuild", "blocking": []}

    summary_rels = {
        f"summaries/{slugify(Path(str(p)).stem)}.md" for p in summary_paths if str(p).strip()
    }
    report = report_legacy_provenance(topic_root, store)
    blocking: list[dict[str, Any]] = []
    for item in report["projections"]:
        path = str(item["path"])
        if path.startswith("concepts/"):
            key = Path(path).stem
            if key in affected_concepts:
                blocking.append(item)
        elif path == "_contradictions.md" and rewrite_contradictions:
            blocking.append(item)
        elif path in summary_rels:
            blocking.append(item)

    if blocking:
        raise DestructiveRetractionBlocked(
            "Destructive source-scoped retraction blocked: unknown-provenance projections require a full rebuild",
            data={
                "diagnosticCode": "LEGACY_UNKNOWN_PROVENANCE",
                "blocking": blocking,
                "affectedConcepts": sorted(affected_concepts),
                "remediation": report.get("remediation"),
            },
        )
    return {"allowed": True, "gate": "clean", "blocking": []}


# ---------------------------------------------------------------------------
# High-level source lifecycle
# ---------------------------------------------------------------------------


@dataclass
class ApplyResult:
    activated_manifest_id: str | None
    deactivated_manifest_ids: list[str]
    affected_concepts: list[str]
    swap: SwapResult
    legacy_report: dict[str, Any]


def apply_source_revision(
    topic_root: Path,
    manifest: Mapping[str, Any],
    *,
    dry_run: bool = False,
    force_full_rebuild: bool = False,
    rebuild_contradictions: bool = True,
) -> ApplyResult:
    """Activate a new source-revision manifest and rebuild affected projections.

    Deactivates any prior active manifests for the same sourceId first.
    """
    topic_root = Path(topic_root)
    store = load_store(topic_root)
    record = dict(manifest)
    if "contributions" not in record:
        raise ContributionError("manifest record must include contributions payload")
    record["active"] = True
    public = public_manifest_view(record)
    # Ensure required public fields are consistent with contributions.
    if public["contentDigest"] != record["contentDigest"]:
        raise ContributionError("contentDigest mismatch")

    deactivated = deactivate_manifests_for_source(store, record["sourceId"])
    prior_keys = compute_affected_topic_closure(
        *(m.get("affectedConceptKeys", []) for m in deactivated)
    )
    new_keys = compute_affected_topic_closure(record.get("affectedConceptKeys", []))
    affected = compute_affected_topic_closure(prior_keys, new_keys)

    # Summary paths to rebuild: previous + new source paths from contributions.
    summary_paths: set[str] = set()
    for m in deactivated:
        for raw in m.get("contributions", []):
            if raw.get("kind") == "summary_input" and raw.get("payload", {}).get("sourcePath"):
                summary_paths.add(str(raw["payload"]["sourcePath"]))
    for raw in record.get("contributions", []):
        if raw.get("kind") == "summary_input" and raw.get("payload", {}).get("sourcePath"):
            summary_paths.add(str(raw["payload"]["sourcePath"]))

    ensure_safe_for_destructive_retraction(
        topic_root,
        affected,
        store,
        force_full_rebuild=force_full_rebuild,
        summary_paths=summary_paths,
        rewrite_contradictions=rebuild_contradictions,
    )

    store["manifests"][record["manifestId"]] = record

    projections = rebuild_projections_from_active(
        store,
        affected_concepts=affected,
        rebuild_summaries_for=frozenset(summary_paths),
        rebuild_contradictions=rebuild_contradictions,
    )

    # Drop summary files for this source when it no longer contributes summaries.
    active_summary_sources = {
        str(c.payload.get("sourcePath"))
        for c in collect_active_contributions(store)
        if c.kind == "summary_input" and c.payload.get("sourcePath")
    }
    for source_path in list(summary_paths):
        if source_path not in active_summary_sources:
            slug = slugify(Path(source_path).stem)
            projections[f"summaries/{slug}.md"] = ""

    swap = atomic_generation_swap(topic_root, projections, dry_run=dry_run)
    if not dry_run:
        _update_managed_projections(store, projections, generation_id=swap.generation_id)
        save_store(topic_root, store)

    return ApplyResult(
        activated_manifest_id=record["manifestId"],
        deactivated_manifest_ids=[m["manifestId"] for m in deactivated],
        affected_concepts=sorted(affected),
        swap=swap,
        legacy_report=report_legacy_provenance(topic_root, store),
    )


def disable_source_revision(
    topic_root: Path,
    source_id: str,
    source_revision: str,
    *,
    dry_run: bool = False,
    force_full_rebuild: bool = False,
) -> ApplyResult:
    """Deactivate one source revision and rebuild from remaining active set."""
    return _remove_or_disable(
        topic_root,
        source_id,
        source_revision=source_revision,
        dry_run=dry_run,
        force_full_rebuild=force_full_rebuild,
    )


def remove_source(
    topic_root: Path,
    source_id: str,
    *,
    dry_run: bool = False,
    force_full_rebuild: bool = False,
) -> ApplyResult:
    """Deactivate all manifests for a source and rebuild projections."""
    return _remove_or_disable(
        topic_root,
        source_id,
        source_revision=None,
        dry_run=dry_run,
        force_full_rebuild=force_full_rebuild,
    )


def _remove_or_disable(
    topic_root: Path,
    source_id: str,
    *,
    source_revision: str | None,
    dry_run: bool,
    force_full_rebuild: bool,
) -> ApplyResult:
    topic_root = Path(topic_root)
    store = load_store(topic_root)
    deactivated = deactivate_manifests_for_source(
        store, source_id, source_revision=source_revision
    )
    if not deactivated:
        return ApplyResult(
            activated_manifest_id=None,
            deactivated_manifest_ids=[],
            affected_concepts=[],
            swap=SwapResult(generation_id="noop"),
            legacy_report=report_legacy_provenance(topic_root, store),
        )

    affected = compute_affected_topic_closure(
        *(m.get("affectedConceptKeys", []) for m in deactivated)
    )
    summary_paths: set[str] = set()
    for m in deactivated:
        for raw in m.get("contributions", []):
            if raw.get("kind") == "summary_input" and raw.get("payload", {}).get("sourcePath"):
                summary_paths.add(str(raw["payload"]["sourcePath"]))

    ensure_safe_for_destructive_retraction(
        topic_root,
        affected,
        store,
        force_full_rebuild=force_full_rebuild,
        summary_paths=summary_paths,
        rewrite_contradictions=True,
    )

    projections = rebuild_projections_from_active(
        store,
        affected_concepts=affected,
        rebuild_summaries_for=frozenset(summary_paths),
        rebuild_contradictions=True,
    )
    active_summary_sources = {
        str(c.payload.get("sourcePath"))
        for c in collect_active_contributions(store)
        if c.kind == "summary_input" and c.payload.get("sourcePath")
    }
    for source_path in summary_paths:
        if source_path not in active_summary_sources:
            slug = slugify(Path(source_path).stem)
            projections[f"summaries/{slug}.md"] = ""

    swap = atomic_generation_swap(topic_root, projections, dry_run=dry_run)
    if not dry_run:
        _update_managed_projections(store, projections, generation_id=swap.generation_id)
        save_store(topic_root, store)

    return ApplyResult(
        activated_manifest_id=None,
        deactivated_manifest_ids=[m["manifestId"] for m in deactivated],
        affected_concepts=sorted(affected),
        swap=swap,
        legacy_report=report_legacy_provenance(topic_root, store),
    )


# ---------------------------------------------------------------------------
# Compile pipeline integration helpers
# ---------------------------------------------------------------------------


def contributions_from_extraction_group(
    *,
    source_path: str,
    source_revision: str,
    extractions: Sequence[Any],
) -> list[ContributionRecord]:
    """Convert extractor.ExtractionResult-like objects into contribution records."""
    source_id = source_id_from_path(source_path)
    concepts: list[dict[str, Any]] = []
    claims: list[dict[str, Any]] = []
    relationships: list[dict[str, Any]] = []
    summary_sections: list[dict[str, Any]] = []

    for ex in extractions:
        summary = getattr(ex, "summary", None) or ""
        chunk = getattr(ex, "chunk", None)
        heading = getattr(chunk, "heading", None) if chunk is not None else None
        if summary:
            summary_sections.append({"heading": heading or "Overview", "text": summary})
        for concept in getattr(ex, "concepts", None) or []:
            if isinstance(concept, Mapping):
                concepts.append(dict(concept))
        for claim in getattr(ex, "claims", None) or []:
            if isinstance(claim, Mapping):
                claims.append(dict(claim))
        for rel in getattr(ex, "relationships", None) or []:
            if isinstance(rel, Mapping):
                relationships.append(dict(rel))

    return build_contributions_for_source(
        source_id=source_id,
        source_path=source_path,
        source_revision=source_revision,
        concepts=concepts,
        claims=claims,
        relationships=relationships,
        summary_sections=summary_sections,
    )


def contradiction_contributions_from_models(
    contradictions: Sequence[Any],
    *,
    owner_source_id: str,
) -> list[ContributionRecord]:
    """Materialize contradiction observations under a synthetic owner source."""
    observations: list[dict[str, Any]] = []
    for c in contradictions:
        claim_a = getattr(c, "claim_a", None)
        claim_b = getattr(c, "claim_b", None)
        if claim_a is None or claim_b is None:
            continue
        observations.append(
            {
                "claimA": getattr(claim_a, "content", ""),
                "claimB": getattr(claim_b, "content", ""),
                "severity": getattr(c, "severity", "nuanced"),
                "resolution": getattr(c, "resolution", None),
                "sourcePathA": getattr(claim_a, "source", None),
                "sourcePathB": getattr(claim_b, "source", None),
            }
        )
    return build_contributions_for_source(
        source_id=owner_source_id,
        source_path="_contradictions",
        source_revision=sha256_digest(canonical_json(observations)),
        contradictions=observations,
    )


def apply_compile_extractions(
    topic_root: Path,
    by_source: Mapping[str, Sequence[Any]],
    *,
    source_revisions: Mapping[str, str],
    contradictions: Sequence[Any] = (),
    dry_run: bool = False,
    force_full_rebuild: bool = False,
) -> list[ApplyResult]:
    """Apply per-source manifests then a derived contradiction owner manifest.

    Legacy projections fail closed by default. A caller may set
    ``force_full_rebuild`` only for an explicit, operator-reviewed migration or
    rebuild that is allowed to replace unknown-provenance output.
    """
    results: list[ApplyResult] = []
    topic_root = Path(topic_root)

    for source_path, extractions in sorted(by_source.items()):
        revision = source_revisions.get(source_path) or source_revision_from_bytes(source_path)
        source_id = source_id_from_path(source_path)
        contribs = contributions_from_extraction_group(
            source_path=source_path,
            source_revision=revision,
            extractions=extractions,
        )
        manifest = build_manifest(
            source_id=source_id,
            source_revision=revision,
            contributions=contribs,
        )
        results.append(
            apply_source_revision(
                topic_root,
                manifest,
                dry_run=dry_run,
                force_full_rebuild=force_full_rebuild,
                rebuild_contradictions=False,
            )
        )

    if contradictions:
        owner_id = "source/compiler-contradictions"
        ccontribs = contradiction_contributions_from_models(
            contradictions, owner_source_id=owner_id
        )
        crev = source_revision_from_bytes(canonical_json([c.to_dict() for c in ccontribs]))
        cmanifest = build_manifest(
            source_id=owner_id,
            source_revision=crev,
            contributions=ccontribs,
        )
        results.append(
            apply_source_revision(
                topic_root,
                cmanifest,
                dry_run=dry_run,
                force_full_rebuild=force_full_rebuild,
                rebuild_contradictions=True,
            )
        )
    else:
        # Still refresh contradictions page from remaining active observations.
        store = load_store(topic_root)
        projections = rebuild_projections_from_active(
            store,
            affected_concepts=frozenset(),
            rebuild_summaries_for=frozenset(),
            rebuild_contradictions=True,
        )
        swap = atomic_generation_swap(topic_root, projections, dry_run=dry_run)
        if not dry_run:
            _update_managed_projections(store, projections, generation_id=swap.generation_id)
            save_store(topic_root, store)

    return results
