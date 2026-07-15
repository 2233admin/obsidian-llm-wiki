from __future__ import annotations

import io
import importlib.util
import json
import subprocess
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
assert_package_entrypoints = verify_release_install.assert_package_entrypoints
smoke_agent_domain_cli = verify_release_install.smoke_agent_domain_cli
smoke_memu_query_cli = verify_release_install.smoke_memu_query_cli
smoke_usage_cli = verify_release_install.smoke_usage_cli
assert_runtime_version = verify_release_install.assert_runtime_version


def all_required_operations() -> list[str]:
    return [
        operation
        for operations in REQUIRED_RELEASE_OPERATIONS.values()
        for operation in operations
    ]


def test_default_mcp_test_command_discovers_legacy_and_colocated_suites() -> None:
    package_json = MODULE_PATH.parents[1] / "mcp-server" / "package.json"
    package = json.loads(package_json.read_text(encoding="utf-8"))
    scripts = package["scripts"]

    assert scripts["test"].split() == ["bun", "test", "tests/", "src/"]
    assert package["bin"]["llmwiki-agent"] == "agent-domain-cli.js"
    assert package["bin"]["memu-query"] == "memu-query.js"
    assert package["bin"]["llmwiki-usage"] == "usage-cli.js"
    assert "types" not in package
    assert {"agent-domain-cli.js", "memu-query.js", "usage-cli.js"} <= set(package["files"])
    assert scripts["verify:bundle"].endswith("node scripts/verify-bundles.mjs")
    assert "git status" not in scripts["verify:bundle"]
    verifier = (MODULE_PATH.parents[1] / "mcp-server" / "scripts" / "verify-bundles.mjs").read_text(encoding="utf-8")
    assert "--untracked-files=all" in verifier
    assert all(name in verifier for name in ("bundle.js", "agent-domain-cli.js", "memu-query.js", "usage-cli.js"))


def test_release_workflows_package_and_verify_every_production_bundle() -> None:
    repo = MODULE_PATH.parents[1]
    ci = (repo / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    release = (repo / ".github" / "workflows" / "release.yml").read_text(
        encoding="utf-8"
    )

    assert "npm run verify:bundle-boundary" in ci
    assert "npm run verify:bundle-boundary" in release
    assert "cd mcp-server && node scripts/verify-bundles.mjs" in release
    assert (
        "-C mcp-server bundle.js agent-domain-cli.js memu-query.js "
        "usage-cli.js package.json -C .. LICENSE"
    ) in release
    assert "bundle.js agent-domain-cli.js package.json dist" not in release
    assert Path("mcp-server/agent-domain-cli.js") in RELEASE_INSTALL_ALLOWLIST
    assert Path("mcp-server/memu-query.js") in RELEASE_INSTALL_ALLOWLIST
    assert Path("mcp-server/usage-cli.js") in RELEASE_INSTALL_ALLOWLIST


def test_required_operation_report_covers_every_release_capability() -> None:
    report = required_operation_report(all_required_operations() + ["vault.read"])

    assert report["operationCount"] == len(set(all_required_operations() + ["vault.read"]))
    assert set(report["capabilities"]) == {
        "settings",
        "project-context",
        "project-hub",
        "project-migration",
        "workflow",
        "agent-domain",
        "agent-room-context",
        "dreamtime",
        "consult",
        "delegation",
        "usage",
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


def test_runtime_version_must_match_package_metadata() -> None:
    assert assert_runtime_version(
        "obsidian-llm-wiki: MCP server running (stdio, v0.4.0-beta.1, adapters: filesystem)",
        "0.4.0-beta.1",
    ) == "0.4.0-beta.1"

    with pytest.raises(RuntimeError, match="does not match package.json"):
        assert_runtime_version(
            "obsidian-llm-wiki: MCP server running (stdio, v0.3.0, adapters: filesystem)",
            "0.4.0-beta.1",
        )


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


def test_package_manifest_entrypoints_close_over_the_release_allowlist(tmp_path: Path) -> None:
    server_dir = tmp_path / "mcp-server"
    server_dir.mkdir()
    package = {
        "main": "bundle.js",
        "bin": {"agent": "agent-domain-cli.js", "usage": "usage-cli.js"},
    }
    (server_dir / "package.json").write_text(json.dumps(package), encoding="utf-8")
    for name in ("bundle.js", "agent-domain-cli.js", "usage-cli.js"):
        (server_dir / name).write_text("// bundle\n", encoding="utf-8")

    assert set(assert_package_entrypoints(server_dir)) == {"main", "bin:agent", "bin:usage"}
    (server_dir / "usage-cli.js").unlink()
    with pytest.raises(RuntimeError, match="missing release files"):
        assert_package_entrypoints(server_dir)


def test_agent_domain_cli_smoke_uses_only_the_isolated_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server_dir = tmp_path / "isolated-install" / "mcp-server"
    vault = tmp_path / "vault"
    server_dir.mkdir(parents=True)
    vault.mkdir()
    cli = server_dir / "agent-domain-cli.js"
    cli.write_text("// bundled CLI\n", encoding="utf-8")
    invocation: dict[str, Any] = {}

    def fake_run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        invocation.update({"args": args, **kwargs})
        return subprocess.CompletedProcess(
            args,
            1,
            stdout="",
            stderr=json.dumps({"code": -32602, "message": "--project is required"}),
        )

    monkeypatch.setattr(verify_release_install.subprocess, "run", fake_run)

    report = smoke_agent_domain_cli(server_dir, vault)

    assert invocation["args"] == [
        "node",
        str(cli),
        "room",
        "--vault",
        str(vault),
    ]
    assert invocation["cwd"] == server_dir
    assert invocation["check"] is False
    assert report["entrypoint"] == "agent-domain-cli.js"
    assert report["contractError"]["code"] == -32602


def test_memu_query_cli_smoke_uses_only_the_isolated_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server_dir = tmp_path / "isolated-install" / "mcp-server"
    server_dir.mkdir(parents=True)
    cli = server_dir / "memu-query.js"
    cli.write_text("// bundled CLI\n", encoding="utf-8")
    invocation: dict[str, Any] = {}

    def fake_run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        invocation.update({"args": args, **kwargs})
        return subprocess.CompletedProcess(args, 0, stdout="Usage: memu-query <query>\n", stderr="")

    monkeypatch.setattr(verify_release_install.subprocess, "run", fake_run)
    report = smoke_memu_query_cli(server_dir)

    assert invocation["args"] == ["node", str(cli), "--help"]
    assert invocation["cwd"] == server_dir
    assert report["entrypoint"] == "memu-query.js"


def test_usage_cli_smoke_uses_only_the_isolated_bundle(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    server_dir = tmp_path / "isolated-install" / "mcp-server"
    server_dir.mkdir(parents=True)
    cli = server_dir / "usage-cli.js"
    cli.write_text("// bundled CLI\n", encoding="utf-8")
    invocation: dict[str, Any] = {}
    contract = {"code": -32602, "message": "Usage command must be append, project, or policy"}

    def fake_run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
        invocation.update({"args": args, **kwargs})
        return subprocess.CompletedProcess(args, 1, stdout="", stderr=json.dumps(contract))

    monkeypatch.setattr(verify_release_install.subprocess, "run", fake_run)
    report = smoke_usage_cli(server_dir)

    assert invocation["args"] == ["node", str(cli)]
    assert invocation["cwd"] == server_dir
    assert report["entrypoint"] == "usage-cli.js"
    assert report["contractError"] == contract


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
