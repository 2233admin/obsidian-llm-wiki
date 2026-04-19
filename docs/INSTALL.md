# Install guide

## Prerequisites

- Node.js 20 or higher
- Python 3.11 or higher
- Claude Code CLI (or Codex, OpenCode, Gemini CLI)

## Automated install

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki ~/.claude/skills/vault-wiki
cd ~/.claude/skills/vault-wiki
./setup
```

The setup script will:

1. Check that Node, Python, and Claude Code CLI are installed
2. Build the MCP server (`npm install` + `tsc`)
3. Install Python dependencies for the compiler
4. Copy `vault-mind.example.yaml` to `vault-mind.yaml` and prompt for your vault path
5. Register the MCP server to `~/.claude.json` (user scope) with `VAULT_MIND_VAULT_PATH` set
6. Install the `/vault-*` skills into `~/.claude/skills/`

Restart Claude Code after setup so the MCP registration takes effect.

## Manual install (no setup script)

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki
npm install
npm run build
```

Create `vault-mind.yaml` (copy from `vault-mind.example.yaml`) and set your vault path:

```yaml
vault_path: "/absolute/path/to/your/obsidian/vault"
adapters:
  filesystem:
    enabled: true
  obsidian:
    enabled: false
```

Or set the environment variable:

```bash
export VAULT_MIND_VAULT_PATH="/absolute/path/to/your/vault"
```

## Project-scope MCP

Open Claude Code inside this repo. The `.mcp.json` file in the root activates the MCP server automatically using your local `vault-mind.yaml`.

## Verify the install

```bash
python scripts/mcp_smoketest.py
```

This initializes the vault and runs `vault.search`. If you see results, the install is working.

## Uninstall

```bash
rm -rf ~/.claude/skills/vault-wiki
# Remove the MCP registration from ~/.claude.json manually
```

## Troubleshooting

**`vault.search` returns nothing.** Run `python scripts/mcp_smoketest.py` to verify the server is running. Check that `vault-mind.yaml` has the correct `vault_path`.

**Node version error.** The setup script requires Node 20+. Run `node --version` to check. Use `nvm` or `fnm` to upgrade.

**Python import error.** The compiler requires Python 3.11+. Run `python --version` to check. On some systems `python3` is the correct command.

**Obsidian adapter not connecting.** Set `enabled: true` under `adapters.obsidian` in `vault-mind.yaml`. Obsidian must be running with the WebSocket bridge plugin enabled.
