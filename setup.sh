#!/bin/bash
# vault-mind setup.sh -- distribution and installation script
# Compatible with Git Bash on Windows, macOS, and Linux.

set -e

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: bash setup.sh [--help]"
    echo ""
    echo "Installs vault-mind Knowledge OS:"
    echo "  1. Checks Node.js >= 20, Python >= 3.11, Claude Code"
    echo "  2. Builds MCP server (npm install + tsc)"
    echo "  3. Installs compiler Python deps"
    echo "  4. Generates vault-mind.yaml (interactive)"
    echo "  5. Registers MCP server in Claude Code settings"
    echo "  6. Installs skills"
    echo ""
    echo "Idempotent: safe to re-run."
    exit 0
fi

echo "=== vault-mind Setup ==="

# 1. Dependency Check
echo "Checking dependencies..."

check_node() {
    if ! command -v node >/dev/null 2>&1; then
        echo "Error: Node.js is not installed."
        exit 1
    fi
    NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VER" -lt 20 ]; then
        echo "Error: Node.js >= 20 is required (Current: $(node -v))"
        exit 1
    fi
    echo "  [OK] Node.js $(node -v)"
}

check_python() {
    if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
        echo "Error: Python 3 is not installed."
        exit 1
    fi
    PYTHON_CMD="python3"
    if ! command -v python3 >/dev/null 2>&1; then PYTHON_CMD="python"; fi
    PY_VER=$($PYTHON_CMD --version | cut -d' ' -f2)
    PY_MAJOR=$(echo $PY_VER | cut -d'.' -f1)
    PY_MINOR=$(echo $PY_VER | cut -d'.' -f2)
    if [ "$PY_MAJOR" -lt 3 ] || ([ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 11 ]); then
        echo "Error: Python >= 3.11 is required (Current: $PY_VER)"
        exit 1
    fi
    echo "  [OK] Python $PY_VER"
}

check_claude() {
    if ! command -v claude >/dev/null 2>&1; then
        echo "Warning: Claude Code CLI ('claude') not found in PATH."
        echo "MCP registration will be skipped or may fail."
    else
        echo "  [OK] Claude Code CLI found."
    fi
}

check_node
check_python
check_claude

# 2. Build MCP Server
echo "Building MCP server..."
cd mcp-server
npm install --no-audit --no-fund
npm run build
cd ..

# 3. Install Compiler Dependencies
echo "Installing compiler dependencies..."
cd compiler
if [ ! -d "venv" ]; then
    $PYTHON_CMD -m venv venv
fi
# Windows vs Unix venv activation
if [[ -f venv/Scripts/activate ]]; then
    source venv/Scripts/activate
else
    source venv/bin/activate
fi
# Install deps directly (flat-layout modules, not an installable package)
pip install --quiet openai anthropic 2>/dev/null || echo "  [WARN] Optional LLM deps not installed (offline?)"
cd ..

# 4. Configuration
if [ ! -f "vault-mind.yaml" ]; then
    echo "Generating vault-mind.yaml..."
    read -p "Enter your vault path (absolute, e.g. /home/you/vault or D:/notes): " VAULT_PATH
    if [ -z "$VAULT_PATH" ]; then
        echo "Error: vault path required."
        exit 1
    fi
    # Convert \ to / for consistency
    VAULT_PATH=$(echo $VAULT_PATH | sed 's/\\/\//g')
    
    if [ ! -f "vault-mind.example.yaml" ]; then
        echo "Error: vault-mind.example.yaml not found -- corrupt checkout?"
        exit 1
    fi
    cp vault-mind.example.yaml vault-mind.yaml
    # Use python to replace vault_path safely
    $PYTHON_CMD -c "
import sys
content = open('vault-mind.yaml').read()
content = content.replace('/absolute/path/to/your/obsidian/vault', sys.argv[1])
open('vault-mind.yaml', 'w').write(content)
" "$VAULT_PATH"
    echo "  [OK] vault-mind.yaml created."
else
    # Parse vault_path from existing yaml for MCP registration
    VAULT_PATH=$($PYTHON_CMD -c "
for line in open('vault-mind.yaml'):
    if line.strip().startswith('vault_path:'):
        print(line.split(':', 1)[1].strip().strip('\"').strip(\"'\"))
        break
")
    echo "  [SKIP] vault-mind.yaml already exists (vault: $VAULT_PATH)."
fi

# 5. MCP Registration (Claude Code, user scope)
# Claude Code stores user-scope MCP servers in ~/.claude.json (NOT ~/.claude/settings.json).
# Project-scope servers live in <project>/.mcp.json -- that file is already committed and
# activates automatically when Claude Code is opened in this directory.
echo "Registering MCP server in Claude Code user-scope config..."
CLAUDE_JSON="$HOME/.claude.json"
if [ ! -f "$CLAUDE_JSON" ] && [ -n "${USERPROFILE:-}" ]; then
    # Windows fallback when $HOME is not msys-mapped
    CLAUDE_JSON="$USERPROFILE/.claude.json"
fi

if [ -f "$CLAUDE_JSON" ]; then
    PROJECT_ROOT=$(pwd)
    if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
        PROJECT_ROOT=$(cygpath -w "$PROJECT_ROOT" 2>/dev/null || echo "$PROJECT_ROOT")
        # Normalize backslashes for JSON
        PROJECT_ROOT=$(echo "$PROJECT_ROOT" | sed 's|\\|/|g')
    fi

    $PYTHON_CMD -c "
import json, os, shutil, datetime, sys
path = sys.argv[1]
root = sys.argv[2]
vault_path = sys.argv[3]

# Backup before touching
backup = path + '.bak-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
shutil.copy2(path, backup)

with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

mcps = data.setdefault('mcpServers', {})
mcps['vault-mind'] = {
    'type': 'stdio',
    'command': 'node',
    'args': [os.path.join(root, 'mcp-server', 'dist', 'index.js').replace('\\\\', '/')],
    'env': {
        'VAULT_MIND_VAULT_PATH': vault_path,
    },
}

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f'  [OK] Registered vault-mind in {path}')
print(f'  [OK] Backup saved to {os.path.basename(backup)}')
" "$CLAUDE_JSON" "$PROJECT_ROOT" "$VAULT_PATH"
else
    echo "  [WARN] $CLAUDE_JSON not found -- Claude Code may not be installed."
    echo "  [WARN] Project-scope MCP (.mcp.json) is still active when you open this repo in Claude Code."
fi

# 6. Skill Registration
echo "Registering skills..."
SKILLS_DIR="$HOME/.claude/skills"
if [ ! -d "$SKILLS_DIR" ]; then
    SKILLS_DIR="$USERPROFILE/.claude/skills"
fi

VAULT_SKILLS=(vault-save vault-world vault-challenge vault-emerge vault-connect vault-health vault-reconcile)
if [ -d "$(dirname "$SKILLS_DIR")" ]; then
    count=0
    for skill in "${VAULT_SKILLS[@]}"; do
        if [ -f "skills/${skill}.md" ]; then
            mkdir -p "$SKILLS_DIR/${skill}"
            cp "skills/${skill}.md" "$SKILLS_DIR/${skill}/SKILL.md"
            count=$((count + 1))
        fi
    done
    echo "  [OK] Installed $count skills to $SKILLS_DIR"
else
    echo "  [WARN] Could not find Claude Code skills directory."
fi

echo "=== Setup Complete ==="
echo "Restart Claude Code to apply changes."
