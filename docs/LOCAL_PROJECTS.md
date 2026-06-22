# Local project management

LLMwiki now includes a local Linear-style project management surface under the `project.*` MCP namespace.

This layer is inspired by three Orrery tools:

- `the-orrery/docket`: local-first Markdown issue tracking with Git history.
- `the-orrery/rhizome`: Markdown + frontmatter knowledge contracts, domain trees, and link validation.
- `the-orrery/seed`: repeatable repo/project scaffolding with docs and telemetry conventions.

The public GitHub URLs may show `404` because these repositories are private. LLMwiki's implementation follows the authorized source contracts rather than the earlier public-link assumption.

## What it gives you

```text
local Linear-style issue state
  -> Markdown files under the vault
  -> Kanban board readable by the kanban adapter
  -> comments and dependency edges
  -> query.unified / vault.search visibility
  -> review and promotion through normal LLMwiki workflows
```

## Vault layout

For project `alpha`, `project.init` creates:

```text
10-Projects/alpha/project.md
10-Projects/alpha/docket/board.md
10-Projects/alpha/docket/rhizome.md
10-Projects/alpha/docket/issues/
10-Projects/alpha/docket/comments/
10-Projects/alpha/docket/projects/alpha.md
10-Projects/alpha/docket/docs/INDEX.md
10-Projects/alpha/docket/docs/architecture.md
```

## Docket-compatible issue schema

Issue files live at:

```text
10-Projects/<project>/docket/issues/ISSUE-1.md
```

They use docket-style frontmatter:

```yaml
---
id: ISSUE-1
title: "Build local Linear"
status: Todo
state_type: unstarted
priority: High
project: "alpha"
assignee: "codex"
parent: ~
blocked_by: []
tags: ["docket", "local-linear"]
created_at: "2026-06-21T00:00:00.000Z"
updated_at: "2026-06-21T00:00:00.000Z"
---
```

Status accepts either display names or state types:

| state_type | status |
|---|---|
| `backlog` | `Backlog` |
| `unstarted` | `Todo` |
| `started` | `In Progress` |
| `completed` | `Done` |
| `canceled` | `Canceled` |

Priority values:

```text
Urgent, High, Medium, Low, No priority
```

## Rhizome-compatible project note

`docket/rhizome.md` uses a rhizome-style frontmatter contract:

```yaml
---
description: "Local project rhizome for alpha"
keywords: ["alpha", "docket", "rhizome"]
kind: index
links: []
code: []
---
```

`project.issue.link` appends relationship lines and updates `blocked_by` when the relation is `blocks` or `blocked_by`.

## MCP tools

| Tool | Purpose |
|---|---|
| `project.init` | Seed project docs, docket folders, board, rhizome, and project container. |
| `project.issue.create` | Create `ISSUE-N.md` with docket-compatible frontmatter. |
| `project.issue.list` | List issues filtered by status/state_type or assignee. |
| `project.issue.get` | Read one issue and its Markdown content. |
| `project.issue.update` | Update status, priority, assignee, dependencies, summary, or body. |
| `project.issue.link` | Add issue/note relationships and dependency edges. |
| `project.comment.add` | Append a docket-style comment block under `docket/comments/<id>.md`. |
| `project.board.get` | Read the generated Kanban board. |

## Example flow

```text
project.init project=alpha
project.issue.create project=alpha title="Build local Linear" priority=High status=started
project.comment.add project=alpha id=ISSUE-1 body="Smoke test passed"
project.issue.update project=alpha id=ISSUE-1 status=Done
query.unified query="Build local Linear" adapters=["filesystem", "kanban"]
```

## Boundaries

- This is not a cloud backend and does not run a scheduler.
- The source of truth is Markdown in the vault.
- The Kanban board is generated Markdown and remains readable by Obsidian Kanban.
- Reviewed durable knowledge should still move through `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/`.
