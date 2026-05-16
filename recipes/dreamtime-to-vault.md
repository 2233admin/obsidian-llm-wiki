---
id: dreamtime-to-vault
name: Dreamtime-to-Vault
version: 0.1.0
description: Dreamtime session distillation notes -> vault inbox
category: sense
setup_time: 5 min
cost_estimate: "$0 (local files only)"
requires: []
---

# Dreamtime-to-Vault

Routes [dreamtime-open](https://github.com/2233admin/dreamtime) session distillation output
straight into your vault so LLM Wiki Bridge can index it, cite it, and connect it to the
rest of your notes.

This is the clean seam:

- `dreamtime` writes markdown notes after each coding session
- those notes land inside your Obsidian vault
- LLM Wiki Bridge reads them through the normal filesystem adapter
- the notes become searchable, linkable, and eligible for graph analysis

No API keys. No extra transport. Just disciplined file placement.

## What it does

- Uses Dreamtime's existing inbox writer instead of inventing a second collector
- Stores session memory as first-class markdown notes inside the vault
- Makes decisions, gotchas, and build logs queryable via `vault.search`, `vault.read`, and `vault.graph`
- Preserves local-first behavior: both tools operate on files you already own

## Prerequisites

1. `dreamtime-open` installed and working
2. An Obsidian vault already exposed to LLM Wiki Bridge via `VAULT_PATH`
3. `DREAMTIME_INBOX` pointed at a folder inside that vault

## Recommended output location

Point Dreamtime at a bounded inbox subtree, not the vault root:

```bash
export DREAMTIME_INBOX="$VAULT_PATH/00-Inbox/Dreamtime"
```

Suggested structure:

```
{vault}/00-Inbox/Dreamtime/
  2026-05-16-obsidian-llm-wiki.md
  2026-05-16-dreamtime-open.md
```

That keeps session sediment visible but quarantined. Later you can promote anything worth
keeping into topic folders.

## Setup

### Step 1: Install Dreamtime

```bash
pip install dreamtime-open
dreamtime install
```

### Step 2: Point Dreamtime at your vault

Set `DREAMTIME_INBOX` to a folder inside the same vault used by LLM Wiki Bridge:

```bash
export VAULT_PATH="$HOME/my-vault"
export DREAMTIME_INBOX="$VAULT_PATH/00-Inbox/Dreamtime"
```

On Windows PowerShell:

```powershell
$env:VAULT_PATH="$HOME\my-vault"
$env:DREAMTIME_INBOX="$env:VAULT_PATH\00-Inbox\Dreamtime"
```

### Step 3: Let Dreamtime keep writing

Dreamtime already writes notes on session end. No separate collector is required.
Once a note lands under `DREAMTIME_INBOX`, LLM Wiki Bridge can read it on the next query.

### Step 4: Add light structure so graph tools get leverage

Recommended frontmatter/tags convention:

- keep Dreamtime's default `tags: [dreamtime, session-log]`
- include `project: <name>` in frontmatter
- optionally add wikilinks in the body to project notes, ADRs, or people

The last point matters. Raw logs are searchable; linked logs become part of the graph.

## Example prompts

```text
/vault-historian what changed in my thinking about obsidian-llm-wiki this week
```

```text
/vault-librarian find all dreamtime notes mentioning adapter-dreamtime
```

```text
/vault-curator list recurring gotchas across my dreamtime session logs
```

## Operational pattern

Use Dreamtime for session-end distillation.
Use LLM Wiki Bridge for retrieval, cross-linking, and downstream reasoning.

That split is the point:

- Dreamtime compresses ephemeral conversations into markdown
- LLM Wiki Bridge turns markdown into a navigable knowledge surface

## Troubleshooting

**Dreamtime writes notes, but the MCP server cannot see them**: Check that `DREAMTIME_INBOX`
is inside `VAULT_PATH`, not next to it.

**Too much session noise**: Keep Dreamtime writing into `00-Inbox/Dreamtime/` and periodically
promote only durable notes into topic folders.

**Notes search fine but do not connect in graph view**: Add wikilinks from the session logs to
existing project or concept notes. Search works without links; graph leverage does not.

**I want automatic promotion, not just storage**: Start with this file-level integration first.
Only add a higher-order bridge after the note format and review workflow stop thrashing.
