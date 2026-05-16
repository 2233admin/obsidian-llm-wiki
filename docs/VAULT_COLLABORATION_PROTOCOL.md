# Vault Collaboration Protocol

LLMwiki coordinates shared markdown vaults by keeping ownership explicit.

## Responsibility Split

- LLMwiki reads/writes markdown and checks collaboration rules.
- Gitea or GitHub reviews shared source-of-truth changes.
- The sync tool copies files between devices and may create conflict copies.

## Directory Ownership

```text
00-Inbox/<person>/                  human scratch notes
00-Inbox/AI-Output/<agent>/         agent scratch notes
10-Projects/<project>/agents/<agent>/ agent project notes
20-Decisions/YYYY-MM-DD-title.md    reviewed decisions
30-Architecture/                    reviewed architecture
40-Runbooks/                        reviewed operations docs
90-Archive/                         retired notes
people/<person>.md                  member profile and inbox link
```

## Rules

- Agents write new notes by default.
- Agents do not overwrite protected shared docs.
- Durable changes go through Gitea or GitHub review.
- Conflict files are manually merged, then deleted.
- Decisions are append-only notes named by date.
- Obsidian local state and sync conflict copies stay out of Git.

Use `scripts/init_collab_vault.py` to create the structure and
`scripts/vault_collab_lint.py` to check the vault.

For Git-managed vaults, install the pre-commit hook:

```bash
python scripts/install_vault_git_hook.py --vault /path/to/vault
```
