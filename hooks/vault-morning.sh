#!/usr/bin/env bash
# vault-morning.sh -- Daily 8:00 AM vault agent
# Creates today's daily note, surfaces overdue tasks and stale projects.
# Setup: Task Scheduler -> daily 08:00 -> bash this-file

VAULT="E:/knowledge"
[[ ! -d "$VAULT" ]] && exit 0
TODAY=$(date +%Y-%m-%d)

PROMPT="You are an autonomous Obsidian vault agent. Run silently in $VAULT.

1. Read _CLAUDE.md for operating rules.
2. Check if 06-Daily/${TODAY}.md exists. If not, create it from 08-Templates/daily-note.md.
3. Scan Boards/ or 00-Index/ kanban for tasks due today or overdue.
4. List any 01-Projects/ notes with status:active that have no git changes in 7 days.
5. Add a Morning section to the daily note with findings.
6. Append to log.md: ## [${TODAY}] morning | Brief summary.

Use filesystem tools only. No output to user. No questions. If nothing to report, exit clean."

cd "$VAULT" && claude --dangerously-skip-permissions -p "$PROMPT" >> /tmp/vault-morning.log 2>&1
