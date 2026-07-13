# Memory Governance

LLM Wiki is the searchable memory surface for a team vault, not the owner of
every workflow state. In skill-aware environments, workflow packs such as
gstack and Matt Pocock engineering skills already own parts of the development
loop. LLM Wiki must recognize those authority boundaries, then index and cite
their reviewed outputs without replacing them.

## Source of Truth

| Memory layer | Source of truth | LLM Wiki behavior |
|---|---|---|
| Execution plan, review, QA, ship, handoff | gstack | Link and summarize reviewed artifacts; do not rewrite gstack state. |
| Issue tracker, triage labels, domain docs, TDD discipline | Matt Pocock engineering skills | Read `docs/agents/*.md`; prompt setup when missing; do not choose tracker or labels. |
| Repo facts, architecture, risks | Code-Intel outputs and repo files | Cite `.Codex/summary.md`, `.Codex/understanding.md`, `.Codex/hospital.md`, and checked-in docs. |
| Human project map, decisions, retrospectives | Obsidian vault | Keep Project Hubs, Decisions, Playbooks, and Handoffs readable and reviewable. |
| Agent drafts and role outputs | `00-Inbox/AI-Output/<agent>/` | Quarantine until reviewed; never treat draft output as team truth. |
| Durable team truth | `20-Decisions/`, `30-Architecture/`, `40-Runbooks/` | Require human review or hosted review flow before promotion. |

## Actor Model

Use explicit actor names whenever files are written or summarized:

```text
person:<name>       human author or reviewer
agent:<name>        Codex, Claude, gstack lane, or other agent writer
device:<name>       machine where local sync/write happened
project/<slug>      stable logical Project ID (not a repo or path)
skill-pack:<id>     workflow provider such as gstack/workflow
```

When `VAULT_MIND_ACTOR` is set, MCP writes should use that actor and obey the
vault collaboration policy. Writes should append audit entries under
`.wiki-audit/YYYY-MM-DD.jsonl` when the runtime supports it.

## Project Hub Contract

A Project Hub is a human-facing Obsidian note. It stores status summaries and
links, not full workflow state.

Recommended fields:

```yaml
---
llmwiki_type: project_hub
project-id: project/example-project
owner: person:curry
status: active
workspace-health: available
gstack-state: "[[Handoffs/example-project/2026-06-28-current-focus]]"
matt-engineering: "repo:docs/agents/"
code-intel: "repo:.Codex/"
last-reviewed: 2026-06-28
---
```

Body sections:

```text
## Current Focus
Short human-readable summary.

## Links
- gstack handoff or artifact summary
- repo .Codex summary / understanding / hospital
- docs/agents issue tracker / triage labels / domain docs
- reviewed decisions

## Open Risks
Only risks that need human attention.

## Next Action
One current next step or a link to the owning workflow.
```

Project Hubs should not copy complete gstack plans, issue queues, or agent
drafts. They should link to the owning system and summarize only what a human
needs to re-enter the work. They must not persist machine-local workspace paths;
those belong only to `.vault-mind/local-bindings.json`. A Project Hub is a
derived read model and must route mutations to the owning domain operation.

## Skill Pack Adapter Rules

### gstack/workflow

- Authority: execution plans, reviews, QA, ship/deploy flow, handoffs, context
  save/restore, and artifacts.
- LLM Wiki may index gstack plan, review, QA, ship, and handoff summaries after
  they are durable.
- LLM Wiki must not modify `~/.gstack`, gstack config, artifact sync state,
  checkpointing, or skill routing decisions.
- Project Hubs may expose current focus, last handoff, open risks, and next
  action.

### mattpocock/engineering

- Authority: issue tracker setup, triage label vocabulary, domain docs, TDD,
  and engineering discipline.
- LLM Wiki reads `docs/agents/issue-tracker.md`,
  `docs/agents/triage-labels.md`, and `docs/agents/domain.md`.
- If those files are missing, LLM Wiki should tell the user to run
  `setup-matt-pocock-skills`.
- LLM Wiki must not decide the issue tracker, rewrite labels, or override domain
  doc layout.

### Generic Skill Pack Rule

- Installed Skill Packs are workflow providers, not vault content.
- Vault notes store human-readable summaries, decisions, links, and reviewed
  promotions.
- Agent output starts in `00-Inbox/AI-Output/<agent>/`.
- Protected knowledge moves to Decisions, Architecture, or Runbooks only after
  human review or the hosted review process.

## Promotion Path

```text
agent draft -> reviewed summary -> promoted decision/runbook/project hub link
```

- Drafts stay in agent-owned namespaces.
- Reviewed summaries can be linked from Project Hubs.
- Promoted notes become team truth only in protected reviewed locations.
- Conflict copies are merge work, not knowledge. Resolve them manually and
  delete the conflict file.

## Compatibility Checks

Use the Skill Pack inventory before explaining or adapting workflow state:

```bash
node scripts/skills-inventory.mjs --json
```

Expected status values:

```text
missing
user_installed
project_mirrored
installed_and_mirrored
```

Missing gstack or Matt skills must not block normal vault search. It only means
LLM Wiki should avoid claiming those workflow surfaces are available.

## External Workflow Memory Boundary

External repositories and workflow systems are Sources or Skill Packs first; they are not durable memory by themselves. Agents should register the canonical URL or vault path, cite local inspection artifacts from agent-owned drafts, and keep the external runtime's config, checkpointing, and routing state under that runtime's authority.

Claude Code and Codex both follow the same intake ladder:

1. classify Source Input;
2. register supported `url` or `vaultPath` inputs with `source.register`;
3. write unreviewed analysis under `00-Inbox/AI-Output/<agent>/` or `10-Projects/<project>/agents/<agent>/`;
4. create executable obsidian-llm-wiki work under `01-Projects/<project>/issues/`;
5. promote only reviewed summaries into durable team truth.

For the full host-neutral contract, use `docs/AGENT_WORKFLOW_INTEGRATION.md`.

Never treat `10-Projects/<project>/docket/**` as current work state. The docket store is retired; work-OS issue notes under `01-Projects/<project>/issues/` are the source truth.

