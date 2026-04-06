#!/usr/bin/env bash
# vault-nightly.sh -- Daily 10:00 PM vault agent
# Closes out the day: saves unsaved items, appends End of Day summary.
# Setup: Task Scheduler -> daily 22:00 -> bash this-file

VAULT="E:/knowledge"
[[ ! -d "$VAULT" ]] && exit 0
TODAY=$(date +%Y-%m-%d)

PROMPT="You are an autonomous Obsidian vault agent. Run silently in $VAULT.

1. Read _CLAUDE.md for operating rules.
2. Read today's daily note 06-Daily/${TODAY}.md.
3. Read the latest JSONL session log from ~/.claude/projects/ to find today's session summaries.
4. Append a ## End of Day section to the daily note with a 3-5 bullet summary.
5. If any completed tasks are in kanban boards, move them to Done column.
6. Append to log.md: ## [${TODAY}] nightly | Brief summary.

Use filesystem tools only. No output to user. No questions. If nothing happened today, exit clean."

cd "$VAULT" && claude --dangerously-skip-permissions -p "$PROMPT" >> /tmp/vault-nightly.log 2>&1
