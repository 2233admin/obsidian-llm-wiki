---
type: issue
entity: project/obsidian-llm-wiki/issue/host-install-registration-wheel
state: todo
review: reviewed
kind: knowledge-task
id: obsidian-llm-wiki/host-install-registration-wheel
description: No single mechanism writes/verifies host MCP registration -- setup scripts print instructions instead of doing it, and disagree with each other on the env var name
status: active
priority: 2
blocked-by: []
last-verified: 2026-07-12
---

Build one host-install wheel instead of three scripts that print instructions

## Context

Getting vault-mind usable on a fresh machine (this session, 2026-07-12) needed a
manual patch of `~/.claude.json`'s `mcpServers` and a manual paste into
`~/.claude/CLAUDE.md`, because `setup`/`setup.sh`/`setup.ps1` only copy files
and then print a `.mcp.json` snippet + a Vault Roles block for the human (or
agent) to paste by hand. None of the three scripts write host config or verify
the result.

Found while doing this by hand: `setup.sh`'s printed snippet uses
`VAULT_PATH`, but `setup.ps1`'s printed snippet and the real code
(`mcp-server/src/index.ts:95`) both use `VAULT_MIND_VAULT_PATH` -- the two
install scripts disagree with each other on the env var name they tell the
user to set. A real installer that actually wrote the config, instead of
printing a string for a human to retype, cannot drift like this.

Existing doctor scripts (`scripts/llmwiki_doctor.py`,
`scripts/verify_release_install.py`) already verify the MCP server's own
*behavior* (RPC roundtrip against a temp vault) once it's running -- they
assume the host is already registered. There's no check anywhere for whether
the host registration step itself happened or is correct. This is the
missing layer, not a duplicate of what the doctors already do.

This is the same shape of gap as the standing direction to stop collecting
scattered PS1/schtasks-style scripts and fold that class of work into
vault-mind's own obsidian-plugin instead (see the plugin-consolidation
direction already on file) -- host installation is exactly that class of
work, and `obsidian-plugin/` already exists as the consolidation point.

## Acceptance

- One mechanism (extending `obsidian-plugin/`, or a single CLI command --
  the ticket owner decides which, but not a third parallel script) writes
  the host's MCP registration (`.mcp.json` or `~/.claude.json`
  `mcpServers`) and the `CLAUDE.md`/`AGENTS.md` Vault Roles block directly,
  instead of printing them for manual paste.
- The env var name is defined in exactly one place and every script/plugin
  path that mentions it reads from that place -- `setup.sh` and `setup.ps1`
  cannot independently drift again the way they did here.
- A doctor/verify check confirms host registration state itself (is
  vault-mind present in this host's MCP config, pointed at a bundle that
  exists, with the right env var) -- distinct from and in addition to
  `llmwiki_doctor.py`'s existing server-behavior checks.
- No new daemon; this runs at install/doctor time only.
