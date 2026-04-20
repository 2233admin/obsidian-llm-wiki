# Install guide

For most people the [README quick-start](../README.md#quick-start-30-seconds) is the right path. This doc covers per-host variants, manual install, troubleshooting, and uninstall.

## Prerequisites

- **Node.js 20 or higher** -- the bundled MCP server is an ESM module targeting Node 20+
- **An MCP-compatible agent host** -- Claude Code, Codex, OpenCode, or Gemini CLI

You do **not** need Python, npm, or a TypeScript toolchain. The repo ships a pre-built `mcp-server/bundle.js` (1.5 MB, no runtime dependencies).

## Quick install (recap)

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git ~/obsidian-llm-wiki-src
cd ~/obsidian-llm-wiki-src && ./setup
```

Setup copies a 1.6 MB curated allowlist (`skills/`, `examples/`, `docs/`, `terrariums/`, `viewer/`, `smoke/`, `mcp-server/{bundle.js, package.json}`, top-level docs, `vercel.json`) into your host's skills directory. After setup runs you can delete the source clone.

## Per-host install

Pass `--host` to target a specific agent. Default is `claude`.

```bash
./setup --host claude     # ~/.claude/skills/vault-wiki
./setup --host codex      # ~/.codex/skills/vault-wiki
./setup --host opencode   # ~/.config/opencode/skills/vault-wiki
./setup --host gemini     # ~/.gemini/skills/vault-wiki
```

Windows / PowerShell:

```powershell
.\setup.ps1 -VaultHost claude
.\setup.ps1 -VaultHost claude -DryRun     # preview without writing
```

`--dry-run` (bash) or `-DryRun` (PowerShell) prints every copy operation without touching disk -- use it to confirm the allowlist before committing to a real install.

## After setup -- two paste-in steps

Setup prints both snippets at the end. Copy them into the right place:

**1. Add to your `.mcp.json`:** the printed JSON snippet registers `vault-mind` as an MCP server pointing at the installed `bundle.js`. The `VAULT_PATH` env var must be set to the absolute path of your Obsidian vault (or any markdown directory).

**2. Add to `CLAUDE.md` (or equivalent host instructions):** the printed `## Vault Personas` section tells your agent which persona to invoke for which task.

Restart your agent host so the MCP registration is picked up.

## Manual install (no setup script)

If you prefer to copy files by hand:

```bash
git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki.git
cd obsidian-llm-wiki

# pick your host's skills dir
HOST_DIR="$HOME/.claude/skills/vault-wiki"
mkdir -p "$HOST_DIR/mcp-server"

cp -r skills examples docs terrariums viewer smoke "$HOST_DIR/"
cp README.md CHANGELOG.md RELEASE_NOTES.md vercel.json "$HOST_DIR/"
cp mcp-server/bundle.js mcp-server/package.json "$HOST_DIR/mcp-server/"
```

Then add the `.mcp.json` entry manually:

```json
{
  "mcpServers": {
    "vault-mind": {
      "command": "node",
      "args": ["/absolute/path/to/host/skills/vault-wiki/mcp-server/bundle.js"],
      "env": { "VAULT_PATH": "/absolute/path/to/your/vault" }
    }
  }
}
```

## Building from source (rare)

You only need this if you forked the repo and changed `mcp-server/src/`:

```bash
cd mcp-server
npm install            # installs ws, MCP SDK, pglite, esbuild devDep
npm run rebuild        # tsc -> dist/, then esbuild --bundle -> bundle.js
```

`npm run rebuild` produces a fresh `bundle.js` in ~2 seconds. Commit it alongside your source changes so paste-install users don't see a "build it first" error.

## Verify the install

After setup, boot the bundle directly with a probe:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | VAULT_PATH=/path/to/your/vault node ~/.claude/skills/vault-wiki/mcp-server/bundle.js
```

You should see a JSON-RPC response with `serverInfo.name = "obsidian-llm-wiki"` and `protocolVersion = "2024-11-05"`. Server stderr will say `MCP server running (stdio, vX.Y.Z, adapters: filesystem)`.

## Troubleshooting

**`Error: mcp-server/bundle.js not found`** -- you're installing from a fresh clone that hasn't been built. Run `cd mcp-server && npm install && npm run rebuild`, then re-run `./setup`. (The released tarballs ship `bundle.js` pre-built; you'd only hit this from a `--depth 1` clone of an actively-changing branch.)

**`Error: Host directory not found: ~/.claude/skills`** -- the agent host you specified isn't installed (or hasn't been launched once). Install / launch it, then re-run setup.

**`Error: Dynamic require of "events" is not supported`** -- the bundle was built without the `createRequire` shim banner. Re-run `npm run bundle` -- the `package.json` `bundle` script includes the correct banner flag.

**MCP server starts but `vault.search` returns nothing** -- check that `VAULT_PATH` in `.mcp.json` is absolute and points at a directory with `.md` files. The server logs the resolved vault path at startup (visible in your agent host's MCP log).

**`Node version error` / `SyntaxError: Unexpected token`** -- the bundle targets Node 20+. Run `node --version` to confirm; upgrade with `nvm` / `fnm` if older.

**Obsidian adapter not connecting** -- the bundle includes the WebSocket adapter (`ws`), but it only activates when Obsidian is running with the `obsidian-vault-bridge` plugin. Without it, the filesystem adapter handles everything (read, search, lint, graph) -- you just lose live sync.

## Uninstall

```bash
rm -rf ~/.claude/skills/vault-wiki
# Then remove the "vault-mind" entry from your .mcp.json manually.
```

For other hosts, replace `~/.claude/` with `~/.codex/`, `~/.config/opencode/`, or `~/.gemini/`.
