# Agent Write Policy

Development agents should be useful without becoming unreviewed editors of the
team memory.

## Default Allowed Paths

```text
00-Inbox/AI-Output/<agent>/**
10-Projects/*/agents/<agent>/**
```

## Protected Paths

```text
20-Decisions/**
30-Architecture/**
40-Runbooks/**
README.md
```

For protected knowledge, the agent writes a proposal note in its own namespace.
A human reviews and merges the durable change through Gitea or GitHub.

## Policy File

`scripts/init_collab_vault.py` writes `.vault-collab.json` into the vault. The
lint script uses it to know team members, agent names, and protected paths.

When `VAULT_MIND_ACTOR` is set, the MCP server enforces the same policy before
real writes. Example:

```bash
VAULT_MIND_ACTOR=codex VAULT_MIND_ROLE=agent
```

Successful real writes are appended to `.wiki-audit/YYYY-MM-DD.jsonl` so the
team can trace which actor wrote which vault path.
