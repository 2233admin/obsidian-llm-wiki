# Host adapter contract

LLM Wiki is host-neutral. Claude Code, Codex CLI, OpenCode, and Gemini CLI are
adapter surfaces around the same vault contract:

```text
Markdown vault + MCP stdio server + /vault-* skills + reviewable AI-Output
```

## Supported hosts

| Host | Setup flag | Skill install root | Instruction surface | Smoke check |
|---|---|---|---|---|
| Claude Code | `--host claude` / `-VaultHost claude` | `~/.claude/skills` | `CLAUDE.md` or host instructions | `/vault-librarian how many notes are in my vault` |
| Codex CLI | `--host codex` / `-VaultHost codex` | `~/.codex/skills` | `AGENTS.md` or host instructions | `/vault-librarian how many notes are in my vault` |
| OpenCode | `--host opencode` / `-VaultHost opencode` | `~/.config/opencode/skills` | host instructions | `/vault-librarian how many notes are in my vault` |
| Gemini CLI | `--host gemini` / `-VaultHost gemini` | `~/.gemini/skills` | host instructions | `/vault-librarian how many notes are in my vault` |

Each adapter must install the same curated bundle, register the same top-level
skills, and print the same MCP snippet. Host differences should stay in setup
paths and instruction wording, not in vault semantics.

## AI-Output owner names

`vault.writeAIOutput` accepts both role-owned and host-owned output owners:

- role-owned: `vault-architect`, `vault-librarian`, `vault-curator`, ...
- host-owned: `codex`, `claude`, `opencode`, `gemini`

Host-owned output is for session closeouts and agent work records:

```text
00-Inbox/AI-Output/codex/YYYY-MM-DD-fix-release-loop.md
```

Role-owned output is for knowledge role analyses:

```text
00-Inbox/AI-Output/vault-librarian/YYYY-MM-DD-attention-heads.md
```

Both are quarantine drafts. Neither may write durable team truth directly into
`20-Decisions/`, `30-Architecture/`, or `40-Runbooks/`.

## Adding a host

A new host adapter must include:

- setup path mapping for bash and PowerShell
- dry-run output showing the target skills directory
- top-level skill registration for every `skills/vault-*.md`
- `.mcp.json` or equivalent stdio MCP snippet
- first-session prompt example
- smoke proof that `tools/list`, `vault.list`, and `vault.read` work

If the host has no native slash-command support, document the equivalent prompt
that loads the skill by name.
