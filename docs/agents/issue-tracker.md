# Agent Issue Tracker

## Source of truth

Agent execution is tracked through the `multica` CLI in native issues on the
`obsidian-llm-wiki` project (`0f8253b3`). Use a new issue, a comment on an
existing issue, or explicitly state in the final reply that the work is not
worth a ticket.

`01-Projects/<project>/issues/<slug>.md` holds LLM Wiki product Work-OS data,
not agent work tickets. `project.mc.sync` is a product adapter; it does not make
those local notes the agent tracker. `10-Projects/<project>/docket/**` is retired.

GitHub and Gitea issues are historical indexes, not new agent work tickets,
unless the user explicitly requests one.

## Issue contract

Read any existing Multica issue and acceptance criteria before implementation.
Record status, verification evidence, blockers, and PR links on that issue or
its parent when available.

If Multica is unavailable, continue already-authorized work using the chat,
commits, and PR as temporary evidence. When it recovers, check for an existing
issue and backfill the issue or comment without duplicating work. Do not use a
local Work-OS note as a fallback agent ticket.

## Triage

Apply the mappings in `docs/agents/triage-labels.md` when triage skills refer
to canonical roles.
