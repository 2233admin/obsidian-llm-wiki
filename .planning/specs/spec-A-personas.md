# spec-A: 6 Persona Creatures (dual-format)

**Assigned worker:** creature `librarian-author` on MiniMax-M2.7-highspeed via KT
**Budget:** 60 min wall-clock. Reject if exceeds 90 min.
**Dogfood note:** this output will be cited in README as "built using KT terrarium."

## Goal

Produce 6 personas that each run in two hosts unchanged:
1. Claude Code slash-command skill (`~/.claude/skills/vault-wiki/<name>.md`)
2. KohakuTerrarium creature (`skills/creatures/<name>/config.yaml` + `prompts/system.md`)

## Input contract

- Read `/d/projects/obsidian-llm-wiki/.planning/REQUIREMENTS.md` P-01..06
- Read `/d/projects/KohakuTerrarium/kohaku-creatures/creatures/swe/config.yaml` as structural template
- Read `/d/projects/obsidian-llm-wiki/mcp-server/src/index.ts` line 494 (tool list) for MCP method inventory
- Read 1 gstack skill file from `https://github.com/garrytan/gstack/blob/main/skills` for voice reference
- Assume vault exposed via MCP server at `stdio` transport, 39 vault.* tools available

## Output contract

One directory `.compile/specA-personas/` containing:

```
.compile/specA-personas/
  skills/                              # Claude Code skills (markdown)
    vault-librarian.md
    vault-architect.md
    vault-curator.md
    vault-teacher.md
    vault-historian.md
    vault-janitor.md
  creatures/                           # KT creatures
    vault-librarian/
      config.yaml
      prompts/system.md
    vault-architect/
      config.yaml
      prompts/system.md
    ... (repeat for 6)
  README.md                            # 1-page summary: who each persona is + what it does
```

Each persona file (skill OR creature prompt) MUST have:
- **Name + 1-line tagline** matching gstack voice (e.g. "Librarian -- reads, searches, cites.")
- **When to invoke** (2-3 use cases)
- **MCP tools it calls** (explicit list from vault.*)
- **Output format** (always cite source paths)
- **Constraints** (dry-run default for any write; never delete without confirm)

## Voice constraints (reject signals)

- REJECT if any persona uses emoji (gstack-pure-ASCII discipline)
- REJECT if any tagline over 12 words
- REJECT if mentions "cutting-edge" / "revolutionary" / "seamlessly" / "leverage" / "synergy" (AI-slop words)
- REJECT if any skill file exceeds 150 lines
- REJECT if creature config.yaml deviates from `kohaku-creatures/creatures/swe/config.yaml` structure (`name/version/base_config/controller/system_prompt_file`)
- REJECT if MCP tool list references tools NOT in `src/index.ts` switch statement

## Creature config template (literal copy this shape)

```yaml
name: vault-librarian
version: "1.0"
base_config: "@kohaku-creatures/creatures/general"
controller:
  model: MiniMax-M2.7-highspeed
  auth_mode: anthropic-key
  reasoning_effort: "${REASONING:medium}"
  tool_format: native
system_prompt_file: prompts/system.md
```

`auth_mode: anthropic-key` assumes `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` env vars set. If KT doesn't support `anthropic-key` as literal value, use whatever KT exports -- but document the override in `.compile/specA-personas/README.md`.

## Acceptance checklist (worker self-check)

- [ ] 6 x 2 = 12 files in skills/ + creatures/ + 1 README.md (13 total)
- [ ] All tagline < 12 words, ASCII only
- [ ] Every skill references AT LEAST 1 vault.* MCP tool from index.ts
- [ ] Every creature config.yaml has all 5 required fields (name/version/base_config/controller/system_prompt_file)
- [ ] No AI-slop words (ctrl-F: cutting-edge / revolutionary / seamlessly / leverage / synergy / unleash)
- [ ] Each prompts/system.md under 80 lines
- [ ] README.md under 100 lines

## Persona role assignments (fixed, non-negotiable)

| Name | Role (1 line) | Primary MCP tools |
|---|---|---|
| vault-librarian | reads, searches, cites from the vault | vault.search, vault.read, vault.list |
| vault-architect | compiles concept graph, suggests structural refactors | vault.graph, vault.backlinks |
| vault-curator | finds orphans, dead links, duplicates, stale notes | vault.lint, vault.searchByTag |
| vault-teacher | explains a note in context of its neighbors | vault.backlinks, vault.read, vault.graph |
| vault-historian | answers "what was I thinking on date X" | vault.searchByFrontmatter, vault.stat |
| vault-janitor | proposes cleanups with dry-run default | vault.delete (dry), vault.rename (dry) |

## Time/cost

Budget: 60 min. Each persona 5-7 min write + self-check.

## Completion signal

Worker sends to channel `hms_review` a JSON message:
```json
{"spec": "A", "status": "draft", "output_dir": ".compile/specA-personas/", "file_count": 13, "self_check_passed": true}
```
Then idle; await HMS review.
