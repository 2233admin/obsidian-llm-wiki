#!/usr/bin/env bash
# vault-bg-agent.sh -- PostCompact vault propagation hook
#
# Fires after Claude compacts conversation context.
# Reads session summary from stdin JSON, spawns headless Claude
# to propagate vault-worthy items to E:/knowledge/.
#
# Setup:
#   1. Add PostCompact hook in ~/.claude/settings.json
#   2. chmod +x this file
#
# Logs: /tmp/vault-bg-agent.log

VAULT="E:/knowledge"
[[ ! -d "$VAULT" ]] && exit 0

# Parse compaction summary from stdin JSON
INPUT=$(cat)
SUMMARY=$(printf '%s' "$INPUT" | jq -r '.summary // .content // ""' 2>/dev/null || true)
[[ -z "$SUMMARY" ]] && exit 0

TODAY=$(date +%Y-%m-%d)

PROMPT_FILE=$(mktemp /tmp/vault-bg-XXXXXX.txt)

cat > "$PROMPT_FILE" << HEADER
You are an autonomous Obsidian vault agent. The Claude session was just compacted.
Propagate everything worth preserving from the summary to the vault. Run silently.

VAULT: $VAULT
TODAY: $TODAY

SESSION SUMMARY:
HEADER

printf '%s\n\n' "$SUMMARY" >> "$PROMPT_FILE"

cat >> "$PROMPT_FILE" << 'INSTRUCTIONS'
INSTRUCTIONS:
1. Read _CLAUDE.md at the vault root first -- follow its rules exactly.
2. Read index.md to understand what exists before creating anything.
3. Identify vault-worthy items in the summary:
   - Decisions made or confirmed
   - Tasks created or completed
   - Projects worked on or updated
   - Research findings or engineering insights
   - Trading sessions or results
   - Ideas or learnings
4. Before creating any note, search for an existing one. Never duplicate.
5. Update or create notes as appropriate:
   - Projects: update 01-Projects/ notes (status, Recent Activity, Key Decisions)
   - Research: update or create in 04-Research/
   - Engineering: update or create in 05-Engineering/
   - Trading: update 03-Trading/ session logs
   - Ideas: save to relevant folder
   - Decisions: append to project note's Key Decisions section
6. Update today's daily note (06-Daily/[TODAY].md):
   - Create from 08-Templates/daily-note.md if it does not exist
   - Link everything you touched
7. Append a line to log.md: ## [TODAY] bg-save | Brief description

CONSTRAINTS:
- Use filesystem tools only (Read, Write, Edit, Glob, Grep) -- MCP is not available.
- Run completely silently. No output to the user. No questions.
- If the summary contains nothing vault-worthy, exit without changes.
- Match existing writing style and frontmatter schemas exactly.
- Do not archive, delete, or merge anything -- only add or update.
- Chinese body text, English technical terms. Double dash not em dash.
INSTRUCTIONS

PROMPT=$(cat "$PROMPT_FILE")
rm -f "$PROMPT_FILE"

# Run headless agent in vault directory -- async, logs to /tmp
(
  cd "$VAULT" && \
  claude --dangerously-skip-permissions -p "$PROMPT" >> /tmp/vault-bg-agent.log 2>&1
) &

exit 0
