from __future__ import annotations

import json
import subprocess
from dataclasses import asdict
from pathlib import Path

from compiler import memu_sync
from compiler.settings_platform import SettingsService, default_registry_path, load_registry


def _service(tmp_path: Path, environment: dict[str, str]) -> SettingsService:
    return SettingsService(
        registry=load_registry(default_registry_path()),
        vault_path=tmp_path,
        user_device_id="memu-sync-test-device",
        user_device_path=tmp_path / "device-settings.json",
        session_id="memu-sync-test-session",
        environment=environment,
    )


def _set_session(
    service: SettingsService,
    key: str,
    value: object,
    revision: int,
) -> None:
    result = service.assignment_set(
        scope="session",
        key=key,
        value=value,
        expected_revision=revision,
        updated_by="pytest",
    )
    assert result["status"] == "committed"


def test_explicit_settings_are_authoritative_and_secret_resolves_last_mile(tmp_path: Path):
    private_dsn = "postgresql://device-user:device-secret@settings-db:5432/memu?sslmode=require"
    environment = {
        "MEMU_DSN": "postgresql://legacy-user:legacy-secret@legacy-db:5432/memu",
        "MEMU_USER_ID": "legacy-user-id",
        "MEMU_DEVICE_DSN": private_dsn,
    }
    service = _service(tmp_path, environment)
    _set_session(service, "adapters.enabled", ["memu"], 0)
    _set_session(service, "adapters.memu.dsn", "postgresql://settings-db:5432/memu", 1)
    _set_session(service, "adapters.memu.user_id", "settings-user-id", 2)
    _set_session(
        service,
        "adapters.memu.secret_ref",
        {"provider": "environment", "locator": "MEMU_DEVICE_DSN"},
        3,
    )
    args = memu_sync._parse_args(
        [
            "--vault", str(tmp_path),
            "--dsn", "postgresql://cli-db:5432/memu",
            "--user-id", "cli-user-id",
        ]
    )

    profile, resolved_service = memu_sync._resolve_memu_sync_profile(
        tmp_path,
        args,
        environment=environment,
        service=service,
    )

    assert profile.enabled is True
    assert profile.valid is True
    assert profile.public_dsn == "postgresql://settings-db:5432/memu"
    assert profile.user_id == "settings-user-id"
    assert profile.credential_reference == {
        "provider": "environment",
        "locator": "MEMU_DEVICE_DSN",
    }
    serialized = json.dumps(asdict(profile), sort_keys=True)
    assert "device-secret" not in serialized
    assert "legacy-secret" not in serialized
    assert memu_sync._resolve_memu_connection_dsn(profile, resolved_service) == private_dsn


def test_explicit_disablement_is_not_revived_by_legacy_environment(tmp_path: Path):
    environment = {
        "VAULT_MIND_ADAPTERS": "memu",
        "MEMU_DSN": "postgresql://legacy-user:legacy-secret@localhost:5432/memu",
    }
    service = _service(tmp_path, environment)
    _set_session(service, "adapters.enabled", ["filesystem"], 0)
    args = memu_sync._parse_args(["--vault", str(tmp_path)])

    profile, _ = memu_sync._resolve_memu_sync_profile(
        tmp_path,
        args,
        environment=environment,
        service=service,
    )

    assert profile.enabled is False
    assert "legacy-secret" not in json.dumps(asdict(profile), sort_keys=True)


def test_legacy_private_dsn_is_redacted_and_cli_private_dsn_fails_closed(tmp_path: Path):
    private_dsn = "postgresql://legacy-user:legacy-secret@localhost:5432/memu"
    environment = {"MEMU_DSN": private_dsn}
    service = _service(tmp_path, environment)
    args = memu_sync._parse_args(["--vault", str(tmp_path)])

    profile, resolved_service = memu_sync._resolve_memu_sync_profile(
        tmp_path,
        args,
        environment=environment,
        service=service,
    )

    assert profile.public_dsn == "postgresql://localhost:5432/memu"
    assert profile.credential_status == "present"
    assert "legacy-secret" not in json.dumps(asdict(profile), sort_keys=True)
    assert memu_sync._resolve_memu_connection_dsn(profile, resolved_service) == private_dsn

    cli_secret = "postgresql://cli-user:cli-secret@localhost:5432/memu"
    cli_args = memu_sync._parse_args(["--vault", str(tmp_path), "--dsn", cli_secret])
    cli_profile, _ = memu_sync._resolve_memu_sync_profile(
        tmp_path,
        cli_args,
        environment={},
        service=_service(tmp_path, {}),
    )
    assert cli_profile.valid is False
    assert cli_profile.public_dsn == ""
    assert "cli-secret" not in json.dumps(asdict(cli_profile), sort_keys=True)


def test_graph_subprocess_keeps_private_dsn_out_of_argv_logs_and_result(
    tmp_path: Path,
    monkeypatch,
):
    private_dsn = "postgresql://device-user:device-secret@localhost:5432/memu?sslmode=require"
    observed: dict[str, object] = {}

    def fake_run(command, **kwargs):
        observed["command"] = command
        observed["environment"] = kwargs["env"]
        return subprocess.CompletedProcess(
            command,
            0,
            stdout=json.dumps({"nodes_written": 1, "debug": private_dsn}),
            stderr="",
        )

    monkeypatch.setattr(memu_sync.subprocess, "run", fake_run)
    result = memu_sync._spawn_graph_cli(
        "python",
        "graph-write",
        private_dsn,
        "{}",
        cwd=str(tmp_path),
        timeout_ms=1000,
    )

    assert private_dsn not in observed["command"]
    assert "--dsn" not in observed["command"]
    assert observed["environment"]["MEMU_DSN"] == private_dsn
    assert result == {"nodes_written": 1, "debug": "[REDACTED]"}
    assert "device-secret" not in json.dumps(result)


def test_graph_subprocess_failure_does_not_reflect_child_output(tmp_path: Path, monkeypatch):
    private_dsn = "postgresql://device-user:device-secret@localhost:5432/memu"

    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 7, stdout=private_dsn, stderr=private_dsn)

    monkeypatch.setattr(memu_sync.subprocess, "run", fake_run)
    try:
        memu_sync._spawn_graph_cli(
            "python",
            "graph-write",
            private_dsn,
            "{}",
            cwd=str(tmp_path),
            timeout_ms=1000,
        )
    except RuntimeError as exc:
        assert "device-secret" not in str(exc)
        assert "postgresql://" not in str(exc)
    else:
        raise AssertionError("expected graph subprocess failure")
