#!/usr/bin/env bash
# dogfood-log.sh — append a single usage record to .dogfood.log
#
# Purpose: Track real daily usage of LLM Wiki Bridge so we can see at Week 12
# which features are used 100+ times (keep) vs 0 times (cut).
#
# Usage:
#   dogfood-log.sh <tool> <operation> [note]
#
# Example:
#   dogfood-log.sh vault.search "build context for PR review"
#   dogfood-log.sh recipe.run "gmail ingest daily"
#
# Output format (tab-separated): ISO8601 timestamp | tool | operation | note
#
# The log is git-ignored (.dogfood.log in .gitignore) so every dev has their own.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$REPO_ROOT/.dogfood.log"

tool="${1:-unknown}"
op="${2:-unknown}"
note="${3:-}"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

printf '%s\t%s\t%s\t%s\n' "$ts" "$tool" "$op" "$note" >> "$LOG_FILE"
