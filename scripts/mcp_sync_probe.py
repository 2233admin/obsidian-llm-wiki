#!/usr/bin/env python
"""mcp_sync_probe.py -- two-device vault sync verification over MCP.

This script intentionally verifies the filesystem vault contract only:
LLMwiki reads and writes VAULT_MIND_VAULT_PATH; an external sync layer moves
the markdown files between machines.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DIST_SERVER = ROOT / "mcp-server" / "dist" / "index.js"
BUNDLE_SERVER = ROOT / "mcp-server" / "bundle.js"
DEFAULT_PATH = "00-Inbox/sync-probe-2026-05-16.md"


class McpClient:
    def __init__(self, vault_path: Path, server: Path):
        env = os.environ.copy()
        env["VAULT_MIND_VAULT_PATH"] = str(vault_path)
        # Keep this probe about markdown filesystem sync, not optional adapters.
        env.setdefault("VAULT_MIND_ADAPTERS", "filesystem")

        self.proc = subprocess.Popen(
            ["node", str(server)],
            cwd=ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            bufsize=1,
            env=env,
        )
        self._rid = 0
        self.rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcp-sync-probe", "version": "0.1"},
            },
        )
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

    def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        resp = self.rpc("tools/call", {"name": name, "arguments": arguments})
        if resp.get("error"):
            raise RuntimeError(resp["error"])
        if resp.get("result", {}).get("isError"):
            content = resp["result"].get("content", [])
            text = content[0].get("text") if content else str(resp["result"])
            raise RuntimeError(text)
        content = resp.get("result", {}).get("content", [])
        if content and content[0].get("type") == "text":
            text = content[0]["text"]
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text
        return resp.get("result")

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


def choose_server(explicit: str | None) -> Path:
    if explicit:
        server = Path(explicit).expanduser().resolve()
    elif DIST_SERVER.exists():
        server = DIST_SERVER
    else:
        server = BUNDLE_SERVER
    if not server.exists():
        raise SystemExit(f"server entrypoint not found: {server}. Run the MCP build first.")
    return server


def default_token() -> str:
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    return f"llmwiki-sync-probe-{stamp}"


def probe_content(token: str, rel_path: str) -> str:
    now = dt.datetime.now(dt.UTC).isoformat(timespec="seconds")
    return (
        "---\n"
        "tags: [llmwiki-sync-probe]\n"
        f"created-at: {now}\n"
        f"device: {platform.node() or 'unknown'}\n"
        "---\n\n"
        "# LLMwiki sync probe\n\n"
        f"- token: {token}\n"
        f"- path: {rel_path}\n"
        "- contract: markdown vault sync; no device-local absolute path is stored here.\n"
    )


def write_probe(client: McpClient, rel_path: str, token: str) -> None:
    exists = client.call_tool("vault.exists", {"path": rel_path})
    if exists.get("exists"):
        raise SystemExit(f"probe already exists: {rel_path}. Use a fresh --path or delete the old probe.")
    result = client.call_tool(
        "vault.create",
        {"path": rel_path, "content": probe_content(token, rel_path), "dryRun": False},
    )
    if not result.get("ok"):
        raise RuntimeError(f"vault.create did not report ok: {result}")
    print(json.dumps({"mode": "write", "path": rel_path, "token": token, "result": result}, ensure_ascii=False, indent=2))


def verify_probe(client: McpClient, rel_path: str, token: str, vault_path: Path) -> None:
    exists = client.call_tool("vault.exists", {"path": rel_path})
    if not exists.get("exists"):
        raise SystemExit(f"vault.exists failed for {rel_path}")

    read = client.call_tool("vault.read", {"path": rel_path})
    content = read.get("content", "")
    if token not in content:
        raise SystemExit(f"vault.read did not contain token {token}")

    absolute_vault = str(vault_path.resolve())
    if absolute_vault in content:
        raise SystemExit("probe content contains this device's absolute vault path")

    search = client.call_tool("vault.search", {"query": token, "maxResults": 10})
    results = search.get("results", [])
    if not any(r.get("path") == rel_path for r in results):
        raise SystemExit(f"vault.search did not return {rel_path} for token {token}")

    print(
        json.dumps(
            {
                "mode": "verify",
                "path": rel_path,
                "token": token,
                "exists": exists,
                "readContainsToken": True,
                "searchMatches": [r.get("path") for r in results],
                "devicePathPollution": False,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def wait_for_file(vault_path: Path, rel_path: str, timeout_seconds: int) -> None:
    target = vault_path / Path(rel_path)
    deadline = time.time() + timeout_seconds
    while time.time() <= deadline:
        if target.exists():
            return
        time.sleep(2)
    raise SystemExit(f"timed out waiting for synced file: {target}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify cross-device markdown vault sync through LLMwiki MCP tools.")
    parser.add_argument("mode", choices=["write", "verify"], help="write a probe on this device or verify a synced probe")
    parser.add_argument("--vault", default=os.environ.get("VAULT_MIND_VAULT_PATH"), help="local synced vault path")
    parser.add_argument("--path", default=DEFAULT_PATH, help="vault-relative markdown path for the probe")
    parser.add_argument("--token", default=None, help="unique probe token; required for verify")
    parser.add_argument("--server", default=None, help="MCP server entrypoint; defaults to dist/index.js then bundle.js")
    parser.add_argument("--wait", type=int, default=0, help="seconds to wait for the probe file before verify")
    args = parser.parse_args()

    if not args.vault:
        raise SystemExit("--vault or VAULT_MIND_VAULT_PATH is required")
    vault_path = Path(args.vault).expanduser().resolve()
    if not vault_path.exists():
        raise SystemExit(f"vault path does not exist: {vault_path}")

    token = args.token or default_token()
    if args.mode == "verify" and not args.token:
        raise SystemExit("--token is required in verify mode")
    if args.mode == "verify" and args.wait > 0:
        wait_for_file(vault_path, args.path, args.wait)

    client = McpClient(vault_path, choose_server(args.server))
    try:
        if args.mode == "write":
            write_probe(client, args.path, token)
        else:
            verify_probe(client, args.path, token, vault_path)
    finally:
        stderr = client.close()
        if stderr.strip():
            print("\n--- server stderr ---", file=sys.stderr)
            print(stderr[:2000], file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
