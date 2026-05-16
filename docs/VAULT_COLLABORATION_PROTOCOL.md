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
`scripts/llmwiki_doctor.py` to check the vault. Doctor includes collaboration
lint and knowledge-health reporting. `vault_collab_lint.py` remains the
lower-level collaboration lint used by doctor.

For Git-managed vaults, install the pre-commit hook:

```bash
python scripts/install_vault_git_hook.py --vault /path/to/vault
```

For hosted review, copy one of the CI templates into the vault repository:

```text
docs/templates/github-vault-lint.yml
docs/templates/gitea-vault-lint.yml
docs/templates/CODEOWNERS.example
docs/templates/PULL_REQUEST_TEMPLATE.md
```

For report-only compiler-loop health without the full runtime doctor:

```bash
python scripts/knowledge_health.py --vault /path/to/vault
```

The `.vault-collab.json` policy shape is documented in:

```text
docs/schemas/vault-collab.schema.json
```
