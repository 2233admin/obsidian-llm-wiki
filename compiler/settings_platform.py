"""Independent Python implementation of the LLM Wiki Settings Platform contract.

This module intentionally does not invoke the TypeScript package. Both runtimes
load the same versioned JSON registry and conformance fixtures so drift is
observable instead of hidden behind a subprocess bridge.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import platform
import re
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable

SCHEMA_VERSION = 1
SCOPE_PRECEDENCE = ("session", "workspace-project", "vault", "user-device", "product")
MUTABLE_SCOPES = ("user-device", "vault", "workspace-project", "session")
SECRET_PROVIDERS = ("os-keychain", "environment", "external-vault")
PROJECT_ID_PATTERN = re.compile(r"^project/(?P<slug>[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)$")
ENVIRONMENT_SECRET_LOCATOR_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
OPAQUE_SECRET_LOCATOR_PATTERN = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:/[A-Za-z0-9][A-Za-z0-9._-]{0,63})+$"
)
SECRET_MATERIAL_PATTERN = re.compile(
    r"^(?:bearer\s+|sk[-_][A-Za-z0-9_-]{8,}|api[_-]?key\s*[:=])",
    re.IGNORECASE,
)
HOST_CAPABILITY_SETTING_KEYS = (
    "providers.host_capability.enabled",
    "providers.host_capability.provider",
    "providers.host_capability.transport",
    "providers.host_capability.endpoint",
    "providers.host_capability.secret_ref",
    "providers.host_capability.timeout_ms",
)
HOST_CONNECTOR_SELECTOR_PATTERN = re.compile(
    r"^(?:connector/)?[a-z0-9][a-z0-9._-]*(?:/[a-z0-9][a-z0-9._-]*)*$"
)
PROJECT_TRACKER_SETTING_KEYS = (
    "providers.project_tracker.enabled",
    "providers.project_tracker.provider",
    "providers.project_tracker.transport",
    "providers.project_tracker.endpoint",
    "providers.project_tracker.secret_ref",
    "providers.project_tracker.timeout_ms",
)


def default_user_device_id(environment: dict[str, str] | None = None) -> str:
    values = environment if environment is not None else os.environ
    configured = values.get("LLMWIKI_DEVICE_ID", "").strip()
    return _safe_identity(configured or f"device-{platform.node() or 'local'}")


def canonical_json(value: Any) -> str:
    return _canonical_encode(value)


def _canonical_encode(value: Any) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return _ecmascript_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(_canonical_encode(item) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("Canonical JSON object keys must be strings")
        return (
            "{"
            + ",".join(
                json.dumps(key, ensure_ascii=False) + ":" + _canonical_encode(value[key])
                for key in sorted(value, key=_utf16_sort_key)
            )
            + "}"
        )
    raise TypeError(f"Unsupported canonical JSON value: {type(value).__name__}")


def _utf16_sort_key(value: str) -> bytes:
    return value.encode("utf-16-be", errors="surrogatepass")


def _ecmascript_number(value: float) -> str:
    if not math.isfinite(value):
        raise ValueError("Canonical JSON does not support non-finite numbers")
    if value == 0:
        return "0"
    absolute = abs(value)
    spelling = repr(value).lower()
    if 1e-6 <= absolute < 1e21:
        from decimal import Decimal

        fixed = format(Decimal(spelling), "f")
        if "." in fixed:
            fixed = fixed.rstrip("0").rstrip(".")
        return fixed
    if "e" not in spelling:
        from decimal import Decimal

        spelling = format(Decimal(spelling).normalize(), "e")
    mantissa, exponent_text = spelling.split("e", 1)
    mantissa = mantissa.rstrip("0").rstrip(".") if "." in mantissa else mantissa
    exponent = int(exponent_text)
    sign = "+" if exponent >= 0 else ""
    return f"{mantissa}e{sign}{exponent}"


def canonical_digest(value: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def load_registry(path: str | Path) -> dict[str, Any]:
    registry_path = Path(path)
    try:
        raw = json.loads(registry_path.read_text("utf-8"))
    except Exception as exc:
        raise ValueError(f"Settings registry could not be loaded: {exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError("Settings registry must be a JSON object")
    if (
        not isinstance(raw.get("schemaVersion"), int)
        or isinstance(raw["schemaVersion"], bool)
        or raw["schemaVersion"] < 1
    ):
        raise ValueError("Settings registry schemaVersion must be a positive integer")
    if not isinstance(raw.get("registryVersion"), str) or not raw["registryVersion"].strip():
        raise ValueError("Settings registry registryVersion is required")
    if not isinstance(raw.get("definitions"), list) or not isinstance(raw.get("migrations"), list):
        raise ValueError("Settings registry definitions and migrations must be arrays")
    material = {
        "schemaVersion": raw["schemaVersion"],
        "registryVersion": raw["registryVersion"],
        "definitions": raw["definitions"],
        "migrations": raw["migrations"],
    }
    digest = canonical_digest(material)
    if raw.get("registryDigest") and raw["registryDigest"] != digest:
        raise ValueError(f"Settings registry digest mismatch: expected {raw['registryDigest']}, calculated {digest}")
    registry = copy.deepcopy(material)
    registry["registryDigest"] = digest
    _validate_registry(registry)
    return registry


def load_schema(name: str, schema_dir: str | Path | None = None) -> dict[str, Any]:
    if Path(name).name != name or not name.endswith(".schema.json"):
        raise ValueError(f"Unsafe Settings schema name: {name}")
    path = Path(schema_dir) / name if schema_dir is not None else default_schema_dir() / name
    try:
        schema = json.loads(path.read_text("utf-8"))
    except Exception as exc:
        raise ValueError(f"Settings schema could not be loaded: {exc}") from exc
    if not isinstance(schema, dict) or schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        raise ValueError(f"Settings schema is not a Draft 2020-12 object: {name}")
    if not isinstance(schema.get("$id"), str) or not schema["$id"].endswith(f"/{name}"):
        raise ValueError(f"Settings schema has an invalid canonical id: {name}")
    return schema


def resolve_settings(
    *,
    registry: dict[str, Any],
    context: dict[str, Any],
    documents: list[dict[str, Any]],
    createdAt: str,
    secretStatus: dict[str, str] | None = None,
) -> dict[str, Any]:
    _validate_runtime_context(context)
    participating = _participating_documents(documents, context)
    statuses = secretStatus or {}
    effective: list[dict[str, Any]] = []
    for definition in registry["definitions"]:
        candidates = _value_candidates(
            definition,
            participating,
            statuses,
            registry["registryVersion"],
            createdAt,
        )
        selected = candidates[0]
        effective.append(
            {
                "key": definition["key"],
                "value": copy.deepcopy(selected["value"]),
                "winningScope": selected["scope"],
                "assignmentProvenance": copy.deepcopy(selected["provenance"]),
                "validation": validate_effective_value(definition, selected["value"]),
                "applyMode": definition["applyMode"],
                "overriddenCandidates": [
                    {key: copy.deepcopy(value) for key, value in candidate.items() if key != "_assignment"}
                    for candidate in candidates[1:]
                ],
            }
        )
    source_revisions = _source_revisions(registry, participating, context)
    revision_parts = [
        str(source_revisions.get(scope, {}).get("revision", 0))
        for scope in ("user-device", "vault", "workspace-project", "session")
    ]
    context_parts = [
        context["userDeviceId"],
        context.get("vaultId", "-"),
        context.get("workspaceProjectId", "-"),
        context.get("sessionId", "-"),
    ]
    return {
        "snapshotId": ":".join(["settings", registry["registryVersion"], *context_parts, *revision_parts]),
        "registryVersion": registry["registryVersion"],
        "context": copy.deepcopy(context),
        "effective": effective,
        "sourceRevisions": source_revisions,
        "createdAt": createdAt,
    }


def explain_setting(
    *,
    registry: dict[str, Any],
    key: str,
    context: dict[str, Any],
    documents: list[dict[str, Any]],
    created_at: str,
    secret_status: dict[str, str] | None = None,
) -> dict[str, Any]:
    _validate_runtime_context(context)
    definition = _definition(registry, key)
    if definition is None:
        raise ValueError(f"Unknown setting: {key}")
    participating = _participating_documents(documents, context)
    candidates = _value_candidates(
        definition,
        participating,
        secret_status or {},
        registry["registryVersion"],
        created_at,
    )
    selected = candidates[0]
    explained: list[dict[str, Any]] = []
    selected_seen = False
    for scope in SCOPE_PRECEDENCE:
        if scope == "product":
            product = next(candidate for candidate in candidates if candidate["scope"] == "product")
            explained.append(
                {
                    "scope": scope,
                    "state": "selected" if selected["scope"] == "product" else "overridden",
                    "revision": product["revision"],
                    "value": copy.deepcopy(product["value"]),
                    "provenance": copy.deepcopy(product["provenance"]),
                }
            )
            continue
        if scope not in definition["allowedScopes"]:
            explained.append({"scope": scope, "state": "not-allowed"})
            continue
        target = _target_for_scope(scope, context)
        if not target:
            explained.append({"scope": scope, "state": "out-of-context"})
            continue
        candidate = next((item for item in candidates if item["scope"] == scope), None)
        document = participating.get(scope)
        if candidate is None:
            explained.append({"scope": scope, "state": "unset", "revision": document["revision"] if document else 0})
            continue
        state = "overridden" if selected_seen else "selected"
        selected_seen = True
        explained.append(
            {
                "scope": scope,
                "state": state,
                "revision": candidate["revision"],
                "value": copy.deepcopy(candidate["value"]),
                "provenance": copy.deepcopy(candidate["provenance"]),
            }
        )
    return {
        "key": key,
        "winningScope": selected["scope"],
        "value": copy.deepcopy(selected["value"]),
        "candidates": explained,
        "validation": validate_effective_value(definition, selected["value"]),
    }


def validate_documents(
    registry: dict[str, Any],
    documents: list[dict[str, Any]],
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    definitions = {definition["key"]: definition for definition in registry["definitions"]}
    identities: set[str] = set()
    for document in documents:
        if not isinstance(document, dict):
            issues.append(_issue("invalid-settings-document", "Settings document must be a JSON object."))
            continue
        scope = document.get("scope")
        target_id = document.get("targetId")
        identity = f"{scope}:{target_id}"
        if identity in identities:
            issues.append(
                _issue(
                    "duplicate-scope-document",
                    f"Duplicate settings document for {identity}.",
                    scope=scope,
                    targetId=target_id,
                )
            )
            continue
        identities.add(identity)
        issues.extend(_validate_document_shape(document))
        if context and scope in MUTABLE_SCOPES and not _scope_matches_context(scope, target_id, context):
            issues.append(
                _issue(
                    "scope-out-of-context",
                    f"{identity} is outside the supplied runtime context and will not participate in resolution.",
                    severity="warning",
                    scope=scope,
                    targetId=target_id,
                )
            )
        seen: set[str] = set()
        assignments = document.get("assignments", [])
        if not isinstance(assignments, list):
            continue
        for assignment in assignments:
            key = assignment.get("key") if isinstance(assignment, dict) else None
            if not isinstance(key, str):
                issues.append(
                    _issue("invalid-assignment", "Setting assignment key is required.", scope=scope, targetId=target_id)
                )
                continue
            if key in seen:
                issues.append(
                    _issue(
                        "duplicate-assignment",
                        f"Duplicate assignment for {key}.",
                        key=key,
                        scope=scope,
                        targetId=target_id,
                    )
                )
                continue
            seen.add(key)
            definition = definitions.get(key)
            if definition is None:
                issues.append(
                    _issue(
                        "unknown-setting",
                        f"Unknown setting {key} is preserved but ignored.",
                        severity="warning",
                        key=key,
                        scope=scope,
                        targetId=target_id,
                        remediation="Remove the orphaned assignment or install a registry version that defines it.",
                    )
                )
                continue
            issues.extend(_validate_assignment(definition, scope, target_id, assignment))
    return {"valid": not any(item["severity"] == "error" for item in issues), "issues": issues}


def validate_effective_value(definition: dict[str, Any], value: Any) -> dict[str, Any]:
    if definition["valueType"] == "secret-reference":
        secret_ref = value.get("secretRef") if isinstance(value, dict) else None
        issues = (
            []
            if _is_secret_reference(secret_ref)
            else [
                _issue(
                    "invalid-secret-reference",
                    f"{definition['key']} has no valid Secret Reference.",
                    key=definition["key"],
                )
            ]
        )
    else:
        issues = _validate_value(definition, value, key=definition["key"])
    return {"valid": not issues, "issues": issues}


class SettingsLockTimeoutError(RuntimeError):
    code = "settings-lock-timeout"

    def __init__(self, lock_path: Path, timeout_ms: int):
        super().__init__(f"Timed out after {timeout_ms}ms waiting for settings lock {lock_path}")
        self.lock_path = lock_path


class SettingsPersistenceError(RuntimeError):
    code = "settings-persistence-error"

    def __init__(self, message: str, diagnostics: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.diagnostics = diagnostics or []


class FileSettingsStore:
    def __init__(
        self,
        scope: str,
        target_id: str,
        path: str | Path,
        registry: dict[str, Any],
        *,
        clock: Callable[[], str] | None = None,
        lock_timeout_ms: int = 2_000,
        lock_retry_ms: int = 20,
        stale_lock_ms: int = 60_000,
    ):
        if scope not in ("user-device", "vault", "workspace-project"):
            raise ValueError(f"FileSettingsStore does not support scope {scope}")
        if scope == "workspace-project":
            _project_slug(target_id)
        self.scope = scope
        self.target_id = target_id
        self.path = Path(path)
        self.registry = registry
        self.clock = clock or _utc_now
        self.lock_timeout_ms = lock_timeout_ms
        self.lock_retry_ms = lock_retry_ms
        self.stale_lock_ms = stale_lock_ms

    def read(self) -> dict[str, Any]:
        active = self._read_path(self.path)
        if active["status"] == "valid":
            return {
                "document": copy.deepcopy(active["document"]),
                "recoveredFromBackup": False,
                "diagnostics": active["diagnostics"],
            }
        backup = self._read_path(Path(f"{self.path}.bak"))
        if backup["status"] == "valid":
            diagnostics = [
                *active["diagnostics"],
                _issue(
                    "active-document-recovered",
                    f"Recovered {self.scope}:{self.target_id} from its previous-revision backup.",
                    severity="warning",
                    scope=self.scope,
                    targetId=self.target_id,
                    remediation="Commit a valid mutation to replace the corrupt active document.",
                ),
            ]
            return {
                "document": copy.deepcopy(backup["document"]),
                "recoveredFromBackup": True,
                "diagnostics": diagnostics,
            }
        if active["status"] == "missing" and backup["status"] == "missing":
            return {"document": self._empty_document(), "recoveredFromBackup": False, "diagnostics": []}
        raise SettingsPersistenceError(
            f"Neither active nor backup settings document is usable for {self.scope}:{self.target_id}.",
            [*active["diagnostics"], *backup["diagnostics"]],
        )

    def migration_state(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"scope": self.scope, "targetId": self.target_id, "schemaVersion": SCHEMA_VERSION}
        try:
            document = json.loads(self.path.read_text("utf-8"))
        except Exception as exc:
            raise SettingsPersistenceError(
                f"Settings document could not be parsed for migration: {exc}"
            ) from exc
        if not isinstance(document, dict):
            raise SettingsPersistenceError("Settings document must be a JSON object to plan migrations.")
        if document.get("scope") != self.scope or document.get("targetId") != self.target_id:
            raise SettingsPersistenceError("Settings document scope identity does not match its store.")
        schema_version = document.get("schemaVersion")
        if not isinstance(schema_version, int) or isinstance(schema_version, bool) or schema_version < 0:
            raise SettingsPersistenceError("Settings document schemaVersion must be a non-negative integer.")
        return {"scope": self.scope, "targetId": self.target_id, "schemaVersion": schema_version}

    def set(
        self,
        key: str,
        value: Any,
        *,
        expected_revision: int,
        updated_by: str,
        source: str = "settings.assignment.set",
        reason: str | None = None,
        expires_at: str | None = None,
    ) -> dict[str, Any]:
        return self._with_lock(
            lambda: self._mutate(
                "set",
                key,
                value,
                expected_revision=expected_revision,
                updated_by=updated_by,
                source=source,
                reason=reason,
                expires_at=expires_at,
            )
        )

    def unset(
        self,
        key: str,
        *,
        expected_revision: int,
        updated_by: str,
        source: str = "settings.assignment.unset",
        reason: str | None = None,
    ) -> dict[str, Any]:
        return self._with_lock(
            lambda: self._mutate(
                "unset",
                key,
                None,
                expected_revision=expected_revision,
                updated_by=updated_by,
                source=source,
                reason=reason,
                expires_at=None,
            )
        )

    def _mutate(
        self,
        kind: str,
        key: str,
        value: Any,
        *,
        expected_revision: int,
        updated_by: str,
        source: str,
        reason: str | None,
        expires_at: str | None,
    ) -> dict[str, Any]:
        current = self.read()["document"]
        if current["revision"] != expected_revision:
            return {
                "status": "conflict",
                "document": copy.deepcopy(current),
                "conflict": {
                    "scope": self.scope,
                    "targetId": self.target_id,
                    "expectedRevision": expected_revision,
                    "actualRevision": current["revision"],
                    "changedKeys": self._changed_keys_since(current, expected_revision),
                },
            }
        plan = _plan_mutation(
            registry=self.registry,
            current=current,
            scope=self.scope,
            target_id=self.target_id,
            kind=kind,
            key=key,
            value=value,
            updated_by=updated_by,
            source=source,
            reason=reason,
            expires_at=expires_at,
            clock=self.clock,
        )
        if plan["status"] != "planned":
            return plan
        proposed = plan["proposed"]
        backup_path = Path(f"{self.path}.bak")
        if current["revision"] > 0 or self.path.exists():
            _atomic_write(backup_path, canonical_json(current) + "\n")
        previous = {"revision": current["revision"], "digest": canonical_digest(current)}
        if current["revision"] > 0 or backup_path.exists():
            previous["backupPath"] = backup_path.name
        proposed["previousRevision"] = previous
        _atomic_write(self.path, canonical_json(proposed) + "\n")
        return {
            "status": "committed",
            "document": copy.deepcopy(proposed),
            "event": plan["event"],
        }

    def _changed_keys_since(self, current: dict[str, Any], expected_revision: int) -> list[str]:
        previous = current.get("previousRevision")
        if isinstance(previous, dict) and previous.get("revision") == expected_revision:
            backup = self._read_path(Path(f"{self.path}.bak"))
            if backup["status"] == "valid" and backup["document"]["revision"] == expected_revision:
                return _changed_assignment_keys(backup["document"], current)
        return sorted(item["key"] for item in current["assignments"])

    def _read_path(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {"status": "missing", "diagnostics": []}
        try:
            document = json.loads(path.read_text("utf-8"))
        except Exception:
            return {
                "status": "invalid",
                "diagnostics": [
                    _issue(
                        "settings-json-invalid",
                        "Settings document is not valid JSON.",
                        scope=self.scope,
                        targetId=self.target_id,
                    )
                ],
            }
        if not isinstance(document, dict):
            return {
                "status": "invalid",
                "diagnostics": [
                    _issue(
                        "settings-document-invalid",
                        "Settings document must be a JSON object.",
                        scope=self.scope,
                        targetId=self.target_id,
                    )
                ],
            }
        if document.get("scope") != self.scope or document.get("targetId") != self.target_id:
            return {
                "status": "invalid",
                "diagnostics": [
                    _issue(
                        "settings-identity-mismatch",
                        "Settings document scope identity does not match its store.",
                        scope=self.scope,
                        targetId=self.target_id,
                    )
                ],
            }
        validation = validate_documents(self.registry, [document])
        if not validation["valid"]:
            return {"status": "invalid", "diagnostics": validation["issues"]}
        return {"status": "valid", "document": document, "diagnostics": validation["issues"]}

    def _empty_document(self) -> dict[str, Any]:
        return {
            "schemaVersion": SCHEMA_VERSION,
            "scope": self.scope,
            "targetId": self.target_id,
            "revision": 0,
            "assignments": [],
            "updatedAt": "1970-01-01T00:00:00.000Z",
            "updatedBy": "settings-platform",
        }

    def _with_lock(self, callback: Callable[[], dict[str, Any]]) -> dict[str, Any]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_path = Path(f"{self.path}.lock")
        deadline = time.monotonic() + self.lock_timeout_ms / 1000
        while True:
            try:
                fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                try:
                    os.write(fd, json.dumps({"pid": os.getpid(), "acquiredAt": self.clock()}).encode("utf-8"))
                    os.fsync(fd)
                finally:
                    os.close(fd)
                break
            except FileExistsError:
                try:
                    age_ms = (time.time() - lock_path.stat().st_mtime) * 1000
                    if age_ms > self.stale_lock_ms:
                        lock_path.unlink(missing_ok=True)
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() >= deadline:
                    raise SettingsLockTimeoutError(lock_path, self.lock_timeout_ms)
                time.sleep(min(self.lock_retry_ms / 1000, max(0.001, deadline - time.monotonic())))
        try:
            return callback()
        finally:
            lock_path.unlink(missing_ok=True)


class MemorySettingsStore:
    def __init__(
        self,
        target_id: str,
        registry: dict[str, Any],
        *,
        assignments: list[dict[str, Any]] | None = None,
        clock: Callable[[], str] | None = None,
    ):
        self.scope = "session"
        self.target_id = target_id
        self.registry = registry
        self.clock = clock or _utc_now
        self.document = {
            "schemaVersion": SCHEMA_VERSION,
            "scope": "session",
            "targetId": target_id,
            "revision": 0,
            "assignments": sorted(copy.deepcopy(assignments or []), key=lambda item: item["key"]),
            "updatedAt": self.clock() if assignments else "1970-01-01T00:00:00.000Z",
            "updatedBy": "settings-bootstrap" if assignments else "settings-platform",
        }
        self.previous_document: dict[str, Any] | None = None

    def read(self) -> dict[str, Any]:
        return {"document": copy.deepcopy(self.document), "recoveredFromBackup": False, "diagnostics": []}

    def migration_state(self) -> dict[str, Any]:
        return {"scope": "session", "targetId": self.target_id, "schemaVersion": self.document["schemaVersion"]}

    def set(self, key: str, value: Any, *, expected_revision: int, updated_by: str, **kwargs: Any) -> dict[str, Any]:
        return self._mutate("set", key, value, expected_revision, updated_by, kwargs)

    def unset(self, key: str, *, expected_revision: int, updated_by: str, **kwargs: Any) -> dict[str, Any]:
        return self._mutate("unset", key, None, expected_revision, updated_by, kwargs)

    def _mutate(
        self,
        kind: str,
        key: str,
        value: Any,
        expected_revision: int,
        updated_by: str,
        options: dict[str, Any],
    ) -> dict[str, Any]:
        current = copy.deepcopy(self.document)
        if current["revision"] != expected_revision:
            return {
                "status": "conflict",
                "document": current,
                "conflict": {
                    "scope": "session",
                    "targetId": self.target_id,
                    "expectedRevision": expected_revision,
                    "actualRevision": current["revision"],
                    "changedKeys": (
                        _changed_assignment_keys(self.previous_document, current)
                        if self.previous_document and self.previous_document["revision"] == expected_revision
                        else sorted(item["key"] for item in current["assignments"])
                    ),
                },
            }
        plan = _plan_mutation(
            registry=self.registry,
            current=current,
            scope="session",
            target_id=self.target_id,
            kind=kind,
            key=key,
            value=value,
            updated_by=updated_by,
            source=options.get("source", "settings.assignment.set"),
            reason=options.get("reason"),
            expires_at=options.get("expires_at"),
            clock=self.clock,
        )
        if plan["status"] != "planned":
            return plan
        proposed = plan["proposed"]
        proposed["previousRevision"] = {"revision": current["revision"], "digest": canonical_digest(current)}
        self.previous_document = current
        self.document = proposed
        return {
            "status": "committed",
            "document": copy.deepcopy(proposed),
            "event": plan["event"],
        }


class SettingsService:
    def __init__(
        self,
        *,
        registry: dict[str, Any],
        vault_path: str | Path,
        user_device_id: str | None = None,
        user_device_path: str | Path | None = None,
        vault_id: str | None = None,
        workspace_project_id: str | None = None,
        session_id: str | None = None,
        python_path: str | None = None,
        compiler_path: str | None = None,
        environment: dict[str, str] | None = None,
        clock: Callable[[], str] | None = None,
    ):
        self.registry = registry
        self.vault_path = Path(vault_path).resolve()
        self.user_device_path = Path(user_device_path) if user_device_path else default_user_device_path(environment)
        self.environment = environment if environment is not None else dict(os.environ)
        self.clock = clock or _utc_now
        resolved_vault_id = vault_id or _safe_identity(self.vault_path.name or "default-vault")
        resolved_session_id = session_id or f"process-{os.getpid()}"
        if workspace_project_id is not None:
            _project_slug(workspace_project_id)
        self.default_context = {
            "userDeviceId": user_device_id or default_user_device_id(self.environment),
            "vaultId": resolved_vault_id,
            **({"workspaceProjectId": workspace_project_id} if workspace_project_id else {}),
            "sessionId": resolved_session_id,
        }
        bootstrap_values = (
            ("runtime.python.path", python_path),
            ("runtime.kb_meta.path", compiler_path),
            ("vault.path", self.vault_path.as_posix()),
            ("vault.id", resolved_vault_id),
        )
        assignments = [
            {
                "key": key,
                "value": value,
                "provenance": {"actor": "settings-bootstrap", "source": "runtime-adapter"},
            }
            for key, value in bootstrap_values
            if value
        ]
        self.stores: dict[str, Any] = {
            self._store_key("session", resolved_session_id): MemorySettingsStore(
                resolved_session_id,
                registry,
                assignments=assignments,
                clock=self.clock,
            )
        }

    def snapshot_resolve(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        runtime = copy.deepcopy(context or self.default_context)
        documents, diagnostics = self._read_documents(runtime)
        snapshot = resolve_settings(
            registry=self.registry,
            context=runtime,
            documents=documents,
            secretStatus=self._secret_statuses(documents),
            createdAt=self.clock(),
        )
        validation = self._validate_resolved(documents, runtime, snapshot)
        return {"snapshot": snapshot, "validation": validation, "recoveryDiagnostics": diagnostics}

    def snapshot_explain(self, key: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        runtime = copy.deepcopy(context or self.default_context)
        documents, _ = self._read_documents(runtime)
        return explain_setting(
            registry=self.registry,
            key=key,
            context=runtime,
            documents=documents,
            created_at=self.clock(),
            secret_status=self._secret_statuses(documents),
        )

    def host_capability_invocation_profile(
        self,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return the redacted Settings-owned profile for governed host calls.

        The profile includes only public/local configuration, Secret Reference
        metadata, and presence state. The referenced secret value is deliberately
        excluded and may only be resolved at the last mile with
        ``resolve_secret_reference``.
        """
        resolved = self.snapshot_resolve(context)
        snapshot = resolved["snapshot"]
        effective = {item["key"]: item for item in snapshot["effective"]}
        selected = {key: effective[key] for key in HOST_CAPABILITY_SETTING_KEYS}
        values = {key: item["value"] for key, item in selected.items()}
        secret_value = values["providers.host_capability.secret_ref"]
        secret_ref = (
            copy.deepcopy(secret_value.get("secretRef"))
            if isinstance(secret_value, dict)
            else None
        )
        secret_status = (
            secret_value.get("status")
            if isinstance(secret_value, dict)
            else "missing"
        )
        winning_scopes = {
            key: item["winningScope"]
            for key, item in selected.items()
        }
        connector_id = normalize_host_capability_connector_id(
            values["providers.host_capability.provider"]
        )
        transport = values["providers.host_capability.transport"]
        secret_required = (
            transport not in ("stdio", "local-model")
        )
        return {
            "configured": any(scope != "product" for scope in winning_scopes.values()),
            "enabled": values["providers.host_capability.enabled"] is True,
            "provider": values["providers.host_capability.provider"],
            "connectorId": connector_id or "",
            "transport": transport,
            "endpoint": values["providers.host_capability.endpoint"],
            "timeoutMs": values["providers.host_capability.timeout_ms"],
            "secretReference": secret_ref,
            "secretStatus": secret_status,
            "secretRequired": secret_required,
            "valid": all(item["validation"]["valid"] for item in selected.values()),
            "winningScopes": winning_scopes,
            "snapshotId": snapshot["snapshotId"],
        }

    def project_tracker_invocation_profile(
        self,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return the redacted Settings profile for Project External Projections.

        Tracker credentials are represented only by Secret Reference metadata.
        Explicit configuration must supply its endpoint and credential reference;
        product defaults keep an entirely unconfigured profile readable but cannot
        silently become an enabled tracker connection.
        """
        resolved = self.snapshot_resolve(context)
        snapshot = resolved["snapshot"]
        effective = {item["key"]: item for item in snapshot["effective"]}
        selected = {key: effective[key] for key in PROJECT_TRACKER_SETTING_KEYS}
        values = {key: item["value"] for key, item in selected.items()}
        prefix = "providers.project_tracker."
        secret_value = values[f"{prefix}secret_ref"]
        secret_ref = (
            copy.deepcopy(secret_value.get("secretRef"))
            if isinstance(secret_value, dict)
            else None
        )
        secret_status = (
            secret_value.get("status")
            if isinstance(secret_value, dict)
            else "missing"
        )
        winning_scopes = {
            key: item["winningScope"]
            for key, item in selected.items()
        }
        configured = any(
            scope != "product" for scope in winning_scopes.values())
        enabled = values[f"{prefix}enabled"] is True
        explicit_connection = (
            winning_scopes[f"{prefix}endpoint"] != "product"
            and winning_scopes[f"{prefix}secret_ref"] != "product"
        )
        return {
            "configured": configured,
            "enabled": enabled,
            "provider": values[f"{prefix}provider"],
            "transport": values[f"{prefix}transport"],
            "endpoint": values[f"{prefix}endpoint"],
            "timeoutMs": values[f"{prefix}timeout_ms"],
            "secretReference": secret_ref,
            "secretStatus": secret_status,
            "valid": (
                all(item["validation"]["valid"] for item in selected.values())
                and (not configured or not enabled or explicit_connection)
            ),
            "winningScopes": winning_scopes,
            "snapshotId": snapshot["snapshotId"],
        }

    def resolve_secret_reference(self, reference: Any) -> str | None:
        """Resolve one Secret Reference in process without exposing it in a snapshot."""
        if not _is_secret_reference(reference):
            return None
        if reference["provider"] != "environment":
            return None
        return _environment_secret(self.environment, reference["locator"])

    def assignment_set(
        self,
        *,
        scope: str,
        key: str,
        value: Any,
        expected_revision: int,
        updated_by: str,
        target_id: str | None = None,
        reason: str | None = None,
        expires_at: str | None = None,
    ) -> dict[str, Any]:
        resolved_target = target_id or _target_for_scope(scope, self.default_context)
        if scope not in MUTABLE_SCOPES or not resolved_target:
            raise ValueError(f"{scope} scope requires a targetId")
        return self._store(scope, resolved_target).set(
            key,
            value,
            expected_revision=expected_revision,
            updated_by=updated_by,
            source="settings.assignment.set",
            reason=reason,
            expires_at=expires_at,
        )

    def assignment_unset(
        self,
        *,
        scope: str,
        key: str,
        expected_revision: int,
        updated_by: str,
        target_id: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        resolved_target = target_id or _target_for_scope(scope, self.default_context)
        if scope not in MUTABLE_SCOPES or not resolved_target:
            raise ValueError(f"{scope} scope requires a targetId")
        return self._store(scope, resolved_target).unset(
            key,
            expected_revision=expected_revision,
            updated_by=updated_by,
            source="settings.assignment.unset",
            reason=reason,
        )

    def validate(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        return self.snapshot_resolve(context)["validation"]

    def migrations_plan(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        runtime = context or self.default_context
        entries = (
            ("user-device", runtime.get("userDeviceId")),
            ("vault", runtime.get("vaultId")),
            ("workspace-project", runtime.get("workspaceProjectId")),
            ("session", runtime.get("sessionId")),
        )
        states = [self._store(scope, target_id).migration_state() for scope, target_id in entries if target_id]
        scopes = []
        for state in states:
            migrations = sorted(
                [
                    migration
                    for migration in self.registry["migrations"]
                    if migration["fromSchemaVersion"] >= state["schemaVersion"]
                    and migration["toSchemaVersion"] <= self.registry["schemaVersion"]
                ],
                key=lambda item: item["fromSchemaVersion"],
            )
            scopes.append(
                {
                    "scope": state["scope"],
                    "targetId": state["targetId"],
                    "currentSchemaVersion": state["schemaVersion"],
                    "targetSchemaVersion": self.registry["schemaVersion"],
                    "migrations": migrations,
                    "requiresMigration": state["schemaVersion"] != self.registry["schemaVersion"],
                }
            )
        return {
            "registryVersion": self.registry["registryVersion"],
            "writeRequired": any(item["requiresMigration"] for item in scopes),
            "scopes": scopes,
        }

    def doctor(self, context: dict[str, Any] | None = None) -> dict[str, Any]:
        checked_at = self.clock()
        try:
            resolved = self.snapshot_resolve(context)
        except Exception as exc:
            return {
                "validation": {
                    "valid": False,
                    "issues": [
                        _issue(
                            "settings-unavailable",
                            f"Settings could not be resolved: {exc}",
                            remediation="Repair the active settings document or restore its backup.",
                        )
                    ],
                },
                "capabilities": [],
                "checkedAt": checked_at,
            }
        snapshot = resolved["snapshot"]
        values = {item["key"]: item["value"] for item in snapshot["effective"]}
        python_value = values.get("runtime.python.path")
        python_available = isinstance(python_value, str) and _probe_python(python_value)
        vault_value = values.get("vault.path")
        vault_available = isinstance(vault_value, str) and Path(vault_value).exists()
        query_enabled = values.get("query.semantic.enabled") is True
        diagnostics_enabled = values.get("diagnostics.obc.semantic.enabled") is True
        web_enabled = values.get("providers.web_search.enabled") is True
        secret_value = values.get("providers.web_search.secret_ref")
        secret_status = secret_value.get("status") if isinstance(secret_value, dict) else None
        web_state = (
            "disabled"
            if not web_enabled
            else "available"
            if secret_status == "present"
            else "degraded"
            if secret_status == "unreachable"
            else "unavailable"
        )
        diagnostics_available = query_enabled and python_available
        capabilities = [
            _health(
                "runtime.python",
                "available" if python_available else "unavailable",
                "Python runtime responded to a version probe."
                if python_available
                else "Python runtime could not be executed.",
                checked_at,
                snapshot["snapshotId"],
                "pass" if python_available else "fail",
                []
                if python_available
                else [
                    {
                        "code": "configure-python",
                        "summary": "Set runtime.python.path to an executable Python runtime.",
                        "operation": "settings.assignment.set",
                    }
                ],
            ),
            _health(
                "vault.filesystem",
                "available" if vault_available else "unavailable",
                "Configured vault path is accessible."
                if vault_available
                else "Configured vault path is unavailable on this device.",
                checked_at,
                snapshot["snapshotId"],
                "pass" if vault_available else "fail",
                []
                if vault_available
                else [
                    {
                        "code": "configure-vault-path",
                        "summary": "Set vault.path at user-device or session scope.",
                        "operation": "settings.assignment.set",
                    }
                ],
            ),
            _health(
                "query.semantic",
                ("available" if python_available else "degraded") if query_enabled else "disabled",
                "Semantic query is enabled." if query_enabled else "Semantic query is intentionally disabled.",
                checked_at,
                snapshot["snapshotId"],
                "pass" if not query_enabled or python_available else "warn",
                (
                    [
                        {
                            "code": "repair-python",
                            "summary": "Repair runtime.python.path.",
                            "operation": "settings.assignment.set",
                        }
                    ]
                    if query_enabled and not python_available
                    else []
                ),
            ),
            _health(
                "diagnostics.obc.semantic",
                ("available" if diagnostics_available else "degraded") if diagnostics_enabled else "disabled",
                "Semantic link suggestions are enabled."
                if diagnostics_available
                else (
                    "Semantic query is enabled but its Python runtime is unavailable; "
                    "deterministic diagnostics remain available."
                    if diagnostics_enabled and query_enabled
                    else "Deterministic diagnostics remain available without semantic query."
                    if diagnostics_enabled
                    else (
                        "Semantic link suggestions are intentionally disabled; "
                        "deterministic diagnostics remain available."
                    )
                ),
                checked_at,
                snapshot["snapshotId"],
                "warn" if diagnostics_enabled and not diagnostics_available else "pass",
                (
                    [
                        {
                            "code": "enable-semantic-query",
                            "summary": "Enable query.semantic.enabled or disable semantic diagnostics.",
                            "operation": "settings.assignment.set",
                        }
                    ]
                    if diagnostics_enabled and not query_enabled
                    else [
                        {
                            "code": "repair-python",
                            "summary": "Repair runtime.python.path.",
                            "operation": "settings.assignment.set",
                        }
                    ]
                    if diagnostics_enabled and not python_available
                    else []
                ),
            ),
            _health(
                "providers.web-search",
                web_state,
                "Web search is intentionally disabled."
                if not web_enabled
                else "Web search credential reference is present."
                if secret_status == "present"
                else "Web search credential reference is not resolvable.",
                checked_at,
                snapshot["snapshotId"],
                "pass" if web_state in ("available", "disabled") else "warn" if web_state == "degraded" else "fail",
                (
                    [
                        {
                            "code": "configure-web-secret",
                            "summary": "Configure the referenced secret without storing its value in Settings.",
                            "operation": "settings.assignment.set",
                        }
                    ]
                    if web_state in ("degraded", "unavailable")
                    else []
                ),
            ),
        ]
        return {
            "snapshotId": snapshot["snapshotId"],
            "validation": resolved["validation"],
            "capabilities": capabilities,
            "checkedAt": checked_at,
        }

    def _read_documents(self, context: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        entries = (
            ("user-device", context.get("userDeviceId")),
            ("vault", context.get("vaultId")),
            ("workspace-project", context.get("workspaceProjectId")),
            ("session", context.get("sessionId")),
        )
        reads = [self._store(scope, target_id).read() for scope, target_id in entries if target_id]
        return [item["document"] for item in reads], [
            diagnostic for item in reads for diagnostic in item["diagnostics"]
        ]

    def _store(self, scope: str, target_id: str) -> Any:
        key = self._store_key(scope, target_id)
        if key in self.stores:
            return self.stores[key]
        if scope == "session":
            store = MemorySettingsStore(target_id, self.registry, clock=self.clock)
        else:
            store = FileSettingsStore(
                scope,
                target_id,
                settings_document_path(scope, self.vault_path, self.user_device_path, target_id),
                self.registry,
                clock=self.clock,
            )
        self.stores[key] = store
        return store

    @staticmethod
    def _store_key(scope: str, target_id: str) -> str:
        return f"{scope}:{target_id}"

    def _secret_statuses(self, documents: list[dict[str, Any]]) -> dict[str, str]:
        refs = [
            definition["defaultSecretRef"]
            for definition in self.registry["definitions"]
            if definition.get("defaultSecretRef")
        ]
        refs.extend(
            assignment["secretRef"]
            for document in documents
            for assignment in document["assignments"]
            if assignment.get("secretRef")
        )
        statuses: dict[str, str] = {}
        for ref in refs:
            key = f"{ref['provider']}:{ref['locator']}"
            statuses[key] = (
                "present"
                if ref["provider"] == "environment"
                and _environment_secret(self.environment, ref["locator"])
                else "missing"
                if ref["provider"] == "environment"
                else "unreachable"
            )
        return statuses

    def _validate_resolved(
        self,
        documents: list[dict[str, Any]],
        context: dict[str, Any],
        snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        base = validate_documents(self.registry, documents, context)
        issues = [*base["issues"]]
        for effective in snapshot["effective"]:
            issues.extend(effective["validation"]["issues"])
        values = {item["key"]: item["value"] for item in snapshot["effective"]}
        if values.get("diagnostics.obc.semantic.enabled") is True and values.get("query.semantic.enabled") is not True:
            issues.append(
                _issue(
                    "semantic-diagnostics-degraded",
                    "Semantic link suggestions are enabled while semantic query is disabled; "
                    "deterministic diagnostics remain available.",
                    severity="warning",
                    key="diagnostics.obc.semantic.enabled",
                )
            )
        secret = values.get("providers.web_search.secret_ref")
        if values.get("providers.web_search.enabled") is True and (
            not isinstance(secret, dict) or secret.get("status") != "present"
        ):
            issues.append(
                _issue(
                    "web-search-secret-missing",
                    "Web search is enabled but its Secret Reference is not present.",
                    severity="warning",
                    key="providers.web_search.secret_ref",
                )
            )
        return {"valid": not any(item["severity"] == "error" for item in issues), "issues": issues}


def settings_document_path(scope: str, vault_path: Path, user_device_path: Path, target_id: str) -> Path:
    if scope == "user-device":
        return user_device_path
    if scope == "vault":
        return vault_path / "_llmwiki" / "settings" / "vault.json"
    if scope == "workspace-project":
        slug = _project_slug(target_id)
        return vault_path / "_llmwiki" / "settings" / "projects" / f"{slug}.json"
    raise ValueError(f"Session scope is in memory, not a file: {target_id}")


def default_user_device_path(environment: dict[str, str] | None = None) -> Path:
    env = environment if environment is not None else os.environ
    if env.get("LLMWIKI_SETTINGS_USER_PATH"):
        return Path(env["LLMWIKI_SETTINGS_USER_PATH"])
    if os.name == "nt":
        base = Path(env.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:
        base = Path(env.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / "llm-wiki" / "settings" / "user-device.json"


def default_registry_path() -> Path:
    return Path(__file__).resolve().parents[1] / "packages" / "settings-platform" / "registry" / "v1.json"


def default_schema_dir() -> Path:
    return Path(__file__).resolve().parents[1] / "packages" / "settings-platform" / "schemas"


def _validate_registry(registry: dict[str, Any]) -> None:
    seen: set[str] = set()
    for definition in registry["definitions"]:
        if not isinstance(definition, dict):
            raise ValueError("Setting definition must be a JSON object")
        key = definition.get("key")
        if not isinstance(key, str) or not re.match(r"^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$", key):
            raise ValueError(f"Setting key must be namespaced: {key}")
        if key in seen:
            raise ValueError(f"Duplicate setting definition: {key}")
        seen.add(key)
        metadata = (
            definition.get("owner"),
            definition.get("category"),
            definition.get("name"),
            definition.get("description"),
        )
        if not all(isinstance(value, str) and value.strip() for value in metadata):
            raise ValueError(f"Setting definition metadata is incomplete: {key}")
        value_type = definition.get("valueType")
        if value_type not in {
            "boolean",
            "integer",
            "number",
            "string",
            "enum",
            "path",
            "duration",
            "list",
            "object",
            "secret-reference",
        }:
            raise ValueError(f"Setting definition has an invalid valueType: {key}")
        allowed_scopes = definition.get("allowedScopes")
        if (
            not isinstance(allowed_scopes, list)
            or not allowed_scopes
            or len(set(allowed_scopes)) != len(allowed_scopes)
            or any(scope not in MUTABLE_SCOPES for scope in allowed_scopes)
        ):
            raise ValueError(f"Setting definition has invalid allowed scopes: {key}")
        if definition.get("sensitivity") not in {"public", "local", "secret-reference"}:
            raise ValueError(f"Setting definition has invalid sensitivity: {key}")
        if definition.get("applyMode") not in {"hot", "next-operation", "restart-required"}:
            raise ValueError(f"Setting definition has invalid apply mode: {key}")
        if definition.get("visibility") not in {"normal", "advanced", "internal"}:
            raise ValueError(f"Setting definition has invalid visibility: {key}")
        _validate_registry_validator(definition)
        requires = definition.get("requires")
        if (
            not isinstance(requires, list)
            or any(not isinstance(item, str) for item in requires)
            or len(set(requires)) != len(requires)
        ):
            raise ValueError(f"Setting definition requirements are invalid: {key}")
        if value_type == "secret-reference":
            if not _is_secret_reference(definition.get("defaultSecretRef")) or "defaultValue" in definition:
                raise ValueError(f"Secret setting must define defaultSecretRef only: {key}")
            if definition.get("sensitivity") != "secret-reference":
                raise ValueError(f"Secret setting must use secret-reference sensitivity: {key}")
        else:
            if "defaultSecretRef" in definition:
                raise ValueError(f"Non-secret setting cannot define defaultSecretRef: {key}")
            if "defaultValue" not in definition or not _registry_default_matches_type(
                value_type, definition["defaultValue"]
            ):
                raise ValueError(f"Setting default does not match {value_type}: {key}")
    for migration in registry["migrations"]:
        if not isinstance(migration, dict):
            raise ValueError("Settings migration must be a JSON object")
        if (
            not isinstance(migration.get("id"), str)
            or not migration["id"].strip()
            or not isinstance(migration.get("description"), str)
            or not migration["description"].strip()
            or not isinstance(migration.get("fromSchemaVersion"), int)
            or isinstance(migration["fromSchemaVersion"], bool)
            or migration["fromSchemaVersion"] < 0
            or not isinstance(migration.get("toSchemaVersion"), int)
            or isinstance(migration["toSchemaVersion"], bool)
            or migration["toSchemaVersion"] < 1
        ):
            raise ValueError(f"Settings migration is invalid: {migration.get('id', 'unknown')}")


def _validate_registry_validator(definition: dict[str, Any]) -> None:
    validator = definition.get("validator")
    key = definition["key"]
    if not isinstance(validator, dict) or not isinstance(validator.get("id"), str) or not validator["id"].strip():
        raise ValueError(f"Setting definition validator is incomplete: {key}")
    if "required" in validator and not isinstance(validator["required"], bool):
        raise ValueError(f"Setting validator required flag is invalid: {key}")
    if "enum" in validator and (
        not isinstance(validator["enum"], list)
        or any(not isinstance(item, str) for item in validator["enum"])
        or len(set(validator["enum"])) != len(validator["enum"])
    ):
        raise ValueError(f"Setting validator enum is invalid: {key}")
    for field in ("min", "max"):
        if field in validator and (
            not isinstance(validator[field], (int, float))
            or isinstance(validator[field], bool)
            or not math.isfinite(validator[field])
        ):
            raise ValueError(f"Setting validator numeric bound is invalid: {key}")
    for field in ("minLength", "maxLength"):
        if field in validator and (
            not isinstance(validator[field], int) or isinstance(validator[field], bool) or validator[field] < 0
        ):
            raise ValueError(f"Setting validator length bound is invalid: {key}")
    if "pattern" in validator:
        if not isinstance(validator["pattern"], str):
            raise ValueError(f"Setting validator pattern is invalid: {key}")
        try:
            re.compile(validator["pattern"])
        except re.error as exc:
            raise ValueError(f"Setting validator pattern is invalid: {key}") from exc


def _registry_default_matches_type(value_type: str, value: Any) -> bool:
    return (
        (value_type == "boolean" and isinstance(value, bool))
        or (value_type == "integer" and isinstance(value, int) and not isinstance(value, bool))
        or (
            value_type == "number"
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
        )
        or (value_type in ("string", "enum", "path", "duration") and isinstance(value, str))
        or (value_type == "list" and isinstance(value, list))
        or (value_type == "object" and isinstance(value, dict))
    )


def _participating_documents(documents: list[dict[str, Any]], context: dict[str, Any]) -> dict[str, dict[str, Any]]:
    participating: dict[str, dict[str, Any]] = {}
    for document in documents:
        scope = document["scope"]
        if not _scope_matches_context(scope, document["targetId"], context):
            continue
        if scope in participating:
            raise ValueError(f"Duplicate settings document for {scope}")
        participating[scope] = document
    return participating


def _source_revisions(
    registry: dict[str, Any],
    documents: dict[str, dict[str, Any]],
    context: dict[str, Any],
) -> dict[str, Any]:
    result: dict[str, Any] = {"product": {"targetId": "settings-platform", "revision": registry["registryVersion"]}}
    for scope in ("user-device", "vault", "workspace-project", "session"):
        target_id = _target_for_scope(scope, context)
        if not target_id:
            continue
        result[scope] = {
            "targetId": target_id,
            "revision": documents.get(scope, {}).get("revision", 0),
        }
    return result


def _value_candidates(
    definition: dict[str, Any],
    documents: dict[str, dict[str, Any]],
    secret_status: dict[str, str],
    registry_version: str,
    created_at: str,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for scope in SCOPE_PRECEDENCE:
        if scope == "product":
            candidates.append(
                {
                    "scope": scope,
                    "revision": registry_version,
                    "value": _product_value(definition, secret_status),
                    "provenance": {"actor": "registry", "source": "registry/v1.json"},
                }
            )
            continue
        if scope not in definition["allowedScopes"]:
            continue
        document = documents.get(scope)
        if not document:
            continue
        assignment = next(
            (item for item in document["assignments"] if item["key"] == definition["key"]),
            None,
        )
        if assignment is None or _assignment_expired(assignment, created_at):
            continue
        candidates.append(
            {
                "scope": scope,
                "revision": document["revision"],
                "value": _assignment_value(definition, assignment, secret_status),
                "provenance": copy.deepcopy(assignment["provenance"]),
                "_assignment": assignment,
            }
        )
    return candidates


def _product_value(definition: dict[str, Any], secret_status: dict[str, str]) -> Any:
    if definition["valueType"] == "secret-reference":
        ref = definition["defaultSecretRef"]
        return {
            "secretRef": copy.deepcopy(ref),
            "status": secret_status.get(f"{ref['provider']}:{ref['locator']}", "missing"),
        }
    return copy.deepcopy(definition.get("defaultValue"))


def _assignment_value(definition: dict[str, Any], assignment: dict[str, Any], secret_status: dict[str, str]) -> Any:
    if definition["valueType"] == "secret-reference":
        ref = assignment.get("secretRef", definition["defaultSecretRef"])
        return {
            "secretRef": copy.deepcopy(ref),
            "status": secret_status.get(f"{ref['provider']}:{ref['locator']}", "missing"),
        }
    return copy.deepcopy(assignment.get("value"))


def _validate_document_shape(document: dict[str, Any]) -> list[dict[str, Any]]:
    scope = document.get("scope")
    target_id = document.get("targetId")
    issues: list[dict[str, Any]] = []
    if document.get("schemaVersion") != SCHEMA_VERSION:
        issues.append(
            _issue(
                "unsupported-schema-version",
                f"Unsupported settings schema version {document.get('schemaVersion')}.",
                scope=scope,
                targetId=target_id,
            )
        )
    revision = document.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        issues.append(
            _issue(
                "invalid-revision", "Settings revision must be a non-negative integer.", scope=scope, targetId=target_id
            )
        )
    if scope not in MUTABLE_SCOPES:
        issues.append(
            _issue(
                "invalid-scope",
                "Settings scope must be user-device, vault, workspace-project, or session.",
                targetId=target_id,
            )
        )
    if not isinstance(target_id, str) or not target_id:
        issues.append(_issue("invalid-target", "Settings targetId is required.", scope=scope, targetId=target_id))
    elif scope == "workspace-project" and not _is_project_id(target_id):
        issues.append(
            _issue(
                "invalid-target",
                "Workspace Project settings targetId must use project/<lowercase-kebab-slug>.",
                scope=scope,
                targetId=target_id,
            )
        )
    if not isinstance(document.get("assignments"), list):
        issues.append(
            _issue("invalid-assignments", "Settings assignments must be an array.", scope=scope, targetId=target_id)
        )
    if not _iso_timestamp(document.get("updatedAt")):
        issues.append(
            _issue(
                "invalid-updated-at", "Settings updatedAt must be an ISO timestamp.", scope=scope, targetId=target_id
            )
        )
    if not isinstance(document.get("updatedBy"), str) or not document["updatedBy"].strip():
        issues.append(_issue("invalid-updated-by", "Settings updatedBy is required.", scope=scope, targetId=target_id))
    return issues


def _validate_assignment(
    definition: dict[str, Any], scope: str, target_id: str, assignment: dict[str, Any]
) -> list[dict[str, Any]]:
    key = definition["key"]
    issues: list[dict[str, Any]] = []
    if scope not in definition["allowedScopes"]:
        issues.append(
            _issue(
                "scope-not-allowed",
                f"{key} cannot be assigned at {scope} scope.",
                key=key,
                scope=scope,
                targetId=target_id,
            )
        )
    provenance = assignment.get("provenance")
    if (
        not isinstance(provenance, dict)
        or not isinstance(provenance.get("actor"), str)
        or not provenance["actor"].strip()
        or not isinstance(provenance.get("source"), str)
        or not provenance["source"].strip()
    ):
        issues.append(
            _issue(
                "missing-provenance",
                f"{key} assignment provenance is required.",
                key=key,
                scope=scope,
                targetId=target_id,
            )
        )
    if "expiresAt" in assignment and scope != "session":
        issues.append(
            _issue(
                "expiry-not-allowed",
                f"{key} expiry is only valid at session scope.",
                key=key,
                scope=scope,
                targetId=target_id,
            )
        )
    elif "expiresAt" in assignment and not _iso_timestamp(assignment["expiresAt"]):
        issues.append(
            _issue(
                "invalid-expiry", f"{key} expiry must be an ISO timestamp.", key=key, scope=scope, targetId=target_id
            )
        )
    if definition["valueType"] == "secret-reference":
        if "value" in assignment or not _is_secret_reference(assignment.get("secretRef")):
            issues.append(
                _issue(
                    "invalid-secret-reference",
                    f"{key} must contain a Secret Reference; plaintext secret material is never accepted.",
                    key=key,
                    scope=scope,
                    targetId=target_id,
                    remediation="Store the secret in an approved provider and assign only its opaque reference.",
                )
            )
        return issues
    if "secretRef" in assignment or "value" not in assignment:
        issues.append(
            _issue("invalid-value", f"{key} must contain a typed value.", key=key, scope=scope, targetId=target_id)
        )
        return issues
    issues.extend(_validate_value(definition, assignment["value"], key=key, scope=scope, targetId=target_id))
    return issues


def _validate_value(definition: dict[str, Any], value: Any, **location: Any) -> list[dict[str, Any]]:
    value_type = definition["valueType"]
    valid_type = (
        (value_type == "boolean" and isinstance(value, bool))
        or (value_type == "integer" and isinstance(value, int) and not isinstance(value, bool))
        or (
            value_type == "number"
            and isinstance(value, (int, float))
            and not isinstance(value, bool)
            and math.isfinite(value)
        )
        or (value_type in ("string", "enum", "path", "duration") and isinstance(value, str))
        or (value_type == "list" and isinstance(value, list))
        or (value_type == "object" and isinstance(value, dict))
    )
    if not valid_type:
        return [_issue("type-mismatch", f"{definition['key']} must be a {value_type}.", **location)]
    validator = definition["validator"]
    issues: list[dict[str, Any]] = []
    if validator.get("required") and isinstance(value, str) and not value.strip():
        issues.append(_issue("required-value-missing", f"{definition['key']} is required.", **location))
    if validator.get("enum") and value not in validator["enum"]:
        issues.append(_issue("enum-mismatch", f"{definition['key']} must use an allowed value.", **location))
    if isinstance(value, str):
        if validator.get("minLength") is not None and len(value) < validator["minLength"]:
            issues.append(_issue("string-too-short", f"{definition['key']} is shorter than allowed.", **location))
        if validator.get("maxLength") is not None and len(value) > validator["maxLength"]:
            issues.append(_issue("string-too-long", f"{definition['key']} is longer than allowed.", **location))
        if validator.get("pattern") and not re.search(validator["pattern"], value):
            issues.append(
                _issue("pattern-mismatch", f"{definition['key']} does not match its declared format.", **location)
            )
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if validator.get("min") is not None and value < validator["min"]:
            issues.append(_issue("number-too-small", f"{definition['key']} is below its minimum.", **location))
        if validator.get("max") is not None and value > validator["max"]:
            issues.append(_issue("number-too-large", f"{definition['key']} exceeds its maximum.", **location))
    return issues


def _issue(code: str, message: str, *, severity: str = "error", **fields: Any) -> dict[str, Any]:
    result = {"code": code, "severity": severity, "message": message}
    result.update({key: value for key, value in fields.items() if value is not None})
    return result


def _plan_mutation(
    *,
    registry: dict[str, Any],
    current: dict[str, Any],
    scope: str,
    target_id: str,
    kind: str,
    key: str,
    value: Any,
    updated_by: str,
    source: str,
    reason: str | None,
    expires_at: str | None,
    clock: Callable[[], str],
) -> dict[str, Any]:
    definition = _definition(registry, key)
    if definition is None:
        return {
            "status": "validation-error",
            "document": copy.deepcopy(current),
            "validation": {
                "valid": False,
                "issues": [
                    _issue(
                        "unknown-setting",
                        f"Unknown setting {key} cannot be mutated.",
                        key=key,
                        scope=scope,
                        targetId=target_id,
                    )
                ],
            },
        }
    assignments = [copy.deepcopy(item) for item in current["assignments"] if item["key"] != key]
    if kind == "set":
        provenance = {"actor": updated_by, "source": source}
        if reason:
            provenance["reason"] = reason
        assignment: dict[str, Any] = {"key": key, "provenance": provenance}
        if expires_at:
            assignment["expiresAt"] = expires_at
        if definition["valueType"] == "secret-reference" and _is_secret_reference(value):
            assignment["secretRef"] = copy.deepcopy(value)
        else:
            assignment["value"] = copy.deepcopy(value)
        assignments.append(assignment)
    assignments.sort(key=lambda item: item["key"])
    now = clock()
    proposed = {
        **copy.deepcopy(current),
        "revision": current["revision"] + 1,
        "assignments": assignments,
        "updatedAt": now,
        "updatedBy": updated_by,
    }
    proposed.pop("previousRevision", None)
    validation = validate_documents(registry, [proposed])
    if not validation["valid"]:
        return {"status": "validation-error", "document": copy.deepcopy(current), "validation": validation}
    return {
        "status": "planned",
        "proposed": proposed,
        "event": {
            "type": "SettingsAssignmentsChanged",
            "scope": scope,
            "targetId": target_id,
            "previousRevision": current["revision"],
            "revision": proposed["revision"],
            "keys": [key],
            "actor": updated_by,
            "occurredAt": now,
        },
    }


def _changed_assignment_keys(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    previous = {item["key"]: canonical_json(item) for item in before["assignments"]}
    current = {item["key"]: canonical_json(item) for item in after["assignments"]}
    return sorted(key for key in previous.keys() | current.keys() if previous.get(key) != current.get(key))


def _definition(registry: dict[str, Any], key: str) -> dict[str, Any] | None:
    return next((definition for definition in registry["definitions"] if definition["key"] == key), None)


def _is_secret_reference(value: Any) -> bool:
    if not isinstance(value, dict) or value.get("provider") not in SECRET_PROVIDERS:
        return False
    locator = value.get("locator")
    if not isinstance(locator, str) or not locator or locator != locator.strip():
        return False
    if "version" in value and not (isinstance(value.get("version"), str) and bool(value["version"])):
        return False
    if value["provider"] == "environment":
        return ENVIRONMENT_SECRET_LOCATOR_PATTERN.fullmatch(locator) is not None
    return (
        len(locator) <= 255
        and SECRET_MATERIAL_PATTERN.search(locator) is None
        and OPAQUE_SECRET_LOCATOR_PATTERN.fullmatch(locator) is not None
        and all(segment not in (".", "..") for segment in locator.split("/"))
    )


def _environment_secret(environment: dict[str, str], locator: str) -> str | None:
    value = environment.get(locator)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _is_project_id(value: Any) -> bool:
    return isinstance(value, str) and PROJECT_ID_PATTERN.fullmatch(value) is not None


def _project_slug(value: Any) -> str:
    match = PROJECT_ID_PATTERN.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        raise ValueError("Workspace Project ID must use project/<lowercase-kebab-slug>")
    return match.group("slug")


def _validate_runtime_context(context: dict[str, Any]) -> None:
    if "workspaceProjectId" in context:
        _project_slug(context["workspaceProjectId"])


def _scope_matches_context(scope: str, target_id: str, context: dict[str, Any]) -> bool:
    return target_id == _target_for_scope(scope, context)


def _target_for_scope(scope: str, context: dict[str, Any]) -> str | None:
    target = {
        "user-device": context.get("userDeviceId"),
        "vault": context.get("vaultId"),
        "workspace-project": context.get("workspaceProjectId"),
        "session": context.get("sessionId"),
    }.get(scope)
    if scope == "workspace-project" and target is not None:
        _project_slug(target)
    return target


def _assignment_expired(assignment: dict[str, Any], created_at: str) -> bool:
    if "expiresAt" not in assignment:
        return False
    try:
        return _timestamp(assignment["expiresAt"]) <= _timestamp(created_at)
    except (AttributeError, TypeError, ValueError):
        return False


def _timestamp(value: str) -> float:
    from datetime import datetime

    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def _iso_timestamp(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    if not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})",
        value,
    ):
        return False
    try:
        _timestamp(value)
        return True
    except (AttributeError, TypeError, ValueError):
        return False


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        with temporary.open("xb") as handle:
            handle.write(content.encode("utf-8"))
            handle.flush()
            os.fsync(handle.fileno())
        _replace_with_retry(temporary, path)
        _sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def _replace_with_retry(source: Path, target: Path) -> None:
    last_error: OSError | None = None
    for attempt in range(8):
        try:
            os.replace(source, target)
            return
        except PermissionError as exc:
            last_error = exc
            time.sleep(0.01 * (attempt + 1))
    if last_error:
        raise last_error


def _sync_directory(path: Path) -> None:
    try:
        descriptor = os.open(path, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)


def _safe_identity(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return normalized or "default-vault"


def normalize_host_capability_connector_id(value: Any) -> str | None:
    """Normalize a generic Host selector into the governed connector namespace."""
    if not isinstance(value, str) or value != value.strip():
        return None
    if not HOST_CONNECTOR_SELECTOR_PATTERN.fullmatch(value):
        return None
    return value if value.startswith("connector/") else f"connector/{value}"


def _probe_python(executable: str) -> bool:
    try:
        result = subprocess.run(
            [executable, "--version"],
            capture_output=True,
            text=True,
            timeout=1.5,
            check=False,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _health(
    capability_id: str,
    state: str,
    summary: str,
    checked_at: str,
    snapshot_id: str,
    evidence_status: str,
    remediations: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "capabilityId": capability_id,
        "state": state,
        "summary": summary,
        "evidence": [
            {
                "code": f"{capability_id}-probe",
                "summary": summary,
                "status": evidence_status,
                "observedAt": checked_at,
            }
        ],
        "remediations": remediations,
        "checkedAt": checked_at,
        "snapshotId": snapshot_id,
    }


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
