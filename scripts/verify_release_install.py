#!/usr/bin/env python
"""Verify that an LLM Wiki release checkout can serve and enforce a temp vault."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

RELEASE_INSTALL_ALLOWLIST: tuple[Path, ...] = (
    Path("mcp-server/bundle.js"),
    Path("mcp-server/package.json"),
)

REQUIRED_RELEASE_OPERATIONS: dict[str, tuple[str, ...]] = {
    "settings": (
        "settings.definitions.list",
        "settings.snapshot.resolve",
        "settings.doctor",
    ),
    "project-context": ("project.context.resolve",),
    "project-hub": ("project.hub.get",),
    "project-migration": (
        "project.migration.plan",
        "project.migration.apply",
        "project.migration.restore",
    ),
    "workflow": (
        "workflow.agent.join",
        "workflow.agent.checkpoint",
        "workflow.agent.leave",
    ),
}


def required_operation_report(operation_names: list[str] | set[str]) -> dict[str, Any]:
    """Return a stable capability report or fail when the shipped bundle is stale."""
    available = set(operation_names)
    missing = {
        capability: [name for name in required if name not in available]
        for capability, required in REQUIRED_RELEASE_OPERATIONS.items()
    }
    missing = {capability: names for capability, names in missing.items() if names}
    if missing:
        detail = "; ".join(
            f"{capability}: {', '.join(names)}"
            for capability, names in missing.items()
        )
        raise RuntimeError(f"shipped MCP bundle is missing required operations ({detail})")
    return {
        "operationCount": len(available),
        "capabilities": {
            capability: list(required)
            for capability, required in REQUIRED_RELEASE_OPERATIONS.items()
        },
    }


def stage_release_install(repo: Path, install_root: Path) -> Path:
    """Copy only the shipped MCP payload into an isolated install root."""
    for relative_path in RELEASE_INSTALL_ALLOWLIST:
        source = repo / relative_path
        if not source.is_file():
            raise FileNotFoundError(source)
        destination = install_root / relative_path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    return install_root / "mcp-server"


class McpClient:
    def __init__(
        self,
        server_dir: Path,
        vault: Path,
        compiler_dir: Path,
        actor: str = "codex",
        role: str = "agent",
    ) -> None:
        server = server_dir / "bundle.js"
        env = os.environ.copy()
        env["VAULT_MIND_VAULT_PATH"] = str(vault)
        env["VAULT_MIND_ADAPTERS"] = "filesystem"
        env["VAULT_MIND_ACTOR"] = actor
        env["VAULT_MIND_ROLE"] = role
        env["LLMWIKI_COMPILER_PATH"] = str(compiler_dir)
        env["VAULT_MIND_PYTHON"] = sys.executable
        self.proc = subprocess.Popen(
            ["node", str(server)],
            cwd=server_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
            env=env,
        )
        self._rid = 0
        self.rpc("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "verify-release-install", "version": "0.1"}})
        self.notify("notifications/initialized", {})

    def rpc(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._rid += 1
        msg: dict[str, Any] = {"jsonrpc": "2.0", "id": self._rid, "method": method}
        if params is not None:
            msg["params"] = params
        assert self.proc.stdin is not None
        assert self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("MCP server closed stdout before responding")
        return json.loads(line)

    def notify(self, method: str, params: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}) + "\n")
        self.proc.stdin.flush()

    def call_tool(self, name: str, arguments: dict[str, Any]) -> tuple[bool, Any]:
        resp = self.rpc("tools/call", {"name": name, "arguments": arguments})
        content = resp.get("result", {}).get("content", [])
        text = content[0].get("text", "") if content else ""
        parsed: Any = text
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            pass
        return not bool(resp.get("result", {}).get("isError")), parsed

    def list_tools(self) -> list[str]:
        resp = self.rpc("tools/list", {})
        if "error" in resp:
            raise RuntimeError(f"tools/list failed: {resp['error']}")
        tools = resp.get("result", {}).get("tools", [])
        if not isinstance(tools, list):
            raise RuntimeError("tools/list returned a non-list tools payload")
        names = [tool.get("name") for tool in tools if isinstance(tool, dict)]
        if any(not isinstance(name, str) or not name for name in names):
            raise RuntimeError("tools/list returned a tool without a valid name")
        return sorted(set(names))

    def close(self) -> str:
        stderr = ""
        if self.proc.stdin:
            self.proc.stdin.close()
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        if self.proc.stderr:
            stderr = self.proc.stderr.read()
        return stderr


def run_step(results: list[dict[str, Any]], code: str, fn: Any) -> None:
    try:
        detail = fn()
        results.append({"ok": True, "code": code, "detail": detail})
    except Exception as e:
        results.append({"ok": False, "code": code, "detail": str(e)})


def make_temp_vault(root: Path) -> Path:
    vault = root / "vault"
    (vault / "00-Inbox" / "AI-Output" / "codex").mkdir(parents=True)
    (vault / "30-Architecture").mkdir(parents=True)
    (vault / ".vault-mind").mkdir(parents=True)
    (vault / ".vault-collab.json").write_text(
        json.dumps({"agents": ["codex"], "protected_paths": ["30-Architecture/**"]}, indent=2) + "\n",
        encoding="utf-8",
    )
    (vault / "README.md").write_text("# Release verify vault\n", encoding="utf-8")
    (vault / "Projects").mkdir(parents=True)
    (vault / "Projects" / "release-probe.md").write_text(
        "---\n"
        "type: project\n"
        "entity: project/release-probe\n"
        "lifecycle: active\n"
        "aliases:\n"
        "  - release-probe\n"
        "---\n"
        "# Release Probe\n",
        encoding="utf-8",
    )
    project_root = vault / "01-Projects" / "release-probe"
    (project_root / "issues").mkdir(parents=True)
    (project_root / "runs").mkdir(parents=True)
    (project_root / "_project.md").write_text(
        "---\nentity: project/release-probe\ntype: project\n---\n# Release Probe\n",
        encoding="utf-8",
    )
    work_item = "project/release-probe/issue/release-probe"
    work_run = "work-run/release-probe"
    note_id = "01-Projects/release-probe/issues/release-probe.md"
    (vault / note_id).write_text(
        "---\n"
        f"entity: {work_item}\n"
        "type: issue\n"
        "status: active\n"
        "---\n"
        "# Release probe\n",
        encoding="utf-8",
    )
    token = "release-install-local-lease"
    now = int(time.time())
    run = {
        "schema_version": 1,
        "project_id": "project/release-probe",
        "work_item_id": work_item,
        "work_run_id": work_run,
        "agent_id": "codex",
        "state": "leased",
        "output_class": "view",
        "approval_status": "not-required",
        "created_at": now,
        "updated_at": now,
        "provenance": [f"work-item:{work_item}"],
        "transitions": [{
            "transition_token": "driver:lease:release-probe",
            "from": "planned",
            "to": "leased",
            "recorded_at": now,
        }],
        "handoff_token_hash": hashlib.sha256(token.encode("utf-8")).hexdigest(),
        "handoff_expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + 600)),
    }
    (project_root / "runs" / "release-probe.json").write_text(
        json.dumps(run, indent=2) + "\n", encoding="utf-8")
    (vault / ".vault-mind" / "_leases.json").write_text(
        json.dumps({
            note_id: {
                "agent_id": "codex",
                "base_head": note_id,
                "acquired_at": now,
                "expires_at": now + 600,
                "project_id": "project/release-probe",
                "work_item_id": work_item,
                "work_run_id": work_run,
                "handoff_token": token,
            },
        }, indent=2) + "\n",
        encoding="utf-8",
    )
    return vault


def require_tool(client: McpClient, name: str, arguments: dict[str, Any]) -> Any:
    ok, result = client.call_tool(name, arguments)
    if not ok:
        raise RuntimeError(f"{name} failed: {result}")
    return result


def verify(repo: Path) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    bundle = repo / "mcp-server" / "bundle.js"
    compiler_dir = repo / "compiler"
    sync_probe = repo / "scripts" / "mcp_sync_probe.py"

    run_step(results, "bundle-exists", lambda: str(bundle) if bundle.exists() else (_ for _ in ()).throw(FileNotFoundError(bundle)))
    run_step(results, "compiler-exists", lambda: str(compiler_dir) if (compiler_dir / "kb_meta.py").exists() else (_ for _ in ()).throw(FileNotFoundError(compiler_dir / "kb_meta.py")))
    run_step(results, "node-available", lambda: subprocess.run(["node", "--version"], check=True, capture_output=True, text=True, encoding="utf-8").stdout.strip())
    with tempfile.TemporaryDirectory(prefix="llmwiki-release-") as td:
        temp_root = Path(td)
        install_root = temp_root / "install"
        vault = make_temp_vault(temp_root)
        server_dir = stage_release_install(repo, install_root)
        client = McpClient(server_dir, vault, compiler_dir)
        try:
            run_step(
                results,
                "shipped-operation-inventory",
                lambda: required_operation_report(client.list_tools()),
            )

            def mcp_roundtrip() -> dict[str, Any]:
                ok, created = client.call_tool("vault.create", {"path": "00-Inbox/AI-Output/codex/release-probe.md", "content": "release-probe-token\n", "dryRun": False})
                if not ok:
                    raise RuntimeError(created)
                ok, exists = client.call_tool("vault.exists", {"path": "00-Inbox/AI-Output/codex/release-probe.md"})
                if not ok or not exists.get("exists"):
                    raise RuntimeError(f"exists failed: {exists}")
                ok, read = client.call_tool("vault.read", {"path": "00-Inbox/AI-Output/codex/release-probe.md"})
                if not ok or "release-probe-token" not in read.get("content", ""):
                    raise RuntimeError(f"read failed: {read}")
                ok, search = client.call_tool("vault.search", {"query": "release-probe-token", "maxResults": 5})
                if not ok or not search.get("results"):
                    raise RuntimeError(f"search failed: {search}")
                return {"created": created, "searchMatches": len(search.get("results", []))}

            run_step(results, "mcp-read-write-search", mcp_roundtrip)

            def platform_roundtrip() -> dict[str, Any]:
                definitions = require_tool(client, "settings.definitions.list", {})
                snapshot = require_tool(client, "settings.snapshot.resolve", {})
                doctor = require_tool(client, "settings.doctor", {})
                context = require_tool(client, "project.context.resolve", {"ref": "project/release-probe"})
                hub = require_tool(client, "project.hub.get", {"ref": "project/release-probe"})
                migration = require_tool(client, "project.migration.plan", {})
                return {
                    "definitions": len(definitions.get("definitions", [])),
                    "snapshotId": snapshot.get("snapshot", {}).get("snapshotId"),
                    "doctorCapabilities": len(doctor.get("capabilities", [])),
                    "projectId": context.get("projectId"),
                    "hubSections": sorted(hub.get("sections", {})),
                    "migrationPlan": bool(migration),
                }

            run_step(results, "settings-project-migration-roundtrip", platform_roundtrip)

            def workflow_roundtrip() -> dict[str, Any]:
                identity = {
                    "project": "project/release-probe",
                    "agent": "codex",
                    "work_run_id": "work-run/release-probe",
                    "work_item_id": "project/release-probe/issue/release-probe",
                    "dryRun": False,
                }
                joined = require_tool(client, "workflow.agent.join", {
                    **identity,
                    "transition_token": "release:join",
                    "objective": "Verify the shipped workflow surface",
                    "provenance": ["release-install-smoke"],
                })
                checkpoint = require_tool(client, "workflow.agent.checkpoint", {
                    **identity,
                    "transition_token": "release:checkpoint",
                    "summary": "Shipped workflow checkpoint succeeded",
                    "evidence": ["release-install-smoke"],
                })
                left = require_tool(client, "workflow.agent.leave", {
                    **identity,
                    "transition_token": "release:leave",
                    "summary": "Shipped workflow leave succeeded",
                    "work_run_state": "cancelled",
                })
                serialized = json.dumps([joined, checkpoint, left])
                if "release-install-local-lease" in serialized:
                    raise RuntimeError("workflow response leaked local lease capability")
                return {
                    "joined": joined.get("workRunId"),
                    "checkpointState": checkpoint.get("workRunState"),
                    "leaveState": left.get("lifetime", {}).get("workRunState"),
                }

            run_step(results, "workflow-roundtrip", workflow_roundtrip)

            def policy_blocks() -> str:
                ok, result = client.call_tool("vault.create", {"path": "30-Architecture/blocked.md", "content": "no\n", "dryRun": False})
                if ok:
                    raise RuntimeError(f"protected write unexpectedly succeeded: {result}")
                return str(result)

            run_step(results, "collaboration-policy", policy_blocks)
        finally:
            stderr = client.close()
            if stderr.strip():
                results.append({"ok": True, "code": "mcp-stderr", "detail": stderr.strip()[:2000]})

        def sync_probe_verify() -> str:
            token = "release-probe-token"
            probe_path = "00-Inbox/AI-Output/codex/release-probe.md"
            proc = subprocess.run(
                [sys.executable, str(sync_probe), "verify", "--vault", str(vault), "--path", probe_path, "--token", token],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            if proc.returncode == 0:
                return proc.stdout.strip()
            if "did not contain token" in proc.stderr + proc.stdout:
                return "sync probe executable reached vault and failed on expected token mismatch"
            raise RuntimeError((proc.stderr or proc.stdout).strip())

        run_step(results, "sync-probe-script", lambda: str(sync_probe) if sync_probe.exists() else (_ for _ in ()).throw(FileNotFoundError(sync_probe)))
        run_step(results, "sync-probe-executable", sync_probe_verify)

    return {"repo": str(repo), "ok": all(r["ok"] for r in results), "results": results}


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify a release/source checkout without touching a user vault.")
    parser.add_argument("--repo", default=str(ROOT), help="LLM Wiki repo or release checkout path")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    data = verify(repo)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"Release install verify: {'ok' if data['ok'] else 'failed'}")
        for item in data["results"]:
            status = "OK" if item["ok"] else "ERROR"
            print(f"{status} {item['code']}: {item['detail']}")
    return 0 if data["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
