# Collaboration Demo Vault

Minimal reference vault for Gitea-backed Obsidian collaboration and the LLMwiki research compiler loop.

This directory is an example, not a user vault. Copy the shape, then initialize
your real vault with `scripts/init_collab_vault.py`.

## Research compiler sample

`research-compiler/raw/team-memory-os.md` is a tiny raw source note.
`research-compiler/wiki/summaries/team-memory-os.md` and
`research-compiler/wiki/concepts/team-memory-os.md` show the compiled shape.

Run report-only checks from the repo root:

```bash
python scripts/llmwiki_doctor.py --vault examples/collab-vault --json
python scripts/vault_collab_lint.py --vault examples/collab-vault
python scripts/knowledge_health.py --vault examples/collab-vault
```

AI-generated answers start in `00-Inbox/AI-Output/<agent>/`. Shared team memory
is promoted by review into `20-Decisions/`, `30-Architecture/`, or
`40-Runbooks/`.
