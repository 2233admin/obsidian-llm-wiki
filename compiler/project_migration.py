"""Safe, auditable migration for legacy Project layouts.

Inventory and planning are side-effect free.  Applying a plan is explicit,
hash-guarded, path-confined, and atomic per file.  Each applied batch stores
backups plus a resumable/restorable manifest under ``.vault-mind``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

import project_context
import workspace
from _md_parse import FRONTMATTER_RE, parse_frontmatter

MIGRATION_ROOT = ".vault-mind/project-migrations"
MANIFEST_VERSION = 1


class MigrationError(RuntimeError):
    code = "migration_error"

    def __init__(self, message: str, *, details: Optional[list[dict[str, Any]]] = None):
        super().__init__(message)
        self.details = details or []


class MigrationConflict(MigrationError):
    code = "migration_conflict"


class StalePrecondition(MigrationError):
    code = "stale_precondition"


class PathEscape(MigrationError):
    code = "path_escape"


class MigrationBusy(MigrationError):
    code = "migration_busy"


@contextmanager
def _migration_lock(vault: Path):
    """Serialize migration validate/backup/manifest/write transactions.

    The lock never performs automatic stale takeover: age cannot prove
    ownership ended, and unlinking an observed lock would introduce an ABA
    race.  Recovery is an explicit operator action after owner verification.
    """
    path = vault / MIGRATION_ROOT / "_migration.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    token = f"{os.getpid()}:{time.time_ns()}"
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            os.write(descriptor, token.encode("utf-8"))
        finally:
            os.close(descriptor)
    except FileExistsError as exc:
        raise MigrationBusy(
            "Project migration is busy; if the lock is abandoned, verify its "
            f"recorded owner is no longer active before removing {path}"
        ) from exc
    try:
        yield
    finally:
        try:
            if path.read_text("utf-8") == token:
                path.unlink(missing_ok=True)
        except FileNotFoundError:
            pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_hash(path: Path) -> Optional[str]:
    try:
        return sha256_bytes(path.read_bytes())
    except FileNotFoundError:
        return None


def _relative(vault: Path, path: Path) -> str:
    return path.relative_to(vault).as_posix()


def _files(root: Path, pattern: str = "*") -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(path for path in root.glob(pattern) if path.is_file())


def _record(path: Path, vault: Path, *, kind: str,
            ownership: str, retired: bool = False) -> dict[str, Any]:
    data = path.read_bytes()
    result: dict[str, Any] = {
        "kind": kind,
        "path": _relative(vault, path),
        "hash": sha256_bytes(data),
        "ownership": ownership,
    }
    if retired:
        result["retired"] = True
    if path.suffix.lower() == ".md":
        frontmatter = parse_frontmatter(data.decode("utf-8-sig", errors="replace"))
        result["entity"] = frontmatter.get("entity")
        result["lifecycle"] = frontmatter.get("lifecycle") or frontmatter.get("status")
        result["aliases"] = frontmatter.get("aliases") or frontmatter.get("alias") or []
    return result


def inventory_project_layout(vault: str | Path) -> dict[str, Any]:
    """Inventory every Project representation without writing or leasing."""
    vault_path = Path(vault).resolve()
    shared_records = [
        _record(path, vault_path, kind="shared_project_record", ownership="registry")
        for path in _files(vault_path / "Projects", "*.md")
    ]

    domain_roots: list[dict[str, Any]] = []
    for root_name, ownership in (
        ("01-Projects", "work_os"), ("10-Projects", "knowledge"),
    ):
        root = vault_path / root_name
        if not root.is_dir():
            continue
        for child in sorted(path for path in root.iterdir() if path.is_dir()):
            domain_roots.append({
                "kind": "domain_root",
                "path": _relative(vault_path, child),
                "slug": child.name,
                "proposed_project_id": _candidate_project_id(child.name),
                "ownership": ownership,
            })

    work_anchors: list[dict[str, Any]] = []
    work_root = vault_path / "01-Projects"
    if work_root.is_dir():
        for anchor in sorted(work_root.glob("*/_project.md")):
            work_anchors.append(
                _record(anchor, vault_path, kind="work_os_anchor", ownership="work_os")
            )

    legacy_work: list[dict[str, Any]] = []
    shared_root = vault_path / "Projects"
    if shared_root.is_dir():
        for path in sorted(shared_root.glob("*/issues/*.md")):
            item = _record(path, vault_path, kind="legacy_issue", ownership="legacy")
            item["proposed_destination"] = (
                f"01-Projects/{path.parents[1].name}/issues/{path.name}"
            )
            legacy_work.append(item)
    knowledge_root = vault_path / "10-Projects"
    if knowledge_root.is_dir():
        for path in sorted(knowledge_root.glob("*/docket/**/*.md")):
            slug = path.relative_to(knowledge_root).parts[0]
            item = _record(
                path, vault_path, kind="retired_docket_item",
                ownership="retired", retired=True,
            )
            item["proposed_destination"] = f"01-Projects/{slug}/issues/{path.name}"
            legacy_work.append(item)

    binding_path = vault_path / ".vault-mind" / "local-bindings.json"
    bindings = workspace.load_bindings(vault_path)
    binding_records = [
        {
            "reference": reference,
            "binding": bindings[reference],
            "hash": file_hash(binding_path),
            "path": ".vault-mind/local-bindings.json",
            "ownership": "local_runtime",
        }
        for reference in sorted(bindings)
    ]

    runtime_records: list[dict[str, Any]] = []
    for relative, kind in (
        (".vault-mind/_leases.json", "leases"),
        (".vault-mind/local-bindings.json", "bindings"),
    ):
        path = vault_path / relative
        if path.is_file():
            runtime_records.append(_record(
                path, vault_path, kind=kind, ownership="local_runtime"))
    if work_root.is_dir():
        for path in sorted(work_root.glob("*/workflow/**/*")):
            if path.is_file():
                runtime_records.append(_record(
                    path, vault_path, kind="workflow", ownership="work_os"))

    return {
        "vault": vault_path.as_posix(),
        "shared_records": shared_records,
        "domain_roots": domain_roots,
        "work_anchors": work_anchors,
        "legacy_work": legacy_work,
        "bindings": binding_records,
        "runtime_records": runtime_records,
        "counts": {
            "shared_records": len(shared_records),
            "domain_roots": len(domain_roots),
            "work_anchors": len(work_anchors),
            "legacy_work": len(legacy_work),
            "bindings": len(binding_records),
            "runtime_records": len(runtime_records),
        },
    }


def _candidate_project_id(slug: str) -> Optional[str]:
    try:
        return project_context.normalize_project_id(slug, allow_bare=True)
    except project_context.InvalidProjectId:
        return None


def _as_aliases(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    return [str(item) for item in value] if isinstance(value, list) else []


def _conflicts(inventory: dict[str, Any]) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    identities: dict[str, list[str]] = {}
    aliases: dict[str, set[str]] = {}
    lifecycles: dict[str, set[str]] = {}
    for record in inventory["shared_records"]:
        entity = record.get("entity")
        candidate = None
        if isinstance(entity, str):
            try:
                candidate = project_context.normalize_project_id(entity, allow_bare=True)
            except project_context.InvalidProjectId:
                pass
        if candidate is None:
            conflicts.append({
                "code": "unresolved_project_identity", "path": record["path"],
                "path_basename_evidence": Path(record["path"]).stem,
            })
            continue
        if Path(record["path"]).stem != candidate.split("/", 1)[1]:
            conflicts.append({
                "code": "record_filename_mismatch", "path": record["path"],
                "project_id": candidate,
            })
        identities.setdefault(candidate, []).append(record["path"])
        for alias in _as_aliases(record.get("aliases")):
            aliases.setdefault(alias.casefold(), set()).add(candidate)
        lifecycle = record.get("lifecycle")
        if lifecycle:
            lifecycles.setdefault(candidate, set()).add(str(lifecycle).lower())

    for project_id, paths in identities.items():
        if len(paths) > 1:
            conflicts.append({
                "code": "duplicate_project_id", "project_id": project_id,
                "paths": sorted(paths),
            })
    for alias, owners in aliases.items():
        if len(owners) > 1:
            conflicts.append({
                "code": "duplicate_alias", "alias": alias,
                "project_ids": sorted(owners),
            })
    for project_id, values in lifecycles.items():
        if len(values) > 1:
            conflicts.append({
                "code": "incompatible_lifecycle", "project_id": project_id,
                "values": sorted(values),
            })

    return sorted(conflicts, key=lambda item: json.dumps(item, sort_keys=True))


def _upsert_frontmatter(text: str, updates: dict[str, str]) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    match = FRONTMATTER_RE.match(normalized)
    if not match:
        header = ["---", *(f"{key}: {value}" for key, value in updates.items()), "---"]
        return "\n".join(header) + "\n\n" + normalized.lstrip("\n")

    block = match.group(0)
    lines = block.splitlines()
    for key, value in updates.items():
        field = re.compile(rf"^{re.escape(key)}\s*:")
        for index in range(1, len(lines) - 1):
            if field.match(lines[index]):
                lines[index] = f"{key}: {value}"
                break
        else:
            lines.insert(len(lines) - 1, f"{key}: {value}")
    return "\n".join(lines) + "\n" + normalized[match.end():]


def _shared_record_from_anchor(anchor: Path, project_id: str) -> bytes:
    """Render the minimal portable registry record for one valid Work-OS anchor."""
    frontmatter = parse_frontmatter(
        anchor.read_text("utf-8-sig", errors="replace"))
    raw_lifecycle = frontmatter.get("lifecycle") or frontmatter.get("status")
    lifecycle = str(raw_lifecycle).strip().lower() if raw_lifecycle else "active"
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", lifecycle):
        lifecycle = "active"
    slug = project_id.split("/", 1)[1]
    return (
        "---\n"
        "type: project\n"
        f"entity: {project_id}\n"
        f"lifecycle: {lifecycle}\n"
        "aliases: []\n"
        "---\n\n"
        f"# {slug}\n"
    ).encode("utf-8")


def _action(vault: Path, path: Path, content: bytes, *, reason: str,
            source: Optional[Path] = None) -> dict[str, Any]:
    result = {
        "kind": "write",
        "path": _relative(vault, path),
        "reason": reason,
        "expected_hash": file_hash(path),
        "content_hash": sha256_bytes(content),
        "content": content.decode("utf-8"),
    }
    if source is not None:
        result["source"] = _relative(vault, source)
        result["source_hash"] = file_hash(source)
    return result


def plan_project_migration(vault: str | Path) -> dict[str, Any]:
    """Return a deterministic dry-run plan; never modifies the vault."""
    vault_path = Path(vault).resolve()
    inventory = inventory_project_layout(vault_path)
    conflicts = _conflicts(inventory)
    actions: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    redirects: list[dict[str, str]] = []
    registered_ids: set[str] = set()
    registry_alias_owners: dict[str, set[str]] = {}
    for record in inventory["shared_records"]:
        raw_entity = record.get("entity")
        if not isinstance(raw_entity, str):
            continue
        try:
            registered_id = project_context.normalize_project_id(
                raw_entity, allow_bare=True)
        except project_context.InvalidProjectId:
            continue
        registered_ids.add(registered_id)
        registered_slug = registered_id.split("/", 1)[1]
        for alias in {registered_slug, *_as_aliases(record.get("aliases"))}:
            registry_alias_owners.setdefault(alias.casefold(), set()).add(
                registered_id)
    adopted_project_ids: dict[str, str] = {}

    for record in inventory["shared_records"]:
        path = vault_path / record["path"]
        candidate = None
        if isinstance(record.get("entity"), str):
            try:
                candidate = project_context.normalize_project_id(
                    record["entity"], allow_bare=True)
            except project_context.InvalidProjectId:
                pass
        if candidate and record.get("entity") != candidate:
            content = _upsert_frontmatter(
                path.read_text("utf-8-sig", errors="replace"), {"entity": candidate}
            ).encode("utf-8")
            actions.append(_action(
                vault_path, path, content, reason="canonicalize_shared_project_id"))

    for anchor in inventory["work_anchors"]:
        path = vault_path / anchor["path"]
        candidate = None
        if isinstance(anchor.get("entity"), str):
            try:
                candidate = project_context.normalize_project_id(
                    anchor["entity"], allow_bare=True)
            except project_context.InvalidProjectId:
                pass
        if candidate is None:
            conflicts.append({
                "code": "unresolved_work_anchor_identity", "path": anchor["path"],
                "path_basename_evidence": path.parent.name,
            })
            continue
        slug = candidate.split("/", 1)[1]
        if path.parent.name != slug:
            conflicts.append({
                "code": "work_anchor_path_mismatch", "path": anchor["path"],
                "project_id": candidate, "path_basename_evidence": path.parent.name,
            })
        elif candidate not in registered_ids:
            alias_owners = sorted(
                owner for owner in registry_alias_owners.get(slug.casefold(), set())
                if owner != candidate
            )
            destination = vault_path / "Projects" / f"{slug}.md"
            if alias_owners:
                conflicts.append({
                    "code": "anchor_identity_conflicts_with_registry_alias",
                    "path": anchor["path"], "project_id": candidate,
                    "alias": slug, "project_ids": alias_owners,
                })
            elif destination.exists():
                conflicts.append({
                    "code": "anchor_registry_destination_occupied",
                    "path": anchor["path"], "project_id": candidate,
                    "destination": _relative(vault_path, destination),
                })
            else:
                actions.append(_action(
                    vault_path,
                    destination,
                    _shared_record_from_anchor(path, candidate),
                    reason="adopt_work_os_anchor_as_shared_project",
                    source=path,
                ))
                adopted_project_ids[slug] = candidate
        if candidate and anchor.get("entity") != candidate:
            content = _upsert_frontmatter(
                path.read_text("utf-8-sig", errors="replace"), {"entity": candidate}
            ).encode("utf-8")
            actions.append(_action(
                vault_path, path, content, reason="align_work_os_anchor_project_id"))

    raw_bindings = workspace.load_bindings(vault_path)
    normalized_bindings: dict[str, Any] = {}
    binding_changed = False
    for reference in sorted(raw_bindings):
        try:
            canonical = project_context.normalize_project_id(reference, allow_bare=True)
        except project_context.InvalidProjectId:
            warnings.append({"code": "invalid_binding_identity", "reference": reference})
            normalized_bindings[reference] = raw_bindings[reference]
            continue
        if canonical in normalized_bindings and normalized_bindings[canonical] != raw_bindings[reference]:
            conflicts.append({
                "code": "duplicate_binding_identity", "project_id": canonical,
                "references": sorted([reference, canonical]),
            })
            continue
        normalized_bindings[canonical] = raw_bindings[reference]
        binding_changed = binding_changed or canonical != reference
    if binding_changed:
        binding_path = vault_path / ".vault-mind" / "local-bindings.json"
        content = json.dumps(
            {key: normalized_bindings[key] for key in sorted(normalized_bindings)},
            indent=2, ensure_ascii=False,
        ).encode("utf-8")
        actions.append(_action(
            vault_path, binding_path, content, reason="canonicalize_local_binding_ids"))

    identity_index: dict[str, set[str]] = {}
    for record in inventory["shared_records"]:
        raw_entity = record.get("entity")
        if not isinstance(raw_entity, str):
            continue
        try:
            project_id = project_context.normalize_project_id(
                raw_entity, allow_bare=True)
        except project_context.InvalidProjectId:
            continue
        keys = {project_id.split("/", 1)[1], *_as_aliases(record.get("aliases"))}
        for key in keys:
            identity_index.setdefault(key.casefold(), set()).add(project_id)
    for slug, project_id in adopted_project_ids.items():
        identity_index.setdefault(slug.casefold(), set()).add(project_id)

    for item in inventory["legacy_work"]:
        source = vault_path / item["path"]
        evidence_slug = Path(item["proposed_destination"]).parts[1]
        matches = sorted(identity_index.get(evidence_slug.casefold(), set()))
        if len(matches) != 1:
            conflicts.append({
                "code": ("ambiguous_legacy_work_identity" if matches
                         else "unresolved_legacy_work_identity"),
                "source": item["path"],
                "path_basename_evidence": evidence_slug,
                "project_ids": matches,
            })
            continue
        slug = matches[0].split("/", 1)[1]
        destination_relative = f"01-Projects/{slug}/issues/{source.name}"
        destination = vault_path / destination_relative
        content = source.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        issue_slug = destination.stem
        entity = f"project/{slug}/issue/{issue_slug}"
        text = _upsert_frontmatter(
            content.decode("utf-8-sig", errors="replace"), {"entity": entity}
        ).encode("utf-8")
        destination_hash = file_hash(destination)
        if destination_hash == sha256_bytes(text):
            continue
        if destination_hash is not None:
            conflicts.append({
                "code": "divergent_destination",
                "source": item["path"],
                "destination": destination_relative,
            })
            continue
        actions.append(_action(
            vault_path, destination, text,
            reason=("migrate_retired_docket_to_work_os" if item.get("retired")
                    else "migrate_legacy_issue_to_work_os"),
            source=source,
        ))
        redirects.append({
            "source": item["path"], "destination": destination_relative,
            "mode": "compatibility_read_only",
        })

    conflicts = sorted(conflicts, key=lambda item: json.dumps(item, sort_keys=True))
    actions.sort(key=lambda item: (item["path"], item["reason"]))
    plan_core = {
        "version": MANIFEST_VERSION,
        "vault": vault_path.as_posix(),
        "apply": False,
        "inventory": inventory,
        "actions": actions,
        "redirects": sorted(redirects, key=lambda item: item["source"]),
        "warnings": warnings,
        "conflicts": conflicts,
        "retained_domain_ownership": {
            "Projects": "registry",
            "01-Projects": "work_os",
            "10-Projects": "knowledge",
            ".vault-mind": "local_runtime",
        },
    }
    plan_core["plan_hash"] = _compute_plan_hash(plan_core)
    return plan_core


def _compute_plan_hash(plan: dict[str, Any]) -> str:
    digestable = {key: value for key, value in plan.items() if key != "plan_hash"}
    digestable["actions"] = [
        {key: value for key, value in action.items() if key != "content"}
        for action in plan.get("actions", [])
    ]
    return sha256_bytes(
        json.dumps(digestable, sort_keys=True, ensure_ascii=False).encode("utf-8"))


def _safe_target(vault: Path, relative: str) -> Path:
    candidate = (vault / relative).resolve()
    try:
        rel = candidate.relative_to(vault)
    except ValueError as exc:
        raise PathEscape(f"Migration path escapes vault: {relative}") from exc
    parts = rel.parts
    allowed = (
        parts and parts[0] == "Projects" and len(parts) == 2 and candidate.suffix == ".md"
    ) or (
        parts and parts[0] == "01-Projects" and len(parts) >= 3
    ) or (
        rel.as_posix() == ".vault-mind/local-bindings.json"
    )
    if not allowed:
        raise PathEscape(f"Migration path is outside allowed Project writes: {relative}")
    return candidate


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".migration-tmp")
    try:
        temporary.write_bytes(data)
        temporary.replace(path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    _atomic_write(
        path,
        json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True).encode("utf-8"),
    )


def _validate_plan(vault: Path, plan: dict[str, Any], *,
                   manifest: Optional[dict[str, Any]] = None) -> list[Path]:
    if Path(plan.get("vault", "")).resolve() != vault:
        raise PathEscape("Migration plan belongs to a different vault")
    if plan.get("conflicts"):
        raise MigrationConflict("Migration plan contains review-required conflicts",
                                details=plan["conflicts"])
    targets: list[Path] = []
    stale: list[dict[str, Any]] = []
    manifest_actions = manifest.get("actions", []) if manifest else []
    prior_action_hashes: dict[str, set[Optional[str]]] = {}
    for index, action in enumerate(plan.get("actions", [])):
        target = _safe_target(vault, action["path"])
        targets.append(target)
        content_hash = sha256_bytes(action["content"].encode("utf-8"))
        if content_hash != action.get("content_hash"):
            raise MigrationConflict(
                f"Migration action content hash is invalid: {action['path']}")
        actual = file_hash(target)
        completed = (
            index < len(manifest_actions)
            and manifest_actions[index].get("status") == "completed"
        )
        expected = action["content_hash"] if completed else action.get("expected_hash")
        # A process may stop after the atomic replace and before its manifest
        # status update.  Exact desired bytes are a safe resumable state.
        acceptable = {expected, action["content_hash"]} if not completed else {expected}
        if actual not in acceptable:
            stale.append({
                "path": action["path"], "expected": expected,
                "actual": actual,
            })
        source = action.get("source")
        if source:
            source_path = (vault / source).resolve()
            try:
                source_path.relative_to(vault)
            except ValueError as exc:
                raise PathEscape(f"Migration source escapes vault: {source}") from exc
            actual_source = file_hash(source_path)
            acceptable_source_hashes = {
                action.get("source_hash"),
                *prior_action_hashes.get(source, set()),
            }
            if actual_source not in acceptable_source_hashes:
                stale.append({
                    "path": source, "expected": action.get("source_hash"),
                    "actual": actual_source,
                })
        prior_action_hashes.setdefault(action["path"], set()).add(
            action["content_hash"])
    if stale:
        raise StalePrecondition("Migration hash preconditions are stale", details=stale)
    if _compute_plan_hash(plan) != plan.get("plan_hash"):
        raise MigrationConflict("Migration plan integrity check failed")
    return targets


def apply_migration_plan(plan: dict[str, Any], *, apply: bool = False,
                         batch_id: Optional[str] = None) -> dict[str, Any]:
    """Apply a migration plan only when explicit, recording resumable backups."""
    if not apply:
        return {
            "apply": False, "plan_hash": plan.get("plan_hash"),
            "actions": len(plan.get("actions", [])), "written": [],
        }
    vault = Path(plan["vault"]).resolve()
    batch_id = batch_id or plan["plan_hash"][:16]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", batch_id):
        raise MigrationError("Invalid migration batch ID")
    with _migration_lock(vault):
        return _apply_migration_plan_locked(plan, vault=vault, batch_id=batch_id)


def _apply_migration_plan_locked(
    plan: dict[str, Any], *, vault: Path, batch_id: str
) -> dict[str, Any]:
    """Validate, back up, manifest, and write while the migration lock is held."""
    batch_root = vault / MIGRATION_ROOT / batch_id
    manifest_path = batch_root / "manifest.json"
    backup_root = batch_root / "backups"

    manifest = None
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text("utf-8-sig"))
        if manifest.get("plan_hash") != plan.get("plan_hash"):
            raise MigrationConflict("Batch ID is already used by a different plan")
    targets = _validate_plan(vault, plan, manifest=manifest)
    if manifest is not None and manifest.get("state") == "completed":
        return {**manifest, "manifest_path": manifest_path.as_posix()}
    if manifest is None:
        manifest_actions = []
        for index, (action, target) in enumerate(zip(plan.get("actions", []), targets)):
            backup = None
            if target.is_file():
                backup = f"backups/{index:04d}.bin"
            manifest_actions.append({
                "index": index,
                "path": action["path"],
                "reason": action["reason"],
                "before_hash": action.get("expected_hash"),
                "after_hash": action["content_hash"],
                "backup": backup,
                "status": "pending",
            })
        manifest = {
            "version": MANIFEST_VERSION,
            "batch_id": batch_id,
            "plan_hash": plan["plan_hash"],
            "state": "applying",
            "actions": manifest_actions,
        }
        backup_contents: list[tuple[Path, bytes]] = []
        observed_hashes: dict[str, Optional[str]] = {}
        for entry, action, target in zip(
            manifest_actions, plan.get("actions", []), targets
        ):
            observed = observed_hashes.setdefault(action["path"], file_hash(target))
            if observed != action.get("expected_hash"):
                raise StalePrecondition(
                    f"Migration target drifted before backup: {action['path']}"
                )
            if entry["backup"]:
                content = target.read_bytes()
                if sha256_bytes(content) != entry["before_hash"]:
                    raise StalePrecondition(
                        f"Migration target drifted while backing up: {entry['path']}"
                    )
                backup_contents.append((batch_root / entry["backup"], content))
        batch_root.mkdir(parents=True, exist_ok=True)
        backup_root.mkdir(parents=True, exist_ok=True)
        for backup_path, content in backup_contents:
            _atomic_write(backup_path, content)
        _atomic_json(manifest_path, manifest)

    written: list[str] = []
    prior_after_hashes: dict[str, str] = {}
    for entry, action, target in zip(manifest["actions"], plan.get("actions", []), targets):
        content = action["content"].encode("utf-8")
        if entry["status"] == "completed":
            if file_hash(target) != entry["after_hash"]:
                raise StalePrecondition(
                    f"Completed migration action drifted: {entry['path']}")
            prior_after_hashes[action["path"]] = entry["after_hash"]
            continue
        expected_before = prior_after_hashes.get(
            action["path"], entry.get("before_hash")
        )
        actual = file_hash(target)
        # Recover from a crash after the file replace but before manifest update.
        if actual != entry["after_hash"]:
            if actual != expected_before:
                raise StalePrecondition(
                    f"Migration target drifted before replace: {entry['path']}"
                )
            source = action.get("source")
            if source:
                source_path = (vault / source).resolve()
                expected_source = prior_after_hashes.get(
                    source, action.get("source_hash")
                )
                if file_hash(source_path) != expected_source:
                    raise StalePrecondition(
                        f"Migration source drifted before replace: {source}"
                    )
            _atomic_write(target, content)
        entry["status"] = "completed"
        written.append(target.as_posix())
        prior_after_hashes[action["path"]] = entry["after_hash"]
        _atomic_json(manifest_path, manifest)

    manifest["state"] = "completed"
    _atomic_json(manifest_path, manifest)
    return {
        **manifest,
        "apply": True,
        "written": written,
        "manifest_path": manifest_path.as_posix(),
    }


def restore_migration(vault: str | Path, manifest: str | Path, *,
                      apply: bool = False) -> dict[str, Any]:
    """Plan or explicitly restore an applied migration batch in reverse order."""
    vault_path = Path(vault).resolve()
    manifest_path = Path(manifest).resolve()
    if apply:
        with _migration_lock(vault_path):
            return _restore_migration_locked(vault_path, manifest_path, apply=True)
    return _restore_migration_locked(vault_path, manifest_path, apply=False)


def _restore_migration_locked(
    vault_path: Path, manifest_path: Path, *, apply: bool
) -> dict[str, Any]:
    """Validate and restore a batch while the dedicated migration lock is held."""
    migration_root = (vault_path / MIGRATION_ROOT).resolve()
    try:
        manifest_path.relative_to(migration_root)
    except ValueError as exc:
        raise PathEscape("Manifest is outside the migration audit root") from exc
    data = json.loads(manifest_path.read_text("utf-8-sig"))
    restore_actions = [
        {
            "path": entry["path"],
            "restore_hash": entry.get("before_hash"),
            "current_hash": entry.get("after_hash"),
            "backup": entry.get("backup"),
        }
        for entry in reversed(data.get("actions", []))
        if entry.get("status") == "completed"
    ]
    result = {"apply": apply, "restore_actions": restore_actions, "restored": []}
    if not apply:
        return result

    prepared: list[
        tuple[dict[str, Any], dict[str, Any], Path, Optional[bytes]]
    ] = []
    manifest_entries = [
        entry for entry in reversed(data.get("actions", []))
        if entry.get("status") == "completed"
    ]
    for entry, restore_entry in zip(manifest_entries, restore_actions):
        target = _safe_target(vault_path, restore_entry["path"])
        content = None
        if restore_entry["backup"]:
            backup = manifest_path.parent / restore_entry["backup"]
            content = backup.read_bytes()
            if sha256_bytes(content) != restore_entry["restore_hash"]:
                raise StalePrecondition(f"Migration backup hash mismatch: {backup}")
        actual = file_hash(target)
        restore_hash = restore_entry["restore_hash"]
        if entry.get("restore_status") == "completed":
            if actual != restore_hash:
                raise StalePrecondition(
                    f"Restored file drifted: {restore_entry['path']}"
                )
        elif actual not in {restore_entry["current_hash"], restore_hash}:
            raise StalePrecondition(
                "Migrated file changed after apply and cannot be restored safely: "
                f"{restore_entry['path']}"
            )
        prepared.append((entry, restore_entry, target, content))

    data["state"] = "restoring"
    for entry in manifest_entries:
        entry.setdefault("restore_status", "pending")
    _atomic_json(manifest_path, data)

    for entry, restore_entry, target, content in prepared:
        restore_hash = restore_entry["restore_hash"]
        actual = file_hash(target)
        if entry["restore_status"] == "completed":
            if actual != restore_hash:
                raise StalePrecondition(
                    f"Restored file drifted: {restore_entry['path']}"
                )
            continue
        # Exact restored bytes mean the process stopped after replace/delete
        # and before its manifest receipt.  Any other change is human drift.
        if actual != restore_hash:
            if actual != restore_entry["current_hash"]:
                raise StalePrecondition(
                    f"Migration target drifted before restore: {restore_entry['path']}"
                )
            if content is not None:
                _atomic_write(target, content)
            else:
                target.unlink(missing_ok=True)
        entry["restore_status"] = "completed"
        result["restored"].append(target.as_posix())
        _atomic_json(manifest_path, data)
    data["state"] = "restored"
    _atomic_json(manifest_path, data)
    return result
