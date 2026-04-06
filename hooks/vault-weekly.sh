#!/usr/bin/env bash
# vault-weekly.sh -- Friday 6:00 PM vault agent
# Generates weekly review from daily notes, dev logs, and completed tasks.
# Setup: Task Scheduler -> every Friday 18:00 -> bash this-file

VAULT="E:/knowledge"
[[ ! -d "$VAULT" ]] && exit 0
TODAY=$(date +%Y-%m-%d)
WEEK=$(date +%Y-W%V)

PROMPT="You are an autonomous Obsidian vault agent. Run silently in $VAULT.

1. Read _CLAUDE.md for operating rules.
2. Read all daily notes from 06-Daily/ for this week (last 7 days).
3. Read any dev logs or session summaries from the same period.
4. Generate a weekly review note: what was accomplished, decisions made, projects advanced, what to carry forward.
5. Save to 06-Daily/weekly/${WEEK}.md using 08-Templates/weekly-review.md if available.
6. Link the review from today's daily note.
7. Append to log.md: ## [${TODAY}] weekly | Week ${WEEK} review generated.

Use filesystem tools only. No output to user. No questions."

cd "$VAULT" && claude --dangerously-skip-permissions -p "$PROMPT" >> /tmp/vault-weekly.log 2>&1
