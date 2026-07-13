from __future__ import annotations

import io
import importlib.util
import json
from pathlib import Path
from typing import Any

import pytest


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "verify_release_install.py"
SPEC = importlib.util.spec_from_file_location("verify_release_install", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
verify_release_install = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify_release_install)

REQUIRED_RELEASE_OPERATIONS = verify_release_install.REQUIRED_RELEASE_OPERATIONS
RELEASE_INSTALL_ALLOWLIST = verify_release_install.RELEASE_INSTALL_ALLOWLIST
required_operation_report = verify_release_install.required_operation_report
stage_release_install = verify_release_install.stage_release_install


def all_required_operations() -> list[str]:
    return [
        operation
        for operations in REQUIRED_RELEASE_OPERATIONS.values()
        for operation in operations
    ]


def test_default_mcp_test_command_discovers_legacy_and_colocated_suites() -> None:
    package_json = MODULE_PATH.parents[1] / "mcp-server" / "package.json"
    scripts = json.loads(package_json.read_text(encoding="utf-8"))["scripts"]

    assert scripts["test"].split() == ["bun", "test", "tests/", "src/"]


def test_required_operation_report_covers_every_release_capability() -> None:
    report = required_operation_report(all_required_operations() + ["vault.read"])

    assert report["operationCount"] == len(set(all_required_operations() + ["vault.read"]))
    assert set(report["capabilities"]) == {
        "settings",
        "project-context",
        "project-hub",
        "project-migration",
        "workflow",
    }


def test_required_operation_report_rejects_a_stale_bundle() -> None:
    operations = set(all_required_operations())
    operations.remove("settings.snapshot.resolve")
    operations.remove("workflow.agent.leave")

    with pytest.raises(RuntimeError) as exc_info:
        required_operation_report(operations)

    message = str(exc_info.value)
    assert "shipped MCP bundle is missing required operations" in message
    assert "settings.snapshot.resolve" in message
    assert "workflow.agent.leave" in message


def test_stage_release_install_copies_only_the_shipped_allowlist(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    install_root = tmp_path / "install"
    for relative_path in RELEASE_INSTALL_ALLOWLIST:
        source = repo / relative_path
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text(f"release payload: {relative_path.as_posix()}\n", encoding="utf-8")
    repo_dependency = repo / "node_modules" / "repo-only-dependency" / "index.js"
    repo_dependency.parent.mkdir(parents=True)
    repo_dependency.write_text("must not be copied\n", encoding="utf-8")

    server_dir = stage_release_install(repo, install_root)

    installed_files = {
        path.relative_to(install_root)
        for path in install_root.rglob("*")
        if path.is_file()
    }
    assert installed_files == set(RELEASE_INSTALL_ALLOWLIST)
    assert server_dir == install_root / "mcp-server"
    assert not (install_root / "node_modules").exists()


def test_mcp_client_launches_bundle_from_isolated_install_directory(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = tmp_path / "repo"
    install_root = tmp_path / "isolated-install"
    vault = tmp_path / "vault"
    vault.mkdir()
    for relative_path in RELEASE_INSTALL_ALLOWLIST:
        source = repo / relative_path
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text("{}\n", encoding="utf-8")
    (repo / "node_modules").mkdir()
    server_dir = stage_release_install(repo, install_root)
    invocation: dict[str, Any] = {}

    class FakeProcess:
        def __init__(self) -> None:
            self.stdin = io.StringIO()
            self.stdout = io.StringIO('{"jsonrpc":"2.0","id":1,"result":{}}\n')
            self.stderr = io.StringIO()

        def wait(self, timeout: int | None = None) -> int:
            return 0

        def kill(self) -> None:
            raise AssertionError("isolated MCP process should exit cleanly")

    def fake_popen(args: list[str], **kwargs: Any) -> FakeProcess:
        invocation.update({"args": args, **kwargs})
        return FakeProcess()

    monkeypatch.setattr(verify_release_install.subprocess, "Popen", fake_popen)

    compiler_dir = repo / "compiler"
    client = verify_release_install.McpClient(server_dir, vault, compiler_dir)

    assert invocation["args"] == ["node", str(server_dir / "bundle.js")]
    assert invocation["cwd"] == server_dir
    assert repo not in server_dir.parents
    assert not (install_root / "node_modules").exists()
    assert invocation["env"]["VAULT_MIND_VAULT_PATH"] == str(vault)
    assert invocation["env"]["LLMWIKI_COMPILER_PATH"] == str(compiler_dir)
    assert invocation["env"]["VAULT_MIND_PYTHON"] == verify_release_install.sys.executable
    assert client.close() == ""
