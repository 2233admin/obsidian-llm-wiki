#!/usr/bin/env python
"""Verify that an LLMwiki release checkout can serve and enforce a temp vault."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]


class McpClient:
    def __init__(self, repo: Path, vault: Path, actor: str = "codex", role: str = "agent") -> None:
        server = repo / "mcp-server" / "bundle.js"
        env = os.environ.copy()
        env["VAULT_MIND_VAULT_PATH"] = str(vault)
        env["VAULT_MIND_ADAPTERS"] = "filesystem"
        env["VAULT_MIND_ACTOR"] = actor
        env["VAULT_MIND_ROLE"] = role
        self.proc = subprocess.Popen(
            ["node", str(server)],
            cwd=repo,
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
    (vault / ".vault-collab.json").write_text(
        json.dumps({"agents": ["codex"], "protected_paths": ["30-Architecture/**"]}, indent=2) + "\n",
        encoding="utf-8",
    )
    (vault / "README.md").write_text("# Release verify vault\n", encoding="utf-8")
    return vault


def verify(repo: Path) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    bundle = repo / "mcp-server" / "bundle.js"
    sync_probe = repo / "scripts" / "mcp_sync_probe.py"

    run_step(results, "bundle-exists", lambda: str(bundle) if bundle.exists() else (_ for _ in ()).throw(FileNotFoundError(bundle)))
    run_step(results, "node-available", lambda: subprocess.run(["node", "--version"], check=True, capture_output=True, text=True, encoding="utf-8").stdout.strip())
    with tempfile.TemporaryDirectory(prefix="llmwiki-release-") as td:
        temp_root = Path(td)
        vault = make_temp_vault(temp_root)
        client = McpClient(repo, vault)
        try:
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
    parser.add_argument("--repo", default=str(ROOT), help="LLMwiki repo or release checkout path")
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
