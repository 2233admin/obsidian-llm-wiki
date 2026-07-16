"""
Fleet peer registry — peers + capabilities + ordered transport endpoints.

One JSON file describes every peer the local agent may talk to and every
path that can reach it. The Fleet Hub consumes this file instead of IPs
hardcoded in memories, scripts, and habits; when one transport dies the
next one is found by probing, never by editing configuration.

The registry is machine-local operational fact (lives under
``<vault>/.vault-mind/fleet/`` by default) and MUST NOT contain secrets:
``save()``/``load()`` refuse token-, password-, or key-shaped material.
Secrets stay in the environment or ssh config and are referenced implicitly
by the transports.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from .transports import ProbeResult, Transport, build_transport, known_transport_kinds

FLEET_REGISTRY_SCHEMA_VERSION = 1

# Anything matching these has no business inside a registry file.
_SECRET_VALUE_PATTERNS = [
    re.compile(r"BEGIN [A-Z ]*PRIVATE KEY"),
    re.compile(r"\bghp_[A-Za-z0-9]{20,}"),
    re.compile(r"\bglpat-[A-Za-z0-9_-]{10,}"),
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"://[^/\s]+:[^@/\s]+@"),  # userinfo with a password/token
    re.compile(r"\b[a-f0-9]{40,}\b", re.IGNORECASE),  # bare 40+ hex token
]
_SECRET_KEY_PATTERN = re.compile(r"token|secret|password|passwd|credential|apikey|api_key|private_key", re.IGNORECASE)


class FleetRegistryError(ValueError):
    """Registry file is malformed or violates the no-secrets rule."""


@dataclass
class TransportEndpoint:
    kind: str
    priority: int
    config: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "priority": self.priority, "config": dict(self.config)}

    @classmethod
    def from_dict(cls, data: dict) -> "TransportEndpoint":
        return cls(
            kind=str(data.get("kind", "")),
            priority=int(data.get("priority", 100)),
            config={str(k): str(v) for k, v in dict(data.get("config", {})).items()},
        )

    def build(self) -> Transport:
        return build_transport(self.kind, self.config)


@dataclass
class PeerSpec:
    device_id: str
    display_name: str = ""
    capabilities: list[str] = field(default_factory=list)
    transports: list[TransportEndpoint] = field(default_factory=list)

    def ordered_transports(self) -> list[TransportEndpoint]:
        return sorted(self.transports, key=lambda item: item.priority)

    def to_dict(self) -> dict:
        return {
            "deviceId": self.device_id,
            "displayName": self.display_name,
            "capabilities": list(self.capabilities),
            "transports": [item.to_dict() for item in self.ordered_transports()],
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PeerSpec":
        device_id = str(data.get("deviceId", "")).strip()
        if not device_id:
            raise FleetRegistryError("peer entry is missing deviceId")
        return cls(
            device_id=device_id,
            display_name=str(data.get("displayName", "")),
            capabilities=[str(item) for item in data.get("capabilities", [])],
            transports=[TransportEndpoint.from_dict(item) for item in data.get("transports", [])],
        )


def _scan_for_secrets(node: object, path: str = "$") -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            key_str = str(key)
            if _SECRET_KEY_PATTERN.search(key_str):
                raise FleetRegistryError(
                    f"registry must not carry secrets: suspicious key {key_str!r} at {path}"
                )
            _scan_for_secrets(value, f"{path}.{key_str}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            _scan_for_secrets(value, f"{path}[{index}]")
    elif isinstance(node, str):
        for pattern in _SECRET_VALUE_PATTERNS:
            if pattern.search(node):
                raise FleetRegistryError(
                    f"registry must not carry secrets: value at {path} matches {pattern.pattern!r}"
                )


@dataclass
class PeerProbeReport:
    device_id: str
    results: list[ProbeResult] = field(default_factory=list)

    @property
    def reachable(self) -> bool:
        return any(result.ok for result in self.results)

    def to_dict(self) -> dict:
        return {
            "deviceId": self.device_id,
            "reachable": self.reachable,
            "results": [result.to_dict() for result in self.results],
        }


class FleetRegistry:
    def __init__(self, peers: list[PeerSpec] | None = None):
        self.peers: list[PeerSpec] = peers or []

    # -- persistence ---------------------------------------------------------

    @classmethod
    def default_path(cls, vault: str | os.PathLike[str]) -> Path:
        override = os.environ.get("LLMWIKI_FLEET_REGISTRY")
        if override:
            return Path(override)
        return Path(vault) / ".vault-mind" / "fleet" / "registry.json"

    @classmethod
    def load(cls, path: str | os.PathLike[str]) -> "FleetRegistry":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        if raw.get("schemaVersion") != FLEET_REGISTRY_SCHEMA_VERSION:
            raise FleetRegistryError(
                f"unsupported fleet registry schemaVersion: {raw.get('schemaVersion')!r}"
            )
        _scan_for_secrets(raw)
        registry = cls([PeerSpec.from_dict(item) for item in raw.get("peers", [])])
        for peer in registry.peers:
            for endpoint in peer.transports:
                if endpoint.kind not in known_transport_kinds():
                    raise FleetRegistryError(
                        f"peer {peer.device_id}: unknown transport kind {endpoint.kind!r}"
                    )
        return registry

    def to_dict(self) -> dict:
        return {
            "schemaVersion": FLEET_REGISTRY_SCHEMA_VERSION,
            "peers": [peer.to_dict() for peer in self.peers],
        }

    def save(self, path: str | os.PathLike[str]) -> None:
        payload = self.to_dict()
        _scan_for_secrets(payload)
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    # -- lookup / probing ----------------------------------------------------

    def peer(self, device_id: str) -> PeerSpec:
        for candidate in self.peers:
            if candidate.device_id == device_id:
                return candidate
        raise KeyError(f"unknown fleet peer: {device_id}")

    def probe(self, device_id: str, timeout: float = 8.0) -> PeerProbeReport:
        """Probe every transport of one peer, in priority order."""
        peer = self.peer(device_id)
        report = PeerProbeReport(device_id=device_id)
        for endpoint in peer.ordered_transports():
            try:
                transport = endpoint.build()
                report.results.append(transport.reachable(timeout))
            except ValueError as error:
                report.results.append(
                    ProbeResult(ok=False, kind=endpoint.kind, via=endpoint.config.get("via", endpoint.kind),
                                latency_ms=0, detail=str(error))
                )
        return report

    def probe_all(self, timeout: float = 8.0) -> list[PeerProbeReport]:
        return [self.probe(peer.device_id, timeout) for peer in self.peers]

    def connect(self, device_id: str, timeout: float = 8.0, require_exec: bool = False) -> Transport:
        """Return the first healthy transport for a peer, in priority order.

        This is the kill-one-transport guarantee: when the primary is down
        the next endpoint is selected by probing — no memories, scripts, or
        registry edits involved. ``require_exec`` skips store-and-forward
        transports that cannot run commands on the peer.
        """
        failures: list[str] = []
        for endpoint in self.peer(device_id).ordered_transports():
            try:
                transport = endpoint.build()
            except ValueError as error:
                failures.append(f"{endpoint.kind}: {error}")
                continue
            if require_exec and not transport.can_exec:
                failures.append(f"{endpoint.kind}/{transport.via}: cannot exec (skipped)")
                continue
            result = transport.reachable(timeout)
            if result.ok:
                return transport
            failures.append(f"{endpoint.kind}/{result.via}: {result.detail or 'unreachable'}")
        raise ConnectionError(
            f"no transport can reach {device_id}: " + "; ".join(failures)
        )
