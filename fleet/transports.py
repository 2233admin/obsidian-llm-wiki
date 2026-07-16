"""
Fleet transport adapters — transport-pluggable peer connectivity.

A transport answers three questions about one peer endpoint:
    reachable() -- health probe, cheap, run at scan/CLI time (no daemon)
    exec()      -- run a command on/against the peer
    copy()      -- move a file to the peer

NetBird / WireGuard / public-IP / jump-host are not separate transports:
they are just different address providers underneath SSH, labelled via the
endpoint's ``via`` field for reporting. orca-local is a filesystem transport
(same host, no network). A shared git remote (gitea) is a store-and-forward
rendezvous: reachable yes, exec no.

Secrets never live in endpoint config. SSH keys stay in ssh config / the
agent; the gitea token stays in the GITEA_TOKEN environment variable and is
handed to git through a generated askpass helper, never through URLs or argv.
"""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path


class TransportCapabilityError(RuntimeError):
    """The transport cannot perform the requested operation by design."""


@dataclass
class ProbeResult:
    ok: bool
    kind: str
    via: str
    latency_ms: int
    detail: str = ""

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "kind": self.kind,
            "via": self.via,
            "latencyMs": self.latency_ms,
            "detail": self.detail,
        }


@dataclass
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str


class Transport(ABC):
    kind: str = "abstract"
    can_exec: bool = True
    can_copy: bool = True

    def __init__(self, config: dict[str, str]):
        self.config = config
        self.via = config.get("via", self.kind)

    @abstractmethod
    def reachable(self, timeout: float = 8.0) -> ProbeResult: ...

    @abstractmethod
    def exec(self, argv: list[str], timeout: float = 60.0) -> ExecResult: ...

    @abstractmethod
    def copy(self, src: str, dst: str, timeout: float = 60.0) -> None: ...

    def _probe(self, ok: bool, started: float, detail: str = "") -> ProbeResult:
        return ProbeResult(
            ok=ok,
            kind=self.kind,
            via=self.via,
            latency_ms=int((time.monotonic() - started) * 1000),
            detail=detail,
        )


class SshTransport(Transport):
    """SSH endpoint. NetBird/WireGuard/public IPs are all just ``host``."""

    kind = "ssh"

    def __init__(self, config: dict[str, str]):
        super().__init__(config)
        host = config.get("host", "").strip()
        if not host:
            raise ValueError("ssh transport requires config.host")
        self.host = host
        self.user = config.get("user", "").strip()
        self.port = str(config.get("port", "")).strip()
        # "none" bypasses ~/.ssh/config (ProxyCommand/Match rules can break
        # direct mesh-IP connections); a path pins a specific config file.
        # This is a reference, never a secret.
        self.config_file = config.get("configFile", "").strip()

    @property
    def destination(self) -> str:
        return f"{self.user}@{self.host}" if self.user else self.host

    def _base_argv(self, timeout: float) -> list[str]:
        argv = ["ssh"]
        if self.config_file:
            argv += ["-F", self.config_file]
        argv += [
            "-o", "BatchMode=yes",
            "-o", f"ConnectTimeout={max(1, int(timeout))}",
            "-o", "StrictHostKeyChecking=accept-new",
        ]
        if self.port:
            argv += ["-p", self.port]
        return argv

    def probe_argv(self, timeout: float = 8.0) -> list[str]:
        return self._base_argv(timeout) + [self.destination, "exit"]

    def reachable(self, timeout: float = 8.0) -> ProbeResult:
        started = time.monotonic()
        try:
            completed = subprocess.run(
                self.probe_argv(timeout),
                capture_output=True, text=True, timeout=timeout + 4,
            )
        except FileNotFoundError:
            return self._probe(False, started, "ssh binary not found")
        except subprocess.TimeoutExpired:
            return self._probe(False, started, "probe timed out")
        detail = "" if completed.returncode == 0 else (completed.stderr.strip().splitlines() or ["unreachable"])[-1]
        return self._probe(completed.returncode == 0, started, detail)

    def exec(self, argv: list[str], timeout: float = 60.0) -> ExecResult:
        remote = " ".join(argv)
        completed = subprocess.run(
            self._base_argv(timeout) + [self.destination, remote],
            capture_output=True, text=True, timeout=timeout,
        )
        return ExecResult(completed.returncode, completed.stdout, completed.stderr)

    def copy(self, src: str, dst: str, timeout: float = 60.0) -> None:
        argv = ["scp"]
        if self.config_file:
            argv += ["-F", self.config_file]
        argv += ["-o", "BatchMode=yes"]
        if self.port:
            argv += ["-P", self.port]
        argv += [src, f"{self.destination}:{dst}"]
        completed = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
        if completed.returncode != 0:
            raise RuntimeError(f"scp failed: {completed.stderr.strip()}")


class LocalFsTransport(Transport):
    """orca-local: the peer is a workspace directory on this same host."""

    kind = "orca-local"

    def __init__(self, config: dict[str, str]):
        super().__init__(config)
        path = config.get("path", "").strip()
        if not path:
            raise ValueError("orca-local transport requires config.path")
        self.path = Path(os.path.expanduser(path))

    def reachable(self, timeout: float = 8.0) -> ProbeResult:
        started = time.monotonic()
        ok = self.path.is_dir()
        return self._probe(ok, started, "" if ok else f"not a directory: {self.path}")

    def exec(self, argv: list[str], timeout: float = 60.0) -> ExecResult:
        completed = subprocess.run(
            argv, capture_output=True, text=True, timeout=timeout, cwd=str(self.path),
        )
        return ExecResult(completed.returncode, completed.stdout, completed.stderr)

    def copy(self, src: str, dst: str, timeout: float = 60.0) -> None:
        target = self.path / dst
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, target)


class GiteaTransport(Transport):
    """Store-and-forward rendezvous over a shared git remote.

    reachable() proves the rendezvous is alive; command execution is
    impossible by design. The remote URL must be credential-free — the token
    flows GITEA_TOKEN (env) -> askpass helper -> git, mirroring the L2
    compile-publish hardening (Issue #51 P1).
    """

    kind = "gitea"
    can_exec = False
    can_copy = False

    def __init__(self, config: dict[str, str]):
        super().__init__(config)
        remote = config.get("remote", "").strip()
        if not remote:
            raise ValueError("gitea transport requires config.remote")
        # username-only userinfo (user@host) is fine; user:secret@host is not.
        head = remote.split("://", 1)[-1].split("/", 1)[0]
        if "@" in head and ":" in head.split("@", 1)[0]:
            raise ValueError("gitea remote URL must not embed credentials")
        self.remote = remote
        self.ref = config.get("ref", "main")

    def _git_env(self) -> dict[str, str]:
        env = dict(os.environ)
        env["GIT_TERMINAL_PROMPT"] = "0"
        if env.get("GITEA_TOKEN"):
            helper_dir = Path(tempfile.gettempdir()) / "llmwiki-fleet"
            helper_dir.mkdir(parents=True, exist_ok=True)
            if sys.platform == "win32":
                helper = helper_dir / "askpass.cmd"
                helper.write_text("@echo off\r\necho %GITEA_TOKEN%\r\n", encoding="ascii")
            else:
                helper = helper_dir / "askpass.sh"
                helper.write_text("#!/bin/sh\necho \"$GITEA_TOKEN\"\n", encoding="ascii")
                helper.chmod(helper.stat().st_mode | stat.S_IEXEC)
            env["GIT_ASKPASS"] = str(helper)
        return env

    def reachable(self, timeout: float = 8.0) -> ProbeResult:
        started = time.monotonic()
        try:
            completed = subprocess.run(
                ["git", "-c", "credential.helper=", "ls-remote", self.remote, self.ref],
                capture_output=True, text=True, timeout=timeout + 12, env=self._git_env(),
            )
        except FileNotFoundError:
            return self._probe(False, started, "git binary not found")
        except subprocess.TimeoutExpired:
            return self._probe(False, started, "ls-remote timed out")
        detail = ""
        if completed.returncode == 0:
            head = completed.stdout.strip().split("\t")[0][:12]
            detail = f"{self.ref}@{head}" if head else "reachable"
        else:
            detail = (completed.stderr.strip().splitlines() or ["unreachable"])[-1]
        return self._probe(completed.returncode == 0, started, detail)

    def exec(self, argv: list[str], timeout: float = 60.0) -> ExecResult:
        raise TransportCapabilityError("gitea is store-and-forward: it cannot execute commands on the peer")

    def copy(self, src: str, dst: str, timeout: float = 60.0) -> None:
        raise TransportCapabilityError("gitea copy is not implemented yet; push to the shared remote instead")


_TRANSPORTS: dict[str, type[Transport]] = {
    SshTransport.kind: SshTransport,
    LocalFsTransport.kind: LocalFsTransport,
    GiteaTransport.kind: GiteaTransport,
}


def build_transport(kind: str, config: dict[str, str]) -> Transport:
    try:
        cls = _TRANSPORTS[kind]
    except KeyError:
        raise ValueError(f"unknown transport kind: {kind!r} (known: {sorted(_TRANSPORTS)})") from None
    return cls(config)


def known_transport_kinds() -> list[str]:
    return sorted(_TRANSPORTS)
