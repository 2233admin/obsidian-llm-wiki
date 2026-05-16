#!/usr/bin/env python
"""Lint a collaborative LLMwiki vault for ownership and sync hazards."""
from __future__ import annotations

import argparse
import fnmatch
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


DEFAULT_POLICY = {
    "team": [],
    "agents": ["codex", "claude"],
    "protected_paths": ["20-Decisions/**", "30-Architecture/**", "40-Runbooks/**", "README.md"],
}

CONFLICT_MARKERS = [
    "sync-conflict",
    "conflicted copy",
    "conflict copy",
    " conflicted ",
    ".sync-conflict",
]

POLLUTION_PATTERNS = [
    ".obsidian/workspace*.json",
    ".obsidian/cache/**",
    ".trash/**",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini",
    "*sync-conflict*",
    "*conflicted copy*",
    "*conflict copy*",
    ".vault-mind/**",
    ".vaultbrain/**",
    ".llmwiki-cache/**",
]


@dataclass
class Finding:
    severity: str
    code: str
    path: str
    message: str


def load_policy(vault: Path) -> dict:
    path = vault / ".vault-collab.json"
    if not path.exists():
        return DEFAULT_POLICY
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    merged = dict(DEFAULT_POLICY)
    merged.update(data)
    return merged


def is_markdown(path: Path) -> bool:
    return path.suffix.lower() == ".md"


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def is_protected(rel_path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(rel_path, pattern) for pattern in patterns)


def is_pollution(rel_path: str) -> bool:
    return any(fnmatch.fnmatch(rel_path, pattern) for pattern in POLLUTION_PATTERNS)


def has_generated_frontmatter(path: Path) -> bool:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    head = text[:1000]
    return bool(re.search(r"(?m)^generated-by:\s*(codex|claude|vault-|agent)", head))


def lint(vault: Path, policy: dict) -> list[Finding]:
    findings: list[Finding] = []
    team = set(policy.get("team", []))
    agents = set(policy.get("agents", []))
    protected = list(policy.get("protected_paths", []))

    for path in vault.rglob("*"):
        if ".git" in path.parts:
            continue
        if not path.is_file():
            continue
        rel_path = rel(path, vault)
        lower_name = path.name.lower()

        if any(marker in lower_name for marker in CONFLICT_MARKERS):
            findings.append(Finding("error", "sync-conflict", rel_path, "sync conflict copy must be resolved manually"))

        if is_pollution(rel_path) and not any(marker in lower_name for marker in CONFLICT_MARKERS):
            findings.append(Finding("warn", "local-pollution", rel_path, "local Obsidian/sync/runtime state should not be committed"))

        if is_markdown(path) and rel_path.startswith("00-Inbox/"):
            parts = rel_path.split("/")
            if len(parts) == 2:
                findings.append(Finding("warn", "unowned-inbox-note", rel_path, "put human inbox notes under 00-Inbox/<person>/"))
            elif len(parts) >= 3 and parts[1] == "AI-Output":
                if len(parts) == 3:
                    findings.append(Finding("warn", "unowned-agent-note", rel_path, "put AI output under 00-Inbox/AI-Output/<agent>/"))
                elif agents and parts[2] not in agents:
                    findings.append(Finding("warn", "unknown-agent", rel_path, f"agent '{parts[2]}' is not listed in .vault-collab.json"))
            elif team and parts[1] not in team:
                findings.append(Finding("warn", "unknown-person", rel_path, f"person '{parts[1]}' is not listed in .vault-collab.json"))

        if is_markdown(path) and rel_path.startswith("20-Decisions/"):
            if not re.match(r"^20-Decisions/\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*\.md$", rel_path):
                findings.append(Finding("warn", "decision-name", rel_path, "decision notes should use 20-Decisions/YYYY-MM-DD-title.md"))

        if is_markdown(path) and is_protected(rel_path, protected) and has_generated_frontmatter(path):
            findings.append(Finding("error", "agent-in-protected-path", rel_path, "agent-generated note is in a protected shared path"))

        if is_markdown(path) and "/agents/" in rel_path:
            parts = rel_path.split("/")
            try:
                agent = parts[parts.index("agents") + 1]
            except (ValueError, IndexError):
                agent = ""
            if not agent:
                findings.append(Finding("warn", "missing-agent-owner", rel_path, "project agent notes should live under agents/<agent>/"))
            elif agents and agent not in agents:
                findings.append(Finding("warn", "unknown-project-agent", rel_path, f"agent '{agent}' is not listed in .vault-collab.json"))

    findings.extend(lint_git_pollution(vault))
    return sorted(findings, key=lambda f: (f.severity != "error", f.path, f.code))


def lint_git_pollution(vault: Path) -> list[Finding]:
    if not (vault / ".git").exists():
        return []
    try:
        proc = subprocess.run(
            ["git", "-C", str(vault), "status", "--porcelain=v1", "--untracked-files=all"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except OSError:
        return [Finding("warn", "git-unavailable", ".", "git is unavailable; skipped repository hygiene check")]
    if proc.returncode != 0:
        return [Finding("warn", "git-status-failed", ".", proc.stderr.strip() or "git status failed")]

    findings: list[Finding] = []
    for line in proc.stdout.splitlines():
        if len(line) < 4:
            continue
        status = line[:2]
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        path = path.strip('"').replace("\\", "/")
        if is_pollution(path):
            findings.append(Finding("error", "git-pollution", path, f"git status {status}: local state/conflict file is dirty"))
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Check collaborative vault ownership and sync hygiene.")
    parser.add_argument("--vault", required=True, help="Path to the local markdown vault")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    if not vault.exists():
        raise SystemExit(f"vault path does not exist: {vault}")

    findings = lint(vault, load_policy(vault))
    payload = {
        "vault": str(vault),
        "ok": not any(f.severity == "error" for f in findings),
        "findings": [f.__dict__ for f in findings],
    }
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        if not findings:
            print("OK: no collaboration findings")
        for f in findings:
            print(f"{f.severity.upper()} {f.code} {f.path}: {f.message}")
    return 1 if any(f.severity == "error" for f in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
