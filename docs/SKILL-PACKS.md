# Skill Packs

LLMwiki treats external agent skills as Skill Packs: named workflow capability
bundles that can be inventoried, explained, and optionally mirrored into a
project.

Skill Packs are not MCP providers and are not vault content. They are workflow
surfaces that the Agent Layer can use alongside LLMwiki tools. LLMwiki may
index, link, and summarize their durable outputs, but it must not take
ownership of the workflow state that those packs control.

Every known pack should document:

| Field | Meaning |
|---|---|
| `authority` | The workflow or decision surface owned by the pack. |
| `artifacts` | Durable files, configs, or external systems the pack produces or reads. |
| `llmwiki-mode` | What LLMwiki may do with the pack's outputs. |
| `do-not-own` | State LLMwiki must not rewrite or treat as its source of truth. |

## Known Packs

### gstack Workflow Orchestration

Purpose: execution planning, CEO/engineering/design/devex review lanes, QA,
browser dogfooding, shipping, handoff, context save/restore, and workflow
artifacts.

Expected user-level roots:

```text
~/.agents/skills/<skill>/SKILL.md
~/.codex/skills/<skill>/SKILL.md
```

Core capabilities:

```text
gstack
autoplan
plan-ceo-review
plan-design-review
plan-devex-review
plan-eng-review
review
qa
qa-only
ship
land-and-deploy
context-save
context-restore
handoff
investigate
spec
```

Pack contract:

| Field | Value |
|---|---|
| `authority` | Execution plans, reviews, QA, ship/deploy flow, handoffs, and workflow artifacts. |
| `artifacts` | `~/.gstack` plus any project-local gstack artifacts or handoff summaries. |
| `llmwiki-mode` | Index, link, and summarize reviewed gstack outputs. Project Hubs may show current focus, last handoff, open risks, and next action. |
| `do-not-own` | gstack config, execution state, artifact sync, checkpointing, or skill routing decisions. |

LLMwiki must not replace gstack's execution loop. When a Project Hub references
gstack state, it should link to a handoff or artifact summary instead of copying
the full workflow state into the vault.

### Matt Pocock Engineering Discipline

Purpose: engineering workflow discipline for planning, domain modeling, TDD,
triage, issue breakdown, debugging, prototyping, and codebase design.

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

Pack contract:

| Field | Value |
|---|---|
| `authority` | Issue tracker setup, triage label vocabulary, domain docs, TDD, and TypeScript engineering discipline. |
| `artifacts` | `docs/agents/issue-tracker.md`, `docs/agents/triage-labels.md`, `docs/agents/domain.md`, plus the selected issue tracker. |
| `llmwiki-mode` | Read and cite engineering setup docs. If missing, tell the user to run `setup-matt-pocock-skills`. |
| `do-not-own` | Issue tracker choice, triage vocabulary, domain document layout, or TDD workflow rules. |

Global installation is enough for normal use. LLMwiki should invoke these
user-level skills on demand through the agent environment. Project mirroring is
optional and only needed when a project wants a portable vendor copy. If
mirrored, use:

```text
skills/vendor/mattpocock/engineering/<skill>/SKILL.md
```

### LLMwiki Ingest Bridges

Current project-local ingest-oriented skills:

```text
skills/chubbyskills/SKILL.md
skills/x-to-obsidian/SKILL.md
```

Pack contract:

| Field | Value |
|---|---|
| `authority` | Local capture and import workflows that feed markdown evidence into a vault. |
| `artifacts` | Source notes, evidence notes, and bridge-specific helper scripts. |
| `llmwiki-mode` | Own bridge documentation and vault-side evidence records. |
| `do-not-own` | Upstream provider internals, browser session state, or media transcription dependencies. |

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

The inventory reports whether each known pack entry is available from user
roots, mirrored in the project, or missing. User-level installation counts as
available; project mirroring is not required.

The status values are:

```text
missing
user_installed
project_mirrored
installed_and_mirrored
```

## Product Boundary

LLMwiki should:

- inventory Skill Packs;
- explain missing mirrored skills without blocking normal vault search;
- connect Agent Layer workflows to relevant skills;
- invoke user-level installed skills on demand;
- keep skill execution separate from the MCP server core;
- store only human-readable summaries, decisions, links, and reviewed
  promotions in the vault.

LLMwiki should not:

- require gstack or Matt engineering skills for normal vault search;
- treat `npx skills@latest add ...` as the only install path;
- require project-local mirrors before using globally installed skills;
- bundle all external skills into `mcp-server`;
- confuse Skill Packs with Providers such as OPENCLI or MEDIA_TRANSCRIBE;
- rewrite workflow state owned by gstack, Matt skills, issue trackers, or
  project-local engineering docs.
