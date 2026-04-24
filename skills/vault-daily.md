---
name: vault-daily
description: >
  Create or update today's daily note -- pulls calendar events, overdue tasks,
  conversation context, and last night's reconcile summary into a single
  entry. Migrated from obsidian-second-brain (eugeniughelbur, MIT) with MCP
  tool references adapted to the vault-mind surface.
---

# /vault-daily

# Requires: vault-mind MCP server

Create or update the daily note for today.

## Steps

1. **Read `_CLAUDE.md`** at vault root (via `vault.exists` + `vault.read`) for folder map, naming conventions, daily-note location override.

2. **Read `CRITICAL_FACTS.md`** (via `vault.exists` + `vault.read`) for timezone and user identity. If absent, default to system timezone and warn once.

3. **Resolve today's daily note path**: default `daily/YYYY-MM-DD.md` (override via `_CLAUDE.md` if present).
   - Use `vault.exists` to check if today's file exists.
   - If not: read `templates/Daily Note.md` via `vault.read`, fill date fields, create via `vault.create`.
   - If yes: inject (do not overwrite) via `vault.modify` or `vault.append`.

4. **Pull calendar events** (if Google Calendar MCP tools available):
   - Fetch today's events using `google_calendar_list_events` or equivalent.
   - Add a `## Calendar` section to the daily note with time, title, attendees for each event.
   - For meetings with known entities: link to `[[Person Name]]` pages (use `vault.search` to verify the person note exists; only link if it does).
   - If calendar tools are not available, skip silently (do not error).

5. **Pull overdue and due-today tasks** from kanban boards:
   - Use `vault.list` with glob `boards/**/*.md` to enumerate boards.
   - Scan for items with date markers `@YYYY-MM-DD` that match today or are past due.
   - Add to daily note's `## Focus` section with priority markers (red = P0, yellow = P1, green = P2).

6. **Scan current conversation** for anything relevant to today:
   - Tasks in progress, people mentioned, decisions made, work topic.
   - Pre-fill or update the note's `## Context` section with that context.

7. **Check `log.md` for last night's sleeptime consolidation**:
   - If the nightly agent ran (see `vault-reconcile` skill + `agent/` scheduler), summarize what it did (reconciled contradictions, synthesized patterns, healed orphans).
   - Add a brief `## Overnight` section so the user knows what changed while they slept.

8. **Report**: return the path of the daily note, plus a one-line summary of what was added (e.g., "3 events, 5 focus tasks, 2 conversation decisions, 1 overnight synthesis").

## Rules

- **All output in user's language** (as declared in `_CLAUDE.md`).
- **No destructive overwrite**: inject sections, never clobber existing content.
- **Frontmatter required**: any new daily note must have `date: YYYY-MM-DD` and `tags: [daily]`.
- **Fallback on missing infra**: `_CLAUDE.md` absent -> use this skill's defaults. Calendar MCP absent -> skip. Template absent -> generate a minimal note with just `# YYYY-MM-DD` heading + empty sections.
- **Idempotent**: running `/vault-daily` twice on the same day updates, never duplicates.

## Related skills

- `vault-reconcile` -- the nightly 5-phase agent whose output this skill summarizes into `## Overnight`.
- `vault-save` -- when a `/vault-daily` invocation produces saveable items (decisions, tasks), defer to `vault-save` instead of inlining.
- `vault-librarian` -- for retrieval-heavy daily prep (e.g., "what did I decide yesterday"), invoke this persona.

## Provenance

Adapted from `obsidian-second-brain/commands/obsidian-daily.md` (upstream: eugeniughelbur/obsidian-second-brain, MIT license). MCP tool references rewritten to use vault-mind MCP surface (`vault.*`) in place of the upstream `mcp-obsidian` surface (`get_file_contents` / `list_files_in_vault` / `write_file`). Google Calendar MCP reference preserved as-is (cross-system dependency).
