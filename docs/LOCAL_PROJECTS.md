# Local project management

LLMwiki includes a local Linear-style project management surface under the `project.*` MCP namespace.

The `project.*` tools are a **thin adapter over the work-OS** (the Python compiler's `work_protocol` / `work_driver` / `currency` brain): the single source of truth is the work-OS issue notes, and the MCP layer simply maps tool params to those notes and renders the Kanban board from them. There is **no separate docket store** — the previous `10-Projects/<project>/docket/**` store has been removed.

> **One source of truth.** Issue state lives in `01-Projects/<project>/issues/<slug>.md`. The board is a derived, regenerable view (never a source). The TS board renderer is proven byte-equal to `python kb_meta.py work board` by `mcp-server/src/project/parity.test.ts`.

## What it gives you

```text
work-OS issue notes (state + review + blocked-by)
  -> Markdown files under 01-Projects/<project>/issues/
  -> Obsidian Kanban board rendered on demand (Backlog/Todo/In Progress/Blocked/Done/Canceled)
  -> blocked-by dependency edges (Blocked lane derived, like has_unresolved_blocker)
  -> query.unified / vault.search visibility
  -> review / promotion through the normal work-OS protocol (reviewed vs draft)
```

## Vault layout

For project `alpha`, `project.init` creates only the work-OS anchor and an empty issues folder:

```text
01-Projects/alpha/_project.md      # work-OS project anchor note
01-Projects/alpha/issues/          # one <slug>.md per issue (created by issue.create)
```

No docket folders, no seeded `board.md` — the board is derived on demand from the issue notes.

## Work-OS issue schema

Issue files live at:

```text
01-Projects/<project>/issues/<slug>.md
```

with rhizome-compliant work-OS frontmatter (deterministic key order):

```yaml
---
type: issue
entity: project/alpha/issue/build-local-linear
state: todo            # workflow axis: backlog|todo|in-progress|done|canceled (NEVER 'blocked'; it is derived)
review: reviewed       # review axis: authoritative iff != draft (reviewed or absent); draft = candidate
kind: knowledge-task
id: alpha/build-local-linear   # two lowercase-kebab segments: ^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$
description: Build local Linear   # one line, <=200 chars
status: active         # rhizome lifecycle: active|frozen|archived (SEPARATE from the review axis)
priority: 2            # int 0..4 (1=urgent .. 4=low, 0/absent=none)
blocked-by: [project/alpha/issue/other]   # ENTITY refs, never note-ids/ISSUE-N
assignee: codex
last-verified: 2026-06-27
---

Build local Linear
```

The **body's first non-blank line is the Kanban card label** (defaults to the issue title).

### Workflow axis (`state`)

`state` is normalized through the work-OS `work_state` rules (canonical pass-through plus legacy mapping: `open->todo`, `in progress->in-progress`, `completed/done/closed->done`, `cancelled/canceled/archived->canceled`, `active->in-progress`, `paused->todo`, `planned->backlog`). `issue.create`/`issue.update` also accept these words but always **persist a canonical state**.

| state | board lane |
|---|---|
| `backlog` | Backlog |
| `todo` | Todo |
| `in-progress` | In Progress |
| (derived) | Blocked — a `todo`/`in-progress` item whose `blocked-by` head is not `done` |
| `done` | Done |
| `canceled` | Canceled |

### Priority

`priority` is stored as an int `0..4` (`PRIORITY_RANK = {1:0,2:1,3:2,4:3,0:4}`; missing/none sorts last). For back-compat, `issue.create`/`issue.update` also accept the words `urgent/high/medium/low/none` and map them to `1/2/3/4/0`, but the file always stores the int so board ordering matches the Python renderer.

### Review axis (`review`)

`review` is the authoritative gate, read first and falling back to legacy `status`: `reviewed` (or absent) → authoritative (listed + on the board); `draft` → candidate (excluded). This is separate from the rhizome `status: active|frozen|archived` lifecycle, which lives on the same note.

## Project anchor note

`01-Projects/<project>/_project.md`:

```yaml
---
type: project
entity: project/alpha
kind: knowledge-task
id: alpha/project
description: Work-OS project alpha
status: active
last-verified: 2026-06-27
---
```

The container note is **excluded from board cards** (`board_columns` skips `type: project`).

## Dependencies

`project.issue.link` edits the only persisted edge, `blocked-by` (a list of **entity** refs):

- `blocks` → adds the source entity to the **target's** `blocked-by`.
- `blocked_by` → adds the target entity to the **source's** `blocked-by`.
- `relates` → derive-only in the work-OS (the `related` graph is the symmetric closure of `blocked-by`); nothing is persisted and the tool returns a soft notice.

## MCP tools

| Tool | Purpose |
|---|---|
| `project.init` | Create the work-OS project anchor (`_project.md`) and an empty `issues/` folder. |
| `project.issue.create` | Create `issues/<slug>.md` with work-OS frontmatter (default `state: todo`, `review: reviewed`). |
| `project.issue.list` | List **authoritative** issues (drafts excluded), filterable by `state`/`assignee`. |
| `project.issue.get` | Read one issue (parsed view + raw content) by `slug`. |
| `project.issue.update` | Update `state`/`review`/`priority`/`assignee`/`blocked_by`/`description`/`body`; bumps `last-verified`. |
| `project.issue.link` | Edit `blocked-by` dependency edges (entity refs). |
| `project.comment.add` | Append a comment to a sibling `issues/<slug>.comments.md` (does not affect the board/index). |
| `project.board.get` | Render the work-OS Kanban board (parity with `python kb_meta.py work board`). |

## Example flow

```text
project.init project=alpha
project.issue.create project=alpha title="Build local Linear" priority=2 state=todo
project.comment.add project=alpha slug=build-local-linear body="Smoke test passed"
project.issue.update project=alpha slug=build-local-linear state=done
query.unified query="Build local Linear" adapters=["filesystem", "kanban"]
```

## Boundaries

- This is not a cloud backend and does not run a scheduler.
- The source of truth is the work-OS Markdown notes in the vault.
- The Kanban board is a derived view (regenerable; safe to gitignore) and stays in the obsidian-kanban plugin format.
- The board is rendered **TS-only** — no Python subprocess is invoked by the server.
- Reviewed durable knowledge should still move through `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/`.

## Obsidian visual exports

Use `project.canvas.export` to create `01-Projects/<project>/views/project-map.canvas`. The Canvas contains a project text card, state groups, issue file cards, and `blocks` edges derived from `blocked-by`.

Use `project.base.export` to create `01-Projects/<project>/views/issues.base`. The Base filters to `01-Projects/<project>/issues/` and renders a table of the work-OS frontmatter fields (`entity`, `state`, `review`, `priority`, `assignee`, `blocked-by`, `last-verified`, `id`, `description`).

Both tools default to `dryRun=true`, support `overwrite=true`, and only generate view files. They do not rewrite issue notes or parse user-edited Canvas files.

## Agent Workflow Integration Issues

When an external workflow project requires executable obsidian-llm-wiki work, create or update a work-OS issue under:

```text
01-Projects/<project>/issues/<slug>.md
```

Use this for implementation or validation work such as provider integration, source-registration behavior, host instruction changes, workflow migration, or regression checks. Use Source Notes for durable external inputs, and use agent draft folders for unreviewed analysis.

Claude Code and Codex must not create `10-Projects/<project>/docket/**` for new work. That path is retired even if older skill text still mentions docket. Current project state is the work-OS issue note plus derived board/canvas/base views.

For the shared host workflow contract, see `docs/AGENT_WORKFLOW_INTEGRATION.md`.
