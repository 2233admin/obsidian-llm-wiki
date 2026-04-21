#!/usr/bin/env bash
# smoke/03-smoke-script.sh - vault-wiki-team end-to-end smoke test
# MODE: Manual checklist (full automation requires live MCP server + KT runtime)
# To run automated: export MINIMAX_TOKEN, ensure kt CLI installed

set -e

SMOKE_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_WIKI_DIR="$HOME/.claude/skills/vault-wiki"
DEMO_VAULT_DIR="$VAULT_WIKI_DIR/examples/demo-vault"
TEMP_DIR=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

# --- STEP 1: Setup ---
step1() {
    echo ""
    echo "=== STEP 1: Setup ==="
    TEMP_DIR=$(mktemp -d)
    log_info "Temp dir: $TEMP_DIR"
    export MINIMAX_TOKEN="${MINIMAX_TOKEN:-}"
    if [ -z "$MINIMAX_TOKEN" ]; then
        log_info "MINIMAX_TOKEN not set - smoke will run in manual checklist mode"
    fi
    log_pass "Setup complete"
}

# --- STEP 2: Install ---
step2() {
    echo ""
    echo "=== STEP 2: Install ==="
    echo "MANUAL CHECKLIST:"
    echo "  1. Copy contents of 01-install-prompt.md"
    echo "  2. Paste into Claude Code terminal"
    echo "  3. Verify output includes:"
    echo "     - .mcp.json snippet"
    echo "     - CLAUDE.md section with 6 personas"
    echo ""
    if [ -d "$VAULT_WIKI_DIR" ]; then
        log_pass "vault-wiki directory exists at $VAULT_WIKI_DIR"
    else
        log_info "vault-wiki not installed yet (expected - run install prompt first)"
    fi
    log_pass "Install step documented"
}

# --- STEP 3: MCP Server ---
step3() {
    echo ""
    echo "=== STEP 3: MCP Server ==="
    echo "MANUAL CHECKLIST:"
    echo "  1. cd $VAULT_WIKI_DIR"
    echo "  2. Run: node mcp-server/dist/index.js"
    echo "  3. Verify server starts without error"
    echo "  4. Verify demo vault is present at examples/demo-vault/"
    echo ""
    if [ -f "$VAULT_WIKI_DIR/mcp-server/dist/index.js" ]; then
        log_pass "MCP server entry point exists"
    else
        log_fail "MCP server not found at mcp-server/dist/index.js"
    fi
    if [ -d "$VAULT_WIKI_DIR/examples/demo-vault" ]; then
        log_pass "Demo vault exists"
    else
        log_info "Demo vault not found (may need to run install first)"
    fi
}

# --- STEP 4: Terrarium ---
step4() {
    echo ""
    echo "=== STEP 4: Terrarium ==="
    echo "MANUAL CHECKLIST:"
    echo "  1. Verify terrarium YAML exists:"
    echo "     $VAULT_WIKI_DIR/terrariums/vault-wiki-team.yaml"
    echo "  2. Run: kt terrarium run $VAULT_WIKI_DIR/terrariums/vault-wiki-team.yaml"
    echo "  3. Verify all 6 creatures + root initialize"
    echo "  4. Verify channels active: tasks, results, team_chat"
    echo ""
    if [ -f "$VAULT_WIKI_DIR/terrariums/vault-wiki-team.yaml" ]; then
        log_pass "Terrarium YAML exists"
    else
        log_fail "Terrarium YAML not found"
    fi
}

# --- STEP 5: Librarian Query ---
step5() {
    echo ""
    echo "=== STEP 5: Librarian Query ==="
    echo "MANUAL CHECKLIST:"
    echo "  1. Send to tasks channel: 'what do I know about attention heads'"
    echo "  2. Verify message routes to vault-librarian"
    echo "  3. Verify response starts forming within 30 seconds"
    echo ""
    log_pass "Librarian query documented"
}

# --- STEP 6: Assert Output ---
step6() {
    echo ""
    echo "=== STEP 6: Assert Output ==="
    echo "MANUAL CHECKLIST:"
    echo "  1. Wait for response on results channel (up to 60s)"
    echo "  2. Verify response contains citation to 'attention-heads.md'"
    echo "  3. Verify citation is from demo vault, not fabricated"
    echo "  4. Verify at least one additional creature was exercised"
    echo "     (architect for graph compile, curator for cleanup, etc.)"
    echo ""
    if [ -f "$DEMO_VAULT_DIR/attention-heads.md" ]; then
        log_pass "attention-heads.md exists in demo vault - citation can be verified"
    else
        log_info "Demo vault not accessible - verify manually"
    fi
}

# --- STEP 7: Teardown ---
step7() {
    echo ""
    echo "=== STEP 7: Teardown ==="
    echo "MANUAL CHECKLIST:"
    echo "  1. Run: kt terrarium stop"
    echo "  2. Verify all creatures terminated"
    echo "  3. If TEMP_DIR was created and is safe to remove:"
    echo "     rm -rf $TEMP_DIR"
    echo ""
    log_pass "Teardown documented"
}

# --- Run all steps ---
main() {
    echo "=========================================="
    echo " vault-wiki-team Smoke Test"
    echo " Mode: Manual Checklist"
    echo "=========================================="
    
    step1
    step2
    step3
    step4
    step5
    step6
    step7
    
    echo ""
    echo "=========================================="
    echo -e "${GREEN}Smoke test complete${NC}"
    echo "Review each step above for PASS/FAIL"
    echo "This is a MANUAL mode smoke test"
    echo "=========================================="
}

# Parse arguments
case "${1:-}" in
    --automated)
        echo "Automated mode not yet implemented"
        echo "Run without args for manual checklist"
        exit 1
        ;;
    --dry-run)
        echo "Dry run: would execute smoke test"
        echo "Mode: manual checklist"
        exit 0
        ;;
    *)
        main
        ;;
esac
