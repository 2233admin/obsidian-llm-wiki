# Team Vault Setup

This guide sets up a shared Obsidian markdown vault backed by Gitea review.

LLMwiki owns write rules. Gitea owns review. Your sync tool owns file copying
between devices. Keep those boundaries separate.

## 1. Create Or Clone The Vault

Create a Gitea repository for the vault, then clone it on each device:

```bash
git clone ssh://git@gitea.example.com/team/team-vault.git
cd team-vault
```

Open that folder as an Obsidian vault. The repository root is the vault root.

## 2. Initialize Collaboration Layout

From the LLMwiki checkout:

```bash
python scripts/init_collab_vault.py --vault /path/to/team-vault --team alice,bob --agents codex,claude
```

This creates inboxes, reviewed shared directories, `.vault-collab.json`, and a
vault `.gitignore`.

## 3. Install The Git Hook

Install the pre-commit hook so local pollution, sync conflicts, and policy
errors do not enter Gitea:

```bash
python scripts/install_vault_git_hook.py --vault /path/to/team-vault
```

For server-side checks, copy the Gitea CI template into the vault repository:

```text
docs/templates/gitea-vault-lint.yml
```

Copy `docs/templates/CODEOWNERS.example` and
`docs/templates/PULL_REQUEST_TEMPLATE.md` if the team wants explicit reviewers.

## 4. Configure MCP For Agents

Codex or Claude should run the MCP server with the vault path and actor
identity:

```bash
VAULT_MIND_VAULT_PATH=/path/to/team-vault
VAULT_MIND_ADAPTERS=filesystem
VAULT_MIND_ACTOR=codex
VAULT_MIND_ROLE=agent
node /path/to/obsidian-llm-wiki/mcp-server/bundle.js
```

Agents can write by default to:

```text
00-Inbox/AI-Output/<agent>/**
10-Projects/*/agents/<agent>/**
```

Protected paths require review:

```text
20-Decisions/**
30-Architecture/**
40-Runbooks/**
README.md
```

## 5. Verify Sync

On device A, write a probe:

```bash
python scripts/mcp_sync_probe.py write --vault /path/to/team-vault
```

Copy the printed `token` and `path`. After your sync tool moves the file to
device B, verify it there:

```bash
python scripts/mcp_sync_probe.py verify --vault /path/to/team-vault --path 00-Inbox/sync-probe-2026-05-16.md --token <token> --wait 60
```

The probe checks markdown sync through `vault.exists`, `vault.read`, and
`vault.search`. It does not replace your sync tool.

## 6. Run Doctor

Check the vault:

```bash
python scripts/llmwiki_doctor.py --vault /path/to/team-vault
```

Check MCP actor write policy without touching the real vault:

```bash
python scripts/llmwiki_doctor.py --vault /path/to/team-vault --actor codex --role agent
```

CI can consume JSON:

```bash
python scripts/llmwiki_doctor.py --vault /path/to/team-vault --json
```

Report knowledge quality separately when you want the raw -> wiki -> query ->
AI-Output -> review loop surfaced without auto-fixing anything:

```bash
python scripts/knowledge_health.py --vault /path/to/team-vault --json
```

`llmwiki_doctor.py` is the standard human, hook, and CI entrypoint.
It also aggregates knowledge health. `knowledge_health.py` can be run directly
for report-only compiler-loop findings. `vault_collab_lint.py` is the
lower-level collaboration lint used by doctor; run it directly only when
debugging lint-specific findings.

Exit codes:

```text
0  all checks passed
1  errors found
2  vault path or environment could not be checked
```

## 7. First Pull Request

1. Human notes start in `00-Inbox/<person>/`.
2. Agent notes start in `00-Inbox/AI-Output/<agent>/` or
   `10-Projects/<project>/agents/<agent>/`.
3. Durable decisions go in `20-Decisions/YYYY-MM-DD-title.md`.
4. Architecture and runbooks are reviewed before merge.
5. Run `python scripts/llmwiki_doctor.py --vault /path/to/team-vault`.
6. Run `python scripts/knowledge_health.py --vault /path/to/team-vault`.
7. Commit, push, and open a Gitea PR.

Use `examples/collab-vault/` as a minimal reference vault, not as a real team
vault.
