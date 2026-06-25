# Skill Packs

LLMwiki treats external agent skills as Skill Packs: named workflow capability bundles that can be inventoried, explained, and optionally mirrored into a project.

Skill Packs are not MCP providers and are not vault content. They are workflow surfaces that an Agent Layer can use alongside LLMwiki tools.

## Known packs

### Matt Pocock engineering discipline

Purpose: engineering workflow discipline for planning, domain modeling, TDD, triage, issue breakdown, debugging, prototyping, and codebase design.

Expected user-level roots:

```text
~/.agents/skills/<skill>/SKILL.md
~/.codex/skills/<skill>/SKILL.md
```

Core skills:

```text
ask-matt
codebase-design
diagnosing-bugs
domain-modeling
grill-with-docs
implement
improve-codebase-architecture
prototype
resolving-merge-conflicts
setup-matt-pocock-skills
tdd
to-issues
to-prd
triage
```

Global installation is enough for normal use. LLMwiki should invoke these user-level skills on demand through the agent environment. Project mirroring is optional and only needed when a project wants a portable vendor copy. If mirrored, use:

```text
skills/vendor/mattpocock/engineering/<skill>/SKILL.md
```

### LLMwiki ingest packs

Current project-local ingest-oriented skills:

```text
skills/chubbyskills/SKILL.md
skills/x-to-obsidian/SKILL.md
```

These are ingest/provider-pack bridges, not engineering discipline skills.

## Inventory

Run:

```bash
node scripts/skills-inventory.mjs
```

JSON output:

```bash
node scripts/skills-inventory.mjs --json
```

The inventory reports whether each known pack entry is available from user roots, mirrored in the project, or missing. User-level installation counts as available; project mirroring is not required.

## Product boundary

LLMwiki should:

- inventory Skill Packs
- explain missing or mirrored skills
- connect Agent Layer workflows to relevant skills
- invoke user-level installed skills on demand
- keep skill execution separate from MCP server core

LLMwiki should not:

- require Matt engineering skills for normal vault search
- treat `npx skills@latest add ...` as the only install path
- require project-local mirrors before using globally installed skills
- bundle all external skills into `mcp-server`
- confuse Skill Packs with Providers such as OPENCLI or MEDIA_TRANSCRIBE
