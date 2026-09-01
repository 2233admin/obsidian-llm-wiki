#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
CLI="$SCRIPT_DIR/mcp-server/setup-cli.js"
MCP_DIR="$SCRIPT_DIR/mcp-server"
if [ ! -f "$CLI" ]; then
  echo "Setup bundle not found; bootstrapping MCP dependencies and rebuilding..." >&2
  if [ ! -d "$MCP_DIR/node_modules" ]; then npm --prefix "$MCP_DIR" ci; fi
  npm --prefix "$MCP_DIR" run rebuild
fi
if [ ! -f "$CLI" ]; then
  echo "Error: setup bundle could not be built at $CLI" >&2
  exit 1
fi

exec node "$CLI" "$@"
