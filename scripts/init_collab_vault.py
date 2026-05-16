#!/usr/bin/env python
"""Initialize a collaborative markdown vault layout for LLMwiki."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


DEFAULT_AGENTS = ["codex", "claude"]
BASE_DIRS = [
    "10-Projects",
    "20-Decisions",
    "30-Architecture",
    "40-Runbooks",
    "90-Archive",
    "people",
]

PROTOCOL = """# Vault Collaboration Protocol

This vault is shared by humans and development agents.

## Boundaries

- LLMwiki reads/writes markdown and enforces collaboration checks.
- Gitea or GitHub reviews durable shared knowledge.
- The sync tool copies files between devices.

## Write Zones

- Human inbox: `00-Inbox/<person>/`
- Agent inbox: `00-Inbox/AI-Output/<agent>/`
- Project agent notes: `10-Projects/<project>/agents/<agent>/`
- Shared decisions: `20-Decisions/YYYY-MM-DD-title.md`
- Durable architecture and runbooks require review before merge.

## Rule

Inbox is cheap. Decisions are reviewed. Architecture is touched with intent.
"""

AGENT_POLICY = """# Agent Write Policy

Agents should write new notes, not overwrite shared source-of-truth docs.

Allowed by default:

- `00-Inbox/AI-Output/<agent>/`
- `10-Projects/<project>/agents/<agent>/`

Protected by default:

- `20-Decisions/`
- `30-Architecture/`
- `40-Runbooks/`
- `README.md`

If an agent needs to change protected knowledge, it writes a proposal note and a human merges it through Gitea or GitHub review.
"""

CONFLICT_RUNBOOK = """# Conflict Resolution

## Detection

Run:

```bash
python scripts/vault_collab_lint.py --vault /path/to/vault
```

## Resolution

1. Find conflict files reported by lint.
2. Compare the conflict file with the canonical file.
3. Merge useful content into the canonical note.
4. Delete the conflict copy.
5. Commit through Gitea or GitHub.

Do not let agents auto-resolve conflicts in shared docs.
"""

GITIGNORE = """# Obsidian local state
.obsidian/workspace*.json
.obsidian/cache/
.obsidian/workspaces.json

# Obsidian trash and OS noise
.trash/
.DS_Store
Thumbs.db
desktop.ini

# Sync conflict copies
*sync-conflict*
*conflicted copy*
*conflict copy*

# LLMwiki local/runtime state
.vault-mind/
.vaultbrain/
.llmwiki-cache/
"""


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def write_if_missing(path: Path, content: str, force: bool) -> bool:
    if path.exists() and not force:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Create collaborative vault directories and policy files.")
    parser.add_argument("--vault", required=True, help="Path to the local markdown vault")
    parser.add_argument("--team", default="", help="Comma-separated human member names, e.g. alice,bob")
    parser.add_argument("--agents", default=",".join(DEFAULT_AGENTS), help="Comma-separated agent names")
    parser.add_argument("--force", action="store_true", help="Overwrite existing generated policy docs")
    args = parser.parse_args()

    vault = Path(args.vault).expanduser().resolve()
    vault.mkdir(parents=True, exist_ok=True)

    team = split_csv(args.team)
    agents = split_csv(args.agents) or DEFAULT_AGENTS
    created: list[str] = []
    skipped: list[str] = []

    directories = list(BASE_DIRS)
    directories.extend(f"00-Inbox/{person}" for person in team)
    directories.extend(f"00-Inbox/AI-Output/{agent}" for agent in agents)

    for rel in sorted(set(directories)):
        target = vault / rel
        target.mkdir(parents=True, exist_ok=True)
        created.append(rel + "/")

    for person in team:
        path = vault / "people" / f"{person}.md"
        body = f"# {person}\n\n- inbox: [[00-Inbox/{person}]]\n"
        if write_if_missing(path, body, args.force):
            created.append(path.relative_to(vault).as_posix())
        else:
            skipped.append(path.relative_to(vault).as_posix())

    docs = {
        "docs/VAULT_COLLABORATION_PROTOCOL.md": PROTOCOL,
        "docs/AGENT_WRITE_POLICY.md": AGENT_POLICY,
        "docs/CONFLICT_RESOLUTION.md": CONFLICT_RUNBOOK,
    }
    for rel, content in docs.items():
        path = vault / rel
        if write_if_missing(path, content, args.force):
            created.append(rel)
        else:
            skipped.append(rel)

    policy = {
        "team": team,
        "agents": agents,
        "human_inbox": "00-Inbox/<person>/",
        "agent_inbox": "00-Inbox/AI-Output/<agent>/",
        "project_agent_notes": "10-Projects/<project>/agents/<agent>/",
        "protected_paths": [
            "20-Decisions/**",
            "30-Architecture/**",
            "40-Runbooks/**",
            "README.md",
        ],
        "decision_pattern": "20-Decisions/YYYY-MM-DD-title.md",
    }
    policy_path = vault / ".vault-collab.json"
    if write_if_missing(policy_path, json.dumps(policy, ensure_ascii=False, indent=2) + "\n", args.force):
        created.append(".vault-collab.json")
    else:
        skipped.append(".vault-collab.json")

    gitignore_path = vault / ".gitignore"
    if write_if_missing(gitignore_path, GITIGNORE, args.force):
        created.append(".gitignore")
    else:
        skipped.append(".gitignore")

    print(json.dumps({"vault": str(vault), "created": created, "skipped": skipped}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
