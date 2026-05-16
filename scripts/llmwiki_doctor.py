#!/usr/bin/env python
"""Doctor checks for a collaborative LLMwiki team vault."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from knowledge_health import run as run_knowledge_health
from vault_collab_lint import Finding, load_policy, lint


ROOT = Path(__file__).resolve().parents[1]
MCP_BUNDLE = ROOT / "mcp-server" / "bundle.js"
MCP_DIST = ROOT / "mcp-server" / "dist" / "index.js"


@dataclass
class Check:
    status: str
    code: str
    message: str
    path: str | None = None
    detail: str | None = None


class McpClient:
    def __init__(self, vault: Path, actor: str | None = None, role: str | None = None) -> None:
        server = choose_server()
        env = os.environ.copy()
        env["VAULT_MIND_VAULT_PATH"] = str(vault)
        env.setdefault("VAULT_MIND_ADAPTERS", "filesystem")
        if actor:
            env["VAULT_MIND_ACTOR"] = actor
        if role:
            env["VAULT_MIND_ROLE"] = role
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
                "clientInfo": {"name": "llmwiki-doctor", "version": "0.1"},
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


def choose_server() -> Path:
    return MCP_DIST if MCP_DIST.exists() else MCP_BUNDLE


def add(checks: list[Check], status: str, code: str, message: str, path: str | None = None, detail: str | None = None) -> None:
    checks.append(Check(status, code, message, path, detail))


def check_vault_path(vault: Path, checks: list[Check]) -> bool:
    if not vault.exists():
        add(checks, "error", "vault-missing", "vault path does not exist", str(vault))
        return False
    if not vault.is_dir():
        add(checks, "error", "vault-not-directory", "vault path is not a directory", str(vault))
        return False
    add(checks, "ok", "vault-path", "vault path exists", str(vault))
    return True


def check_policy(vault: Path, checks: list[Check]) -> dict[str, Any] | None:
    policy_path = vault / ".vault-collab.json"
    if not policy_path.exists():
        add(checks, "warn", "policy-missing", ".vault-collab.json is missing; defaults will be used", str(policy_path))
        return load_policy(vault)
    try:
        data = json.loads(policy_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        add(checks, "error", "policy-malformed", ".vault-collab.json is invalid JSON", str(policy_path), str(e))
        return None
    if not isinstance(data, dict):
        add(checks, "error", "policy-not-object", ".vault-collab.json must be a JSON object", str(policy_path))
        return None
    add(checks, "ok", "policy", ".vault-collab.json is readable", str(policy_path))
    return load_policy(vault)


def check_git(vault: Path, checks: list[Check]) -> None:
    if not (vault / ".git").exists():
        add(checks, "warn", "git-missing", "vault is not a Git worktree", str(vault))
        return
    git = shutil.which("git")
    if not git:
        add(checks, "error", "git-unavailable", "git is not available on PATH")
        return
    proc = subprocess.run([git, "-C", str(vault), "status", "--porcelain=v1"], check=False, capture_output=True, text=True, encoding="utf-8")
    if proc.returncode != 0:
        add(checks, "error", "git-status-failed", "git status failed", str(vault), proc.stderr.strip())
        return
    if proc.stdout.strip():
        add(checks, "warn", "git-dirty", "vault worktree has uncommitted changes", str(vault), proc.stdout.strip())
    else:
        add(checks, "ok", "git-clean", "vault Git worktree is clean", str(vault))


def check_runtime(checks: list[Check]) -> None:
    python_version = subprocess.run([sys.executable, "--version"], check=False, capture_output=True, text=True, encoding="utf-8")
    if python_version.returncode == 0:
        add(checks, "ok", "python-available", "python is available", sys.executable, (python_version.stdout or python_version.stderr).strip())
    else:
        add(checks, "error", "python-unusable", "current python could not report its version", sys.executable, (python_version.stdout or python_version.stderr).strip())

    for binary in ["node"]:
        found = shutil.which(binary)
        if not found:
            add(checks, "error", f"{binary}-missing", f"{binary} is not available on PATH")
            continue
        proc = subprocess.run([found, "--version"], check=False, capture_output=True, text=True, encoding="utf-8")
        version = (proc.stdout or proc.stderr).strip()
        if proc.returncode == 0:
            add(checks, "ok", f"{binary}-available", f"{binary} is available", found, version)
        else:
            add(checks, "error", f"{binary}-unusable", f"{binary} exists but could not report its version", found, version)
    if MCP_BUNDLE.exists():
        add(checks, "ok", "mcp-bundle", "MCP bundle exists", str(MCP_BUNDLE))
    else:
        add(checks, "error", "mcp-bundle-missing", "MCP bundle is missing; run npm run rebuild in mcp-server", str(MCP_BUNDLE))


def check_lint(vault: Path, policy: dict[str, Any] | None, checks: list[Check]) -> None:
    if policy is None:
        return
    findings = lint(vault, policy)
    if not findings:
        add(checks, "ok", "vault-lint", "collaboration lint passed")
        return
    for finding in findings:
        status = "error" if finding.severity == "error" else "warn"
        add(checks, status, finding.code, finding.message, finding.path)


def check_knowledge_health(vault: Path, checks: list[Check]) -> None:
    try:
        data = run_knowledge_health(vault)
    except Exception as e:
        add(checks, "error", "knowledge-health-failed", "knowledge health check failed", detail=str(e))
        return
    findings = data.get("findings", [])
    if not findings:
        add(checks, "ok", "knowledge-health", "knowledge health passed")
        return
    for finding in findings:
        if not isinstance(finding, dict):
            continue
        status = "error" if finding.get("severity") == "error" else "warn"
        add(
            checks,
            status,
            str(finding.get("code", "knowledge-health")),
            str(finding.get("message", "knowledge health finding")),
            str(finding.get("path", "")) or None,
        )


def check_codeowners(vault: Path, policy: dict[str, Any] | None, checks: list[Check]) -> None:
    if policy is None:
        return
    protected = policy.get("protected_paths", [])
    if not protected:
        return
    candidates = [
        vault / "CODEOWNERS",
        vault / ".github" / "CODEOWNERS",
        vault / ".gitea" / "CODEOWNERS",
        vault / "CODEOWNERS.example",
    ]
    existing = [path for path in candidates if path.exists()]
    if not existing:
        add(checks, "warn", "codeowners-missing", "protected paths are configured but no CODEOWNERS file was found")
        return
    text = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in existing)
    durable_roots = ["20-Decisions/", "30-Architecture/", "40-Runbooks/"]
    missing = [root for root in durable_roots if root not in text]
    if missing:
        add(checks, "warn", "codeowners-incomplete", "CODEOWNERS does not mention all durable shared roots", detail=", ".join(missing))
    else:
        add(checks, "ok", "codeowners", "CODEOWNERS covers durable shared roots", ", ".join(str(p) for p in existing))


def check_actor_policy(vault: Path, actor: str | None, role: str | None, checks: list[Check]) -> None:
    if not actor:
        return
    if not shutil.which("node"):
        add(checks, "error", "actor-policy-skipped", "node is required to verify MCP actor policy")
        return
    if not choose_server().exists():
        add(checks, "error", "actor-policy-skipped", "MCP server entrypoint is missing")
        return
    try:
        with tempfile.TemporaryDirectory(prefix="llmwiki-doctor-policy-") as td:
            temp_vault = Path(td) / "vault"
            (temp_vault / "00-Inbox" / "AI-Output" / actor).mkdir(parents=True)
            (temp_vault / "00-Inbox" / actor).mkdir(parents=True)
            (temp_vault / "30-Architecture").mkdir(parents=True)
            source_policy = vault / ".vault-collab.json"
            if source_policy.exists():
                shutil.copy2(source_policy, temp_vault / ".vault-collab.json")
            client = McpClient(temp_vault, actor, role)
            try:
                allowed_path = f"00-Inbox/AI-Output/{actor}/doctor-policy-probe.md" if role != "human" else f"00-Inbox/{actor}/doctor-policy-probe.md"
                ok, result = client.call_tool("vault.create", {"path": allowed_path, "content": "# Doctor policy probe\n", "dryRun": False})
                if ok:
                    add(checks, "ok", "actor-allowed-write", "MCP policy allows actor-owned write path", allowed_path)
                else:
                    add(checks, "error", "actor-allowed-write-failed", "MCP policy rejected actor-owned write path", allowed_path, str(result))
                ok, result = client.call_tool("vault.create", {"path": "30-Architecture/doctor-policy-probe.md", "content": "# Block me\n", "dryRun": False})
                if ok:
                    add(checks, "error", "actor-protected-write-allowed", "MCP policy allowed a protected write", "30-Architecture/doctor-policy-probe.md")
                else:
                    add(checks, "ok", "actor-protected-write-blocked", "MCP policy blocks protected writes", "30-Architecture/doctor-policy-probe.md", str(result))
            finally:
                stderr = client.close()
                stderr_lower = stderr.lower()
                if stderr.strip() and any(marker in stderr_lower for marker in ["[warn]", "[error]", "fatal"]):
                    add(checks, "warn", "mcp-stderr", "MCP server wrote to stderr during doctor", detail=stderr.strip()[:2000])
    except Exception as e:
        add(checks, "error", "actor-policy-failed", "MCP actor policy check failed", detail=str(e))


def payload(vault: Path, checks: list[Check]) -> dict[str, Any]:
    return {
        "vault": str(vault),
        "ok": not any(c.status == "error" for c in checks),
        "checks": [c.__dict__ for c in checks],
        "summary": {
            "ok": sum(1 for c in checks if c.status == "ok"),
            "warn": sum(1 for c in checks if c.status == "warn"),
            "error": sum(1 for c in checks if c.status == "error"),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Check a collaborative LLMwiki team vault.")
    parser.add_argument("--vault", required=True, help="Path to the local markdown vault")
    parser.add_argument("--actor", default=None, help="Actor name for optional MCP write-policy verification")
    parser.add_argument("--role", default=None, choices=["agent", "human"], help="Actor role for optional MCP write-policy verification")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    checks: list[Check] = []
    if not check_vault_path(vault, checks):
        data = payload(vault, checks)
        print(json.dumps(data, ensure_ascii=False, indent=2) if args.json else f"ERROR vault-missing {vault}: vault path does not exist")
        return 2

    policy = check_policy(vault, checks)
    check_runtime(checks)
    check_git(vault, checks)
    check_lint(vault, policy, checks)
    check_knowledge_health(vault, checks)
    check_codeowners(vault, policy, checks)
    check_actor_policy(vault, args.actor, args.role, checks)

    data = payload(vault, checks)
    if args.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(f"LLMwiki doctor: {data['summary']['ok']} ok, {data['summary']['warn']} warn, {data['summary']['error']} error")
        for c in checks:
            path = f" {c.path}" if c.path else ""
            detail = f" ({c.detail})" if c.detail else ""
            print(f"{c.status.upper()} {c.code}{path}: {c.message}{detail}")
    if any(c.status == "error" and c.code in {"vault-missing", "vault-not-directory"} for c in checks):
        return 2
    return 1 if any(c.status == "error" for c in checks) else 0


if __name__ == "__main__":
    raise SystemExit(main())
