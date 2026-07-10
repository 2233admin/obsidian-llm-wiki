# Historical Role Prompt Exports

Output of `librarian-author` on MiniMax-M2.7-highspeed via KT.
Built for an early `LLM Wiki Bridge` v2 draft. Kept as historical prompt export material, not current product positioning.

## Roles

| Name | Tagline | Role | Primary MCP tools |
|---|---|---|---|
| vault-librarian | reads, searches, cites from the vault | Answer "what do I know about X" with citations | vault.search, vault.read, vault.list |
| vault-architect | compiles concept graph, suggests refactors | Graph diffs and structural recommendations | vault.graph, vault.backlinks, compile.run |
| vault-curator | finds orphans, dead links, duplicates, stale | Vault health audit -- broken links, orphans, staleness | vault.lint, vault.searchByTag, vault.search |
| vault-teacher | explains a note in context of its neighbors | Concept explanation with graph context | vault.backlinks, vault.read, vault.graph, vault.getMetadata |
| vault-historian | answers "what was I thinking on date X" | Time-window search of notes by mtime and frontmatter | vault.searchByFrontmatter, vault.stat, vault.search |
| vault-janitor | proposes cleanups with dry-run default | Cleanup plan: delete orphans, merge duplicates, fix links | vault.lint, vault.delete (dry), vault.rename (dry) |

## Directory layout

```
.compile/specA-roles/
  skills/                        -- Claude Code slash-command skills (markdown)
    vault-librarian.md
    vault-architect.md
    vault-curator.md
    vault-teacher.md
    vault-historian.md
    vault-janitor.md
  role-configs/                 -- KT role configs (dual-format, unchanged from skills)
    vault-librarian/
      config.yaml
      prompts/system.md
    vault-architect/
      config.yaml
      prompts/system.md
    ... (5 more)
  README.md                     -- this file
```

## MCP tool inventory (all from vault.* namespace)

vault.read, vault.exists, vault.list, vault.stat, vault.create,
vault.modify, vault.append, vault.delete, vault.rename, vault.mkdir,
vault.search, vault.searchByTag, vault.searchByFrontmatter, vault.graph,
vault.backlinks, vault.batch, vault.lint, vault.init, vault.enforceDiscipline,
vault.getMetadata, vault.externalSearch, vault.reindex, compile.status,
compile.run, compile.diff, compile.abort, query.unified, query.search,
query.explain, query.adapters, agent.status, agent.trigger, agent.history,
recipe.list, recipe.show, recipe.status, recipe.doctor, recipe.run

## Config override note

The spec template used `auth_mode: anthropic-key` with env vars
`ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`. The actual historical role configs
use `auth_mode: api-key` + `MINIMAX_API_KEY` + `base_url:
https://api.minimaxi.com/v1` matching the project's domestic adaptation
(commit 6f6c0e9). Swap these fields to switch provider.

## Voice discipline

- Pure ASCII. No emoji in any file.
- Taglines: 4-8 words each, under 12 words.
- All skill files under 150 lines. All prompts/system.md under 80 lines.
- Forbidden prose patterns: avoid filler phrases common in AI marketing copy.
