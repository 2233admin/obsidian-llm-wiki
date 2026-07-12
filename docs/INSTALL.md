# Install Guide

## Claude Code Plugin

Most Claude Code users should install LLMwiki as a plugin:

```text
/plugin marketplace add 2233admin/obsidian-llm-wiki
/plugin install llmwiki@obsidian-llm-wiki
```

The plugin ships the MCP server, bundled skills, and Canvas diagram support. Start Claude Code inside your vault, or set `VAULT_MIND_VAULT_PATH` to an absolute vault path.

## Setup For Other Hosts

Use `setup` for Codex, OpenCode, Gemini, or legacy-compatible local installs:

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git ~/obsidian-llm-wiki-src
cd ~/obsidian-llm-wiki-src
bash ./setup --host codex
```

Windows PowerShell:

```powershell
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git "$HOME\obsidian-llm-wiki-src"
cd "$HOME\obsidian-llm-wiki-src"
.\setup.ps1 -VaultHost codex
```

Supported hosts:

```bash
bash ./setup --host claude
bash ./setup --host codex
bash ./setup --host opencode
bash ./setup --host gemini
```

Preview without writing:

```bash
bash ./setup --host codex --dry-run
```

```powershell
.\setup.ps1 -VaultHost codex -DryRun
```

The setup path installs into the legacy-compatible `vault-wiki` skill directory, for example `~/.codex/skills/vault-wiki`. It copies `skills/`, `examples/`, `docs/`, `viewer/`, `archify/`, `README.md`, `LICENSE`, and `mcp-server/{bundle.js,package.json}`.

## MCP Config

The setup script prints an MCP config snippet using the compatibility server name `vault-mind`:

```json
{
  "mcpServers": {
    "vault-mind": {
      "command": "node",
      "args": ["/absolute/path/to/vault-wiki/mcp-server/bundle.js"],
      "env": {
        "VAULT_MIND_VAULT_PATH": "/absolute/path/to/your/vault"
      }
    }
  }
}
```

`VAULT_MIND_VAULT_PATH` can point to an Obsidian vault or any Markdown directory. Restart the agent host after changing MCP config.

## Manual Install

Manual commands below mirror `packaging/llmwiki-distribution.json`. Run `node scripts/check-distribution.mjs` after changing install assets, plugin metadata, or release packaging.

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki
HOST_DIR="$HOME/.codex/skills/vault-wiki"
mkdir -p "$HOST_DIR/mcp-server"
cp -r skills examples docs viewer archify "$HOST_DIR/"
cp README.md LICENSE "$HOST_DIR/"
cp mcp-server/bundle.js mcp-server/package.json "$HOST_DIR/mcp-server/"
```

Then add the MCP config shown above, replacing the bundle and vault paths.

## Optional Skills

Setup registers top-level skills when the host supports installed skills:

- `chubbyskills`: plan safe local capture/transcription packs that feed LLMwiki.
- `x-to-obsidian`: save high-signal X/Twitter posts through Obsidian Web Clipper workflows.
- `vault-diagram`: create and maintain editable JSON Canvas boards from vault context.

## Build From Source

Only needed when changing `mcp-server/src/`:

```bash
cd mcp-server
npm install
npm run rebuild
```

Commit the rebuilt `mcp-server/bundle.js` with source changes so plugin and setup installs work without requiring users to build locally.

## Verify Install

Probe the installed bundle:

```bash
printf '%s
' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'   | VAULT_MIND_VAULT_PATH=/path/to/your/vault node ~/.codex/skills/vault-wiki/mcp-server/bundle.js
```

You should see a JSON-RPC response with `serverInfo.name` set to `obsidian-llm-wiki`.

## Troubleshooting

**`mcp-server/bundle.js not found`**: build it with `cd mcp-server && npm install && npm run rebuild`, or use a release bundle that already includes it.

**Host skills directory not found**: install and launch the target host once, then rerun setup.

**MCP server starts but `vault.search` returns nothing**: verify `VAULT_MIND_VAULT_PATH` is absolute and points to a directory with `.md` files.

**Node syntax error**: use Node.js 20 or newer.

## Uninstall

Remove the installed skill bundle and delete the `vault-mind` MCP entry from host config:

```bash
rm -rf ~/.codex/skills/vault-wiki
```
