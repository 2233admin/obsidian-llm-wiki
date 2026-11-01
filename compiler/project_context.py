"""Canonical Project identity and context resolution for the Python runtime.

The module is intentionally stdlib-only and read-only.  It joins the shared
``Projects/<slug>.md`` registry with machine-local bindings without turning a
repository path (or any of the domain roots) into Project identity.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Iterable, Optional

from _md_parse import parse_frontmatter

PROJECT_ID_PREFIX = "project/"
PROJECT_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$")
SHARED_PROJECTS_ROOT = "Projects"
WORK_OS_ROOT = "01-Projects"
KNOWLEDGE_ROOT = "10-Projects"
LOCAL_RUNTIME_ROOT = ".vault-mind"


class ProjectContextError(ValueError):
    """Base class for deterministic resolver failures."""

    code = "project_context_error"

    def __init__(self, message: str, *, reference: Any = None,
                 candidates: Optional[list[str]] = None):
        super().__init__(message)
        self.reference = reference
        self.candidates = sorted(candidates or [])

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": str(self),
            "reference": self.reference,
            "candidates": self.candidates,
        }


class InvalidProjectId(ProjectContextError):
    code = "invalid_project_id"


class ProjectNotFound(ProjectContextError):
    code = "project_not_found"


class AmbiguousProjectReference(ProjectContextError):
    code = "ambiguous_project_reference"


def parse_project_id(value: str) -> dict[str, str]:
    """Parse an exact canonical ``project/<lowercase-kebab>`` identity."""
    if not isinstance(value, str):
        raise InvalidProjectId("Project ID must be a string", reference=value)
    raw = value.strip()
    if not raw.startswith(PROJECT_ID_PREFIX):
        raise InvalidProjectId(
            "Project ID must use the project/<slug> form", reference=value)
    slug = raw[len(PROJECT_ID_PREFIX):]
    if not PROJECT_SLUG_RE.fullmatch(slug):
        raise InvalidProjectId(
            "Project slug must be lowercase kebab-case and at most 80 characters",
            reference=value,
        )
    return {"project_id": f"{PROJECT_ID_PREFIX}{slug}", "slug": slug}


def normalize_project_id(value: str, *, allow_bare: bool = False) -> str:
    """Return the canonical ID, optionally accepting a bare compatibility slug.

    Bare inputs are validated, never slugified.  This prevents two runtimes from
    silently assigning different identities to the same display name.
    """
    if not isinstance(value, str):
        raise InvalidProjectId("Project reference must be a string", reference=value)
    raw = value.strip()
    if allow_bare and PROJECT_SLUG_RE.fullmatch(raw):
        raw = f"{PROJECT_ID_PREFIX}{raw}"
    return parse_project_id(raw)["project_id"]


def _list_value(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _looks_absolute_path(value: str) -> bool:
    return bool(re.match(r"^[A-Za-z]:[\\/]", value)) or value.startswith(("/", "\\\\"))


def _projection_descriptors(frontmatter: dict[str, Any]) -> list[dict[str, str]]:
    values = _list_value(frontmatter.get("external-projections"))
    values += _list_value(frontmatter.get("projections"))
    out: list[dict[str, str]] = []
    for value in values:
        if _looks_absolute_path(value):
            continue
        kind, separator, target = value.partition(":")
        descriptor = {
            "kind": kind if separator else "reference",
            "target": target if separator else value,
        }
        if descriptor not in out:
            out.append(descriptor)
    return sorted(out, key=lambda item: (item["kind"], item["target"]))


def read_shared_project_record(path: Path) -> dict[str, Any]:
    """Read one shared record, exposing identity/lifecycle/aliases safely."""
    diagnostics: list[dict[str, str]] = []
    try:
        text = path.read_text("utf-8-sig", errors="replace")
    except OSError as exc:
        return {
            "path": f"{SHARED_PROJECTS_ROOT}/{path.name}",
            "project_id": None,
            "slug": path.stem,
            "lifecycle": "unknown",
            "aliases": [],
            "projections": [],
            "diagnostics": [{"code": "record_unreadable", "message": str(exc)}],
        }

    frontmatter = parse_frontmatter(text)
    raw_entity = frontmatter.get("entity")
    project_id: Optional[str] = None
    if isinstance(raw_entity, str):
        try:
            project_id = normalize_project_id(raw_entity)
        except InvalidProjectId as exc:
            diagnostics.append({"code": exc.code, "message": str(exc)})
    else:
        diagnostics.append({
            "code": "missing_project_id",
            "message": "Shared project record has no canonical entity field",
        })

    filename_slug = path.stem
    slug = project_id.split("/", 1)[1] if project_id else filename_slug
    if project_id and filename_slug != slug:
        diagnostics.append({
            "code": "record_filename_mismatch",
            "message": f"Record filename {filename_slug!r} differs from Project ID slug {slug!r}",
        })

    aliases = _list_value(frontmatter.get("aliases") or frontmatter.get("alias"))
    aliases = sorted(set(alias for alias in aliases if alias and alias != project_id))
    lifecycle = str(
        frontmatter.get("lifecycle") or frontmatter.get("status") or "unknown"
    ).strip().lower()

    forbidden_fields = ("path", "workspace-path", "local-path", "secret", "token")
    for field in forbidden_fields:
        if field in frontmatter:
            diagnostics.append({
                "code": "forbidden_shared_field",
                "message": f"Machine-local or secret field {field!r} is ignored",
            })

    return {
        "path": f"{SHARED_PROJECTS_ROOT}/{path.name}",
        "project_id": project_id,
        "slug": slug,
        "lifecycle": lifecycle,
        "aliases": aliases,
        "projections": _projection_descriptors(frontmatter),
        "diagnostics": diagnostics,
    }


def load_project_records(vault: str | Path) -> list[dict[str, Any]]:
    root = Path(vault) / SHARED_PROJECTS_ROOT
    if not root.is_dir():
        return []
    return [read_shared_project_record(path) for path in sorted(root.glob("*.md"))]


def _load_bindings(vault: Path) -> tuple[dict[str, Any], list[dict[str, str]]]:
    # Local import avoids making workspace import this module and creating a cycle.
    import workspace

    raw = workspace.load_bindings(vault)
    bindings: dict[str, Any] = {}
    diagnostics: list[dict[str, str]] = []
    for reference in sorted(raw):
        value = raw[reference]
        try:
            project_id = normalize_project_id(reference, allow_bare=True)
        except InvalidProjectId:
            diagnostics.append({
                "code": "invalid_binding_identity",
                "message": f"Ignored local binding with invalid identity {reference!r}",
            })
            continue
        if reference != project_id:
            diagnostics.append({
                "code": "legacy_binding_identity",
                "message": f"Local binding {reference!r} should use {project_id}",
            })
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            diagnostics.append({
                "code": "invalid_binding",
                "message": f"Ignored malformed local binding for {reference!r}",
            })
            continue
        if project_id in bindings and bindings[project_id] != value:
            diagnostics.append({
                "code": "duplicate_binding_identity",
                "message": f"Multiple local bindings normalize to {project_id}",
            })
            continue
        bindings[project_id] = dict(value)
    return bindings, diagnostics


def _normalized_path(value: str | Path) -> str:
    try:
        return os.path.normcase(str(Path(value).resolve()))
    except OSError:
        return os.path.normcase(str(Path(value).absolute()))


def _record_index(records: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    index: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        project_id = record.get("project_id")
        if not project_id:
            continue
        keys = {project_id, record["slug"], *record.get("aliases", [])}
        for key in keys:
            normalized = str(key).strip().casefold()
            if normalized:
                index.setdefault(normalized, []).append(record)
    return index


def resolve_project_context(vault: str | Path, reference: str | Path) -> dict[str, Any]:
    """Resolve exact ID, alias/slug, then bound workspace path deterministically.

    The function is side-effect free.  Not-found and ambiguity are explicit and
    never create a Project or any domain directory.
    """
    vault_path = Path(vault)
    records = load_project_records(vault_path)
    record_groups: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        if record.get("project_id"):
            record_groups.setdefault(record["project_id"], []).append(record)
    bindings, binding_diagnostics = _load_bindings(vault_path)
    raw_reference = str(reference).strip()
    matched: list[dict[str, Any]] = []
    match_kind = ""

    if raw_reference.startswith(PROJECT_ID_PREFIX):
        project_id = normalize_project_id(raw_reference)
        if project_id in record_groups:
            matched = record_groups[project_id]
            match_kind = "project_id"
    else:
        index = _record_index(records)
        matched = index.get(raw_reference.casefold(), [])
        if matched:
            match_kind = "slug" if any(
                record["slug"].casefold() == raw_reference.casefold()
                for record in matched
            ) else "alias"

    if not matched and raw_reference:
        path_key = _normalized_path(raw_reference)
        bound_ids = sorted(
            project_id for project_id, binding in bindings.items()
            if _normalized_path(binding["path"]) == path_key and project_id in record_groups
        )
        matched = [record for project_id in bound_ids for record in record_groups[project_id]]
        if matched:
            match_kind = "workspace_binding"

    candidate_ids = sorted({
        record["project_id"] for record in matched if record.get("project_id")
    })
    if len(candidate_ids) > 1 or len(matched) > 1:
        raise AmbiguousProjectReference(
            f"Project reference {raw_reference!r} matches multiple Projects",
            reference=raw_reference,
            candidates=candidate_ids,
        )
    if not candidate_ids:
        raise ProjectNotFound(
            f"No registered Project matches {raw_reference!r}", reference=raw_reference)

    project_id = candidate_ids[0]
    record = record_groups[project_id][0]
    slug = record["slug"]
    diagnostics = [*record.get("diagnostics", []), *binding_diagnostics]
    if match_kind != "project_id":
        diagnostics.append({
            "code": "compatibility_project_reference",
            "message": f"Resolved {match_kind} reference {raw_reference!r} to {project_id}",
        })

    binding = bindings.get(project_id)
    workspace_binding = None
    if binding:
        path = binding["path"]
        workspace_binding = {
            **binding,
            "path": Path(path).as_posix(),
            "available": Path(path).exists(),
        }

    return {
        "project_id": project_id,
        "slug": slug,
        "lifecycle": record["lifecycle"],
        "aliases": record["aliases"],
        "roots": {
            "registry_record": record["path"],
            "work_os": f"{WORK_OS_ROOT}/{slug}",
            "knowledge": f"{KNOWLEDGE_ROOT}/{slug}",
            "runtime": LOCAL_RUNTIME_ROOT,
        },
        "workspace_binding": workspace_binding,
        "projections": record["projections"],
        "diagnostics": diagnostics,
        "resolved_by": match_kind,
    }


def normalized_project_context(context: dict[str, Any]) -> dict[str, Any]:
    """Return the shared camelCase conformance view used by both runtimes."""
    roots = context["roots"]
    return {
        "projectId": context["project_id"],
        "slug": context["slug"],
        "lifecycle": context["lifecycle"],
        "aliases": sorted(context.get("aliases", [])),
        "roots": {
            "registryRecord": roots["registry_record"],
            "workOs": roots["work_os"],
            "knowledge": roots["knowledge"],
            "runtime": roots["runtime"],
        },
        "projections": context.get("projections", []),
        "resolvedBy": context["resolved_by"],
    }


def doctor_project_context(vault: str | Path) -> dict[str, Any]:
    """Report duplicate aliases, missing anchors, stale bindings and orphans."""
    vault_path = Path(vault)
    records = load_project_records(vault_path)
    bindings, binding_diagnostics = _load_bindings(vault_path)
    findings: list[dict[str, Any]] = list(binding_diagnostics)
    alias_owners: dict[str, set[str]] = {}
    known_ids = {record["project_id"] for record in records if record.get("project_id")}

    for record in records:
        findings.extend(record.get("diagnostics", []))
        project_id = record.get("project_id")
        if not project_id:
            continue
        for alias in {record["slug"], *record.get("aliases", [])}:
            alias_owners.setdefault(alias.casefold(), set()).add(project_id)
        work_anchor = vault_path / WORK_OS_ROOT / record["slug"] / "_project.md"
        if not work_anchor.is_file():
            findings.append({
                "code": "missing_work_os_anchor",
                "project_id": project_id,
                "path": work_anchor.relative_to(vault_path).as_posix(),
            })
        else:
            anchor_frontmatter = parse_frontmatter(
                work_anchor.read_text("utf-8-sig", errors="replace"))
            if anchor_frontmatter.get("entity") != project_id:
                findings.append({
                    "code": "cross_runtime_identity_disagreement",
                    "project_id": project_id,
                    "anchor_entity": anchor_frontmatter.get("entity"),
                    "path": work_anchor.relative_to(vault_path).as_posix(),
                })
        binding = bindings.get(project_id)
        if binding and not Path(binding["path"]).exists():
            findings.append({
                "code": "stale_workspace_binding",
                "project_id": project_id,
                "path": Path(binding["path"]).as_posix(),
            })

    for alias, owners in alias_owners.items():
        if len(owners) > 1:
            findings.append({
                "code": "duplicate_alias",
                "alias": alias,
                "project_ids": sorted(owners),
            })

    for project_id in sorted(bindings):
        if project_id not in known_ids:
            findings.append({"code": "orphan_binding", "project_id": project_id})

    for root_name in (WORK_OS_ROOT, KNOWLEDGE_ROOT):
        root = vault_path / root_name
        if not root.is_dir():
            continue
        for child in sorted(path for path in root.iterdir() if path.is_dir()):
            candidate = f"{PROJECT_ID_PREFIX}{child.name}"
            if candidate not in known_ids:
                findings.append({
                    "code": "orphan_domain_root",
                    "project_id": candidate,
                    "domain": root_name,
                    "path": child.relative_to(vault_path).as_posix(),
                })

    findings.sort(key=lambda item: (
        str(item.get("code", "")), str(item.get("project_id", "")),
        str(item.get("path", "")), str(item.get("alias", "")),
    ))
    return {"project_count": len(known_ids), "findings": findings}
