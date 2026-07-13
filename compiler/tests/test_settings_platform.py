import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
COMPILER = ROOT / "compiler"
if str(COMPILER) not in sys.path:
    sys.path.insert(0, str(COMPILER))

from settings_platform import (  # noqa: E402
    FileSettingsStore,
    SettingsService,
    canonical_json,
    default_user_device_id,
    load_registry,
    load_schema,
    resolve_settings,
    settings_document_path,
    validate_documents,
    validate_effective_value,
)


def _fixture(name: str) -> dict:
    path = ROOT / "packages" / "settings-platform" / "fixtures" / name
    return json.loads(path.read_text("utf-8"))


def test_python_resolver_matches_the_shared_canonical_snapshot():
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    fixture = _fixture("conformance/full-precedence.json")
    expected = _fixture("expected/full-precedence.snapshot.json")

    actual = resolve_settings(registry=registry, **fixture)

    assert canonical_json(actual) == canonical_json(expected)
    assert "sk-" not in canonical_json(actual)


def test_python_precedence_and_unset_fallback_cover_every_supported_setting_type():
    fixture = _fixture("conformance/all-types-precedence.json")
    context = {"userDeviceId": "device-test", "vaultId": "vault-test", "sessionId": "session-test"}
    for index, item in enumerate(fixture["cases"]):
        secret = item["valueType"] == "secret-reference"
        definition = {
            "key": f"tests.type_{index}.value",
            "owner": "tests",
            "category": "tests",
            "name": f"Type {item['valueType']}",
            "description": f"Shared precedence fixture for {item['valueType']}.",
            "valueType": item["valueType"],
            **({"defaultSecretRef": item["defaultSecretRef"]} if secret else {"defaultValue": item["defaultValue"]}),
            "allowedScopes": ["vault", "session"],
            "sensitivity": "secret-reference" if secret else "public",
            "validator": item.get("validator", {"id": f"fixture-{item['valueType']}"}),
            "requires": [],
            "applyMode": "hot",
            "visibility": "internal",
        }
        registry = {
            "schemaVersion": 1,
            "registryVersion": "fixture",
            "registryDigest": "sha256:fixture",
            "definitions": [definition],
            "migrations": [],
        }

        def document(scope: str, value: object) -> dict:
            return {
                "schemaVersion": 1,
                "scope": scope,
                "targetId": f"{scope}-test",
                "revision": 1,
                "assignments": [
                    {
                        "key": definition["key"],
                        **({"secretRef": value} if secret else {"value": value}),
                        "provenance": {"actor": "fixture", "source": scope},
                    }
                ],
                "updatedAt": "2026-07-14T00:00:00.000Z",
                "updatedBy": "fixture",
            }

        refs = [item.get(name) for name in ("defaultSecretRef", "lowerSecretRef", "higherSecretRef")]
        secret_status = {
            f"{ref['provider']}:{ref['locator']}": "present" for ref in refs if isinstance(ref, dict)
        }
        resolved = resolve_settings(
            registry=registry,
            context=context,
            documents=[
                document("vault", item["lowerSecretRef"] if secret else item["lowerValue"]),
                document("session", item["higherSecretRef"] if secret else item["higherValue"]),
            ],
            createdAt="2026-07-14T00:00:00.000Z",
            secretStatus=secret_status,
        )
        unset = resolve_settings(
            registry=registry,
            context=context,
            documents=[],
            createdAt="2026-07-14T00:00:00.000Z",
            secretStatus=secret_status,
        )

        assert resolved["effective"][0]["winningScope"] == "session", item["valueType"]
        assert resolved["effective"][0]["overriddenCandidates"][0]["scope"] == "vault", item["valueType"]
        assert unset["effective"][0]["winningScope"] == "product", item["valueType"]
        if secret:
            assert resolved["effective"][0]["value"]["secretRef"] == item["higherSecretRef"]
            assert unset["effective"][0]["value"]["secretRef"] == item["defaultSecretRef"]
        else:
            assert resolved["effective"][0]["value"] == item["higherValue"]
            assert unset["effective"][0]["value"] == item["defaultValue"]


def test_python_canonical_numbers_match_ecmascript_json_spelling():
    assert (
        canonical_json({"tiny": 1e-7, "fixed": 1e-6, "integer": 1.0, "negativeZero": -0.0})
        == '{"fixed":0.000001,"integer":1,"negativeZero":0,"tiny":1e-7}'
    )
    assert canonical_json({"\ue000": 2, "😀": 1}) == '{"😀":1,"":2}'


def test_python_loads_shared_schemas_and_rejects_incomplete_registry_definitions(tmp_path: Path):
    schema = load_schema("settings-snapshot.schema.json")
    assert schema["$id"].endswith("/settings-snapshot.schema.json")

    registry_path = ROOT / "packages" / "settings-platform" / "registry" / "v1.json"
    incomplete = json.loads(registry_path.read_text("utf-8"))
    del incomplete["definitions"][0]["owner"]
    invalid_path = tmp_path / "invalid-registry.json"
    invalid_path.write_text(json.dumps(incomplete), "utf-8")
    with pytest.raises(ValueError, match="metadata|owner"):
        load_registry(invalid_path)


def test_python_validation_matches_every_shared_bounded_value_case():
    fixture = _fixture("conformance/validation-cases.json")
    for item in fixture["cases"]:
        result = validate_effective_value(item["definition"], item["value"])
        assert [issue["code"] for issue in result["issues"]] == item["expectedCodes"], item["name"]


def test_python_default_user_device_identity_is_stable_across_processes():
    assert default_user_device_id({}) == default_user_device_id({})
    assert str(os.getpid()) not in default_user_device_id({})


def test_python_validation_reports_malformed_timestamps_without_crashing():
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    for invalid_timestamp in (None, "2026-07-14"):
        result = validate_documents(
            registry,
            [
                {
                    "schemaVersion": 1,
                    "scope": "vault",
                    "targetId": "vault-test",
                    "revision": 1,
                    "assignments": [],
                    "updatedAt": invalid_timestamp,
                    "updatedBy": "pytest",
                }
            ],
        )

        assert result["valid"] is False
        assert any(issue["code"] == "invalid-updated-at" for issue in result["issues"])


def test_python_persistence_matches_revision_backup_and_redaction_semantics(tmp_path: Path):
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    path = tmp_path / "vault.json"
    store = FileSettingsStore("vault", "vault-test", path, registry)

    first = store.set("query.semantic.enabled", True, expected_revision=0, updated_by="pytest")
    assert first["status"] == "committed"
    second = store.set("query.semantic.enabled", False, expected_revision=1, updated_by="pytest")
    assert second["status"] == "committed"
    assert json.loads(Path(f"{path}.bak").read_text("utf-8"))["revision"] == 1

    stale = store.set("query.semantic.enabled", True, expected_revision=1, updated_by="stale")
    assert stale["status"] == "conflict"
    assert stale["conflict"]["actualRevision"] == 2

    invalid = store.set(
        "providers.web_search.secret_ref",
        "sk-plaintext-must-never-persist",
        expected_revision=2,
        updated_by="pytest",
    )
    assert invalid["status"] == "validation-error"
    assert "sk-plaintext-must-never-persist" not in canonical_json(invalid)
    assert "sk-plaintext-must-never-persist" not in path.read_text("utf-8")


def test_python_conflict_reports_only_keys_changed_since_previous_revision(tmp_path: Path):
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    store = FileSettingsStore("vault", "vault-test", tmp_path / "vault.json", registry)
    store.set("query.semantic.enabled", True, expected_revision=0, updated_by="pytest")
    store.set("diagnostics.obc.semantic.enabled", True, expected_revision=1, updated_by="pytest")

    conflict = store.set("query.semantic.enabled", False, expected_revision=1, updated_by="stale")

    assert conflict["status"] == "conflict"
    assert conflict["conflict"]["changedKeys"] == ["diagnostics.obc.semantic.enabled"]


@pytest.mark.parametrize("scope,target_id", [("user-device", "device-a"), ("workspace-project", "project-alpha")])
def test_python_file_scope_adapters_preserve_their_physical_boundary(
    tmp_path: Path, scope: str, target_id: str
):
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    user_path = tmp_path / "user" / "device.json"
    path = settings_document_path(scope, tmp_path / "vault", user_path, target_id)
    store = FileSettingsStore(scope, target_id, path, registry)
    key = "runtime.python.path" if scope == "user-device" else "query.semantic.enabled"
    value = "python" if scope == "user-device" else True

    committed = store.set(key, value, expected_revision=0, updated_by="pytest")

    assert committed["status"] == "committed"
    assert path.exists()
    assert (path == user_path) is (scope == "user-device")


def test_python_persistence_recovers_when_active_document_is_missing(tmp_path: Path):
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    path = tmp_path / "vault.json"
    store = FileSettingsStore("vault", "vault-test", path, registry)
    store.set("query.semantic.enabled", True, expected_revision=0, updated_by="pytest")
    store.set("query.semantic.enabled", False, expected_revision=1, updated_by="pytest")
    path.unlink()

    recovered = store.read()

    assert recovered["recoveredFromBackup"] is True
    assert recovered["document"]["revision"] == 1


def test_python_persistence_recovers_when_active_json_has_the_wrong_shape(tmp_path: Path):
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    path = tmp_path / "vault.json"
    store = FileSettingsStore("vault", "vault-test", path, registry)
    store.set("query.semantic.enabled", True, expected_revision=0, updated_by="pytest")
    store.set("query.semantic.enabled", False, expected_revision=1, updated_by="pytest")
    invalid_documents = [
        None,
        {
            "schemaVersion": 1,
            "scope": "vault",
            "targetId": "vault-test",
            "revision": 2,
            "assignments": [None],
            "updatedAt": "2026-07-14T00:00:00.000Z",
            "updatedBy": "bad-writer",
        },
    ]
    for invalid_document in invalid_documents:
        path.write_text(json.dumps(invalid_document) + "\n", "utf-8")
        recovered = store.read()
        assert recovered["recoveredFromBackup"] is True
        assert recovered["document"]["revision"] == 1


def test_python_migration_planner_can_inspect_a_legacy_document(tmp_path: Path):
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    service = SettingsService(
        registry=registry,
        vault_path=tmp_path,
        user_device_id="pytest-device",
        user_device_path=tmp_path / "device.json",
        vault_id="vault-test",
    )
    path = settings_document_path("vault", tmp_path, tmp_path / "device.json", "vault-test")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schemaVersion": 0,
                "scope": "vault",
                "targetId": "vault-test",
                "revision": 3,
                "assignments": [],
                "updatedAt": "2026-07-14T00:00:00.000Z",
                "updatedBy": "legacy-host",
            }
        ),
        "utf-8",
    )

    plan = service.migrations_plan()
    vault = next(item for item in plan["scopes"] if item["scope"] == "vault")

    assert vault["currentSchemaVersion"] == 0
    assert vault["requiresMigration"] is True
    assert [item["id"] for item in vault["migrations"]] == ["settings-document-v0-to-v1"]


def test_python_doctor_gives_remediation_for_degraded_and_unavailable_capabilities(tmp_path: Path):
    registry = load_registry(ROOT / "packages" / "settings-platform" / "registry" / "v1.json")
    service = SettingsService(
        registry=registry,
        vault_path=tmp_path,
        user_device_id="pytest-device",
        user_device_path=tmp_path / "device.json",
        python_path="missing-python",
        clock=lambda: "2026-07-14T00:00:00.000Z",
    )
    for revision, key in enumerate(
        ("query.semantic.enabled", "diagnostics.obc.semantic.enabled", "providers.web_search.enabled")
    ):
        committed = service.assignment_set(
            scope="session",
            key=key,
            value=True,
            expected_revision=revision,
            updated_by="pytest",
        )
        assert committed["status"] == "committed"

    doctor = service.doctor()

    actionable = [item for item in doctor["capabilities"] if item["state"] in ("degraded", "unavailable")]
    assert actionable
    assert all(item["remediations"] for item in actionable)
    diagnostics = next(item for item in doctor["capabilities"] if item["capabilityId"] == "diagnostics.obc.semantic")
    assert diagnostics["state"] == "degraded"
    assert diagnostics["evidence"][0]["status"] == "warn"
    assert any(item["code"] == "repair-python" for item in diagnostics["remediations"])


@pytest.mark.parametrize("subcommand", ["snapshot", "validate", "migrations-plan", "doctor"])
def test_existing_kb_meta_cli_exposes_settings_queries_without_obsidian(tmp_path: Path, subcommand: str):
    result = subprocess.run(
        [
            sys.executable,
            str(COMPILER / "kb_meta.py"),
            "settings",
            subcommand,
            str(tmp_path),
            "--user-device-id",
            "pytest-device",
            "--at",
            "2026-07-14T00:00:00.000Z",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr or result.stdout
    payload = json.loads(result.stdout)
    assert "error" not in payload


def test_python_cli_explain_uses_the_same_secret_presence_as_snapshot(tmp_path: Path):
    environment = {**os.environ, "TAVILY_API_KEY": "sk-never-return-this-value"}
    result = subprocess.run(
        [
            sys.executable,
            str(COMPILER / "kb_meta.py"),
            "settings",
            "explain",
            str(tmp_path),
            "--key",
            "providers.web_search.secret_ref",
            "--user-device-id",
            "pytest-device",
            "--at",
            "2026-07-14T00:00:00.000Z",
        ],
        cwd=ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr or result.stdout
    payload = json.loads(result.stdout)
    assert payload["value"]["status"] == "present"
    assert "sk-never-return-this-value" not in result.stdout
