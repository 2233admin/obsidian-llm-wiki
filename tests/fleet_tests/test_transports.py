"""Issue #51 Fleet regressions: transport-pluggable peer registry.

Covers the acceptance from
01-Projects/obsidian-llm-wiki/issues/fleet-agent-discovery-transports.md:
registry schema, no-secrets rule, ordered fallback, the kill-one-transport
guarantee, and Hub consumption of the registry instead of hardcoded IPs.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

from fleet import FleetHub
from fleet.registry import (
    FLEET_REGISTRY_SCHEMA_VERSION,
    FleetRegistry,
    FleetRegistryError,
    PeerSpec,
    TransportEndpoint,
)
from fleet.transports import (
    GiteaTransport,
    LocalFsTransport,
    SshTransport,
    TransportCapabilityError,
    build_transport,
)


def registry_dict(peers: list[dict]) -> dict:
    return {"schemaVersion": FLEET_REGISTRY_SCHEMA_VERSION, "peers": peers}


def write_registry(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def dead_ssh_endpoint(priority: int = 1) -> dict:
    # 127.0.0.1:9 (discard) — nothing listens there; the probe fails fast.
    # This models "NetBird control plane down": the endpoint is intact, the
    # path is dead.
    return {
        "kind": "ssh",
        "priority": priority,
        "config": {"host": "127.0.0.1", "port": "9", "user": "nobody", "via": "netbird"},
    }


def local_endpoint(path: Path, priority: int = 2) -> dict:
    return {"kind": "orca-local", "priority": priority, "config": {"path": str(path), "via": "orca"}}


def test_registry_roundtrip_orders_transports_by_priority(tmp_path: Path) -> None:
    workspace = tmp_path / "peer-ws"
    workspace.mkdir()
    file = write_registry(tmp_path / "registry.json", registry_dict([{
        "deviceId": "device/xart-80",
        "displayName": "5080",
        "capabilities": ["vault-host"],
        "transports": [local_endpoint(workspace, priority=5), dead_ssh_endpoint(priority=1)],
    }]))
    registry = FleetRegistry.load(file)
    peer = registry.peer("device/xart-80")
    kinds = [item.kind for item in peer.ordered_transports()]
    assert kinds == ["ssh", "orca-local"]

    out = tmp_path / "saved.json"
    registry.save(out)
    again = FleetRegistry.load(out)
    assert [p.device_id for p in again.peers] == ["device/xart-80"]


@pytest.mark.parametrize("poison", [
    # secret-shaped key inside transport config
    {"deviceId": "d", "transports": [{"kind": "ssh", "priority": 1,
        "config": {"host": "h", "token": "abc"}}]},
    # embedded credential in a URL
    {"deviceId": "d", "transports": [{"kind": "gitea", "priority": 1,
        "config": {"remote": "https://user:hunter2@git.example/repo.git"}}]},
    # bare 40-hex token (gitea token shape)
    {"deviceId": "d", "transports": [{"kind": "ssh", "priority": 1,
        "config": {"host": "0123456789abcdef0123456789abcdef01234567"}}]},
])
def test_registry_rejects_secret_shaped_material(tmp_path: Path, poison: dict) -> None:
    file = write_registry(tmp_path / "registry.json", registry_dict([poison]))
    with pytest.raises(FleetRegistryError, match="secret"):
        FleetRegistry.load(file)


def test_gitea_transport_rejects_credentialed_url() -> None:
    with pytest.raises(ValueError, match="credentials"):
        GiteaTransport({"remote": "https://user:tok@git.example:8418/x.git"})
    # username-only userinfo is a reference, not a secret
    GiteaTransport({"remote": "https://Curry@git.example:8418/x.git"})


def test_gitea_transport_is_store_and_forward_only() -> None:
    transport = GiteaTransport({"remote": "https://git.example/x.git"})
    with pytest.raises(TransportCapabilityError):
        transport.exec(["echo", "hi"])
    with pytest.raises(TransportCapabilityError):
        transport.copy("a", "b")


def test_local_transport_reachable_exec_copy(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    transport = build_transport("orca-local", {"path": str(workspace)})

    probe = transport.reachable()
    assert probe.ok and probe.kind == "orca-local"

    result = transport.exec([sys.executable, "-c", "print('fleet-ok')"])
    assert result.exit_code == 0
    assert "fleet-ok" in result.stdout

    src = tmp_path / "payload.txt"
    src.write_text("cargo", encoding="utf-8")
    transport.copy(str(src), "inbox/payload.txt")
    assert (workspace / "inbox" / "payload.txt").read_text(encoding="utf-8") == "cargo"


def test_ssh_probe_argv_shape_no_shell_and_batch_mode() -> None:
    transport = SshTransport({"host": "203.0.113.7", "user": "admin", "port": "2222", "via": "public"})
    argv = transport.probe_argv(timeout=5)
    assert argv[0] == "ssh"
    assert "BatchMode=yes" in argv
    assert "-p" in argv and "2222" in argv
    assert argv[-2:] == ["admin@203.0.113.7", "exit"]


def test_kill_one_transport_falls_back_without_editing_anything(tmp_path: Path) -> None:
    workspace = tmp_path / "peer-ws"
    workspace.mkdir()
    file = write_registry(tmp_path / "registry.json", registry_dict([{
        "deviceId": "device/xart-80",
        "transports": [dead_ssh_endpoint(priority=1), local_endpoint(workspace, priority=2)],
    }]))
    digest_before = hashlib.sha256(file.read_bytes()).hexdigest()

    registry = FleetRegistry.load(file)
    transport = registry.connect("device/xart-80", timeout=3)

    assert isinstance(transport, LocalFsTransport), "fallback transport must be selected"
    assert hashlib.sha256(file.read_bytes()).hexdigest() == digest_before, \
        "fallback must not rewrite the registry"

    report = registry.probe("device/xart-80", timeout=3)
    assert [r.ok for r in report.results] == [False, True]
    assert report.reachable


def test_connect_raises_when_every_transport_is_dead(tmp_path: Path) -> None:
    file = write_registry(tmp_path / "registry.json", registry_dict([{
        "deviceId": "device/gone",
        "transports": [dead_ssh_endpoint(priority=1),
                       local_endpoint(tmp_path / "does-not-exist", priority=2)],
    }]))
    registry = FleetRegistry.load(file)
    with pytest.raises(ConnectionError, match="device/gone"):
        registry.connect("device/gone", timeout=3)


def test_hub_consumes_registry_instead_of_hardcoded_ips(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    workspace = tmp_path / "peer-ws"
    workspace.mkdir()

    hub = FleetHub(vault=str(vault))
    missing = hub.peers()
    assert missing["exists"] is False

    write_registry(hub.registry_path, registry_dict([{
        "deviceId": "device/xart-80",
        "displayName": "5080",
        "capabilities": ["vault-host"],
        "transports": [dead_ssh_endpoint(priority=1), local_endpoint(workspace, priority=2)],
    }]))

    report = hub.peers(probe=True, timeout=3)
    assert report["exists"] is True
    (peer,) = report["peers"]
    assert peer["deviceId"] == "device/xart-80"
    assert peer["probe"]["reachable"] is True
    assert [r["ok"] for r in peer["probe"]["results"]] == [False, True]


def test_connect_require_exec_skips_store_and_forward(tmp_path: Path) -> None:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    file = write_registry(tmp_path / "registry.json", registry_dict([{
        "deviceId": "device/xart-80",
        "transports": [
            {"kind": "gitea", "priority": 1, "config": {"remote": "https://git.invalid/x.git"}},
            local_endpoint(workspace, priority=2),
        ],
    }]))
    registry = FleetRegistry.load(file)
    transport = registry.connect("device/xart-80", timeout=3, require_exec=True)
    assert isinstance(transport, LocalFsTransport)


def test_ssh_config_file_none_bypasses_local_ssh_config() -> None:
    transport = SshTransport({"host": "203.0.113.7", "configFile": "none"})
    argv = transport.probe_argv(timeout=5)
    assert argv[1:3] == ["-F", "none"]


def test_unknown_transport_kind_is_rejected(tmp_path: Path) -> None:
    file = write_registry(tmp_path / "registry.json", registry_dict([{
        "deviceId": "d",
        "transports": [{"kind": "carrier-pigeon", "priority": 1, "config": {}}],
    }]))
    with pytest.raises(FleetRegistryError, match="carrier-pigeon"):
        FleetRegistry.load(file)
