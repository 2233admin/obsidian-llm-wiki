# Research Compiler Loop

LLMwiki turns a team's raw research folder into a reviewed, queryable Obsidian wiki. The loop is intentionally small:

```
raw/ -> wiki/ -> query -> 00-Inbox/AI-Output/ -> reviewed/promoted durable knowledge
```

This is not an AI companion workflow. The agent is a compiler/operator in the knowledge pipeline.

## Technical Model

Think of the vault as a small machine with explicit memory and explicit state transitions:

| Layer | What it is | Concrete surface |
|---|---|---|
| Storage | Markdown files on disk. | `raw/`, `wiki/`, `00-Inbox/AI-Output/`, reviewed team paths |
| Instruction surface | The ways work enters the machine. | CLI scripts, MCP tools, `/vault-*` role prompts |
| Compute step | Code or agent work that transforms state. | compiler, search/read tools, doctor, human review |
| Memory state | The current trustedness of knowledge. | raw source, compiled draft, quarantined output, reviewed memory |

The core state transition is:

```
source -> compiled artifact -> cited answer -> quarantined draft -> reviewed durable memory
```

Three invariants keep the system from becoming chat sludge:

- Agents may write drafts, but not durable team truth.
- `00-Inbox/AI-Output/` is quarantine, not memory.
- Durable paths are human-reviewed and versioned through Git/Gitea.

## Vault Layout

```
raw/                              source material: papers, clippings, repo notes, datasets, image notes
wiki/summaries/                   compiled summaries, one per source
wiki/concepts/                    concept pages with source backlinks
wiki/_contradictions.md           unresolved source-claim conflicts
wiki/queries/                     optional query notes and saved search trails
00-Inbox/AI-Output/<agent>/        candidate answers, reports, slides, plots, and investigations
20-Decisions/                     reviewed team decisions
30-Architecture/                  reviewed architecture memory
40-Runbooks/                      reviewed operating procedures
```

For the current compiler CLI, each research topic is a directory with its own `raw/` and `wiki/` subdirectories:

```bash
python compiler/compile.py examples/collab-vault/research-compiler --tier haiku --dry-run
```

The MCP `compile.run` tool follows the same topic model. Keep root-level durable team memory separate from topic compiler outputs.

## Standard Loop

1. Capture source material in `raw/`.
   Use stable filenames and preserve origin metadata in the note body: URL, author, date, repo commit, dataset version, or screenshot context.

2. Compile to `wiki/`.
   Run `compiler/compile.py <vault>/<topic>` or ask the `vault-architect` role to call `compile.run`. The compiler writes summaries, concept pages, and unresolved contradictions.

3. Query the compiled wiki.
   Agents must cite vault paths. A good answer names source notes, reads them with `vault.read`, and separates evidence from inference.

4. File useful outputs to `00-Inbox/AI-Output/<agent>/`.
   Drafts are candidates, not team truth. Use `vault.writeAIOutput` or a normal PR that lands the generated note in the agent-owned inbox.

5. Review and promote.
   Humans read the draft, check citations, and either mark it reviewed, discard it, supersede it, or move the distilled knowledge into `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/`.

6. Run health checks.
   Use doctor/lint for governance and `scripts/knowledge_health.py` for report-only knowledge quality checks.

## AI-Output Lifecycle

`00-Inbox/AI-Output/` is a quarantine layer.

| Marker | Meaning | Next action |
|---|---|---|
| `status: draft` | Agent output exists, not yet trusted. | Review citations and conclusion. |
| `status: reviewed` | Human judged the draft useful and accurate enough to keep. | Link it from a durable note or leave it as a reviewed artifact. |
| `quarantine-state: promoted` | The durable knowledge was moved or rewritten into a team-owned path. | Keep the original as audit trail or mark superseded. |
| `status: stale` | Age/backlink checks say nobody grounded it. | Re-check, archive, or delete manually. |
| `status: superseded` | A newer reviewed output replaced it. | Link to the replacement. |

Agent output never writes directly into `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/`. Those paths are review-ledger territory.

## Knowledge Health

Run report-only checks:

```bash
python scripts/knowledge_health.py --vault examples/collab-vault --json
```

The first-pass health report looks for:

- raw source files with no matching compiled summary
- broken wikilinks
- compiled summaries older than their source file
- orphan concept pages that no non-concept note links to
- unresolved entries in `wiki/_contradictions.md`
- query notes that do not declare filed AI output
- promoted AI outputs without durable backlinks

It does not auto-fix. The point is to surface where the compiler loop is leaking.

## Team Governance

Use the existing collaboration layer:

- `.vault-collab.json` defines team members, agents, and protected paths.
- `scripts/vault_collab_lint.py` reports ownership and sync hazards.
- `scripts/llmwiki_doctor.py` checks runtime, policy, lint, and optional actor write boundaries.
- Gitea/Git PR review is the ledger for shared knowledge.
- CODEOWNERS should cover durable team paths.

The rule is simple: raw can be messy, `wiki/` can be regenerated, `AI-Output/` can be noisy, but durable team memory must be reviewed.
