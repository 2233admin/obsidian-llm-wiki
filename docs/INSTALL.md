# Install guide

LLM Wiki is distributed from the `plugin` branch of this repository. CI builds it from `main` on every change (`.github/workflows/plugin.yml`), so the branch always holds a ready-to-run MCP server (`mcp-server/bundle.js`), every skill and command, and a lockfile for the one runtime dependency. Nothing is built on your machine.

## Prerequisites

- **Node.js 20.18.1 or newer** and npm
- **git**
- **An MCP-compatible agent host**: Claude Code, Codex, OpenCode, or Gemini CLI

Basic search, read, and keyword recall need nothing else. Compiler operations, Project layout migration, and Obsidian's governed promotion/Doctor checks also need Python and the `compiler/` directory from a full source checkout (see [Shared Settings Platform](#shared-settings-platform)).

## Claude Code

Inside a Claude Code session:

```
/plugin marketplace add 2233admin/obsidian-llm-wiki
/plugin install llmwiki@obsidian-llm-wiki
```

Claude Code asks for your **vault path** (an absolute path to your Obsidian vault or any folder of Markdown notes) and installs the runtime dependency itself. Run `/reload-plugins` or restart, then try:

```
/llmwiki:vault-librarian what do I know about attention heads
```

From a shell, `claude plugin install` does not prompt, so pass the path: `claude plugin install llmwiki@obsidian-llm-wiki --config vault_path=/absolute/path/to/vault`.

- **Change the vault:** `/plugin configure llmwiki@obsidian-llm-wiki`
- **Update:** `/plugin marketplace update obsidian-llm-wiki`, or `claude plugin update llmwiki@obsidian-llm-wiki` from a shell. Every publish of the `plugin` branch is a new version. To update automatically, open `/plugin`, go to **Marketplaces**, and enable auto-update for `obsidian-llm-wiki`.
- **Uninstall:** `/plugin uninstall llmwiki@obsidian-llm-wiki`

## Codex, OpenCode, Gemini CLI, and other MCP hosts

Clone the plugin branch once and install its dependency:

```bash
git clone --depth 1 -b plugin https://github.com/2233admin/obsidian-llm-wiki.git ~/.llmwiki
cd ~/.llmwiki && npm ci --omit=dev
```

### 1. Register the MCP server

The server needs one setting, `VAULT_MIND_VAULT_PATH`, the absolute path of your vault. Use absolute paths everywhere; most hosts do not expand `~`.

**Codex:**

```bash
codex mcp add vault-mind --env VAULT_MIND_VAULT_PATH=/absolute/path/to/vault -- node "$HOME/.llmwiki/mcp-server/bundle.js"
```

**Gemini CLI** (`~/.gemini/settings.json`) and other hosts that use the common `mcpServers` shape:

```json
{
  "mcpServers": {
    "vault-mind": {
      "command": "node",
      "args": ["/home/you/.llmwiki/mcp-server/bundle.js"],
      "env": { "VAULT_MIND_VAULT_PATH": "/absolute/path/to/vault" }
    }
  }
}
```

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "vault-mind": {
      "type": "local",
      "command": ["node", "/home/you/.llmwiki/mcp-server/bundle.js"],
      "environment": { "VAULT_MIND_VAULT_PATH": "/absolute/path/to/vault" }
    }
  }
}
```

### 2. Link the skills

Link each skill into your host's skills directory so that `git pull` updates them in place. Replace `~/.codex/skills` with `~/.config/opencode/skills` or `~/.gemini/skills` as needed:

```bash
mkdir -p ~/.codex/skills
for s in ~/.llmwiki/skills/*/; do ln -sfn "${s%/}" ~/.codex/skills/; done
```

Windows PowerShell (junctions need no admin rights):

```powershell
$dest = "$HOME\.codex\skills"; New-Item -ItemType Directory -Force $dest | Out-Null
Get-ChildItem "$HOME\.llmwiki\skills" -Directory | ForEach-Object {
  New-Item -ItemType Junction -Force -Path (Join-Path $dest $_.Name) -Target $_.FullName | Out-Null
}
```

The thinking/research commands are in `~/.llmwiki/commands/`; link them into your host's prompt or command directory if it has one.

Restart the host, then ask `/vault-librarian what do I know about attention heads`.

### Update

```bash
cd ~/.llmwiki && git pull && npm ci --omit=dev
```

Re-run the link loop only when a release adds a new skill.

### Uninstall

Remove the `vault-mind` MCP entry from your host config, then:

```bash
find ~/.codex/skills -maxdepth 1 -lname "$HOME/.llmwiki/*" -delete
rm -rf ~/.llmwiki
```

## Shared Settings Platform

MCP, Python, and Obsidian consume the same Settings Platform. Obsidian is the primary visual control plane, but the system remains headless: closing Obsidian does not remove `settings.*`, Project Context, Project Hub, or workflow operations.

Compiler-backed operations need the `compiler/` directory from a full source checkout (the plugin branch ships only the MCP server and skills). Point the server at it when automatic discovery cannot find it:

```json
{
  "mcpServers": {
    "vault-mind": {
      "command": "node",
      "args": ["/path/to/.llmwiki/mcp-server/bundle.js"],
      "env": {
        "VAULT_MIND_VAULT_PATH": "/path/to/vault",
        "LLMWIKI_COMPILER_PATH": "/path/to/obsidian-llm-wiki/compiler",
        "VAULT_MIND_PYTHON": "python"
      }
    }
  }
}
```

`LLMWIKI_COMPILER_PATH` points to the directory containing `kb_meta.py`. `VAULT_MIND_COMPILER_PATH` remains a compatibility alias; new configs should use the canonical name. Machine-specific runtime and vault paths belong in process environment or `user-device` settings, never in shared Project records.

Settings precedence is `session > workspace-project > vault > user-device > product default`. Use `settings.scopes.get` to read a revision before `settings.assignment.set` or `settings.assignment.unset`; stale revisions return a conflict instead of overwriting another host.

Provider credentials must be configured as a Secret Reference, for example `{ "provider": "environment", "locator": "TAVILY_API_KEY" }`. LLM Wiki resolves only presence health through the host. Do not put the credential value in Settings, plugin data, Project Hubs, or vault notes.

Agent model setup lives in **Obsidian → Settings → LLM Wiki → Agent model**. Use `local` with an OpenAI-compatible/Ollama base URL and model identifier when no cloud key is needed. Use `cloud` with a device-local environment Secret Reference such as `{ "provider": "environment", "locator": "OPENAI_API_KEY" }`; enter the locator in Obsidian, never the key value itself. Agent model bindings currently support user-device, vault, and session scope; credential-bearing URLs are rejected.

See [SETTINGS.md](SETTINGS.md) for the complete model and [MIGRATIONS.md](MIGRATIONS.md) before upgrading an existing Obsidian plugin or Project layout.

### Optional Agent Wiki toolchain

No optional provider is required. Start with only `VAULT_MIND_VAULT_PATH`, register a `vaultPath` Source, and run the filesystem lifecycle. Add providers one at a time through Toolchain Settings and confirm each with `settings.doctor` before enabling workflows that depend on it.

A copyable MCP example is in `examples/agent-wiki-toolchain.mcp.example.json`; the separate Settings example shows semantic profiles without machine paths or credentials. OpenCLI remains a capture-only Provider, qmd/Graphify/LightRAG/RAG-Anything are retrieval or processing adapters, and Ollama/OpenAI-compatible endpoints provide optional embeddings. See [AGENT_WIKI_TOOLCHAIN.md](AGENT_WIKI_TOOLCHAIN.md) for version policies, capability names, diagnostics, and rollback flags.

## Obsidian control plane

The built desktop plugin consists of `obsidian-plugin/manifest.json`, `main.js`, and `styles.css`. Copy those files into `<vault>/.obsidian/plugins/vault-mind-promote/`, then reload Obsidian and enable **LLM Wiki**.

The retained plugin ID preserves existing installations. The plugin stores only presentation preferences, a device binding reference, and migration recovery state. Operational assignments live in Settings Platform scope stores. On first load it migrates legacy `pythonPath` and `kbMetaPath` values to the `user-device` scope; Doctor shows the resulting effective value and health.

## Optional ChubbySkills ingest pack

The plugin ships `/chubbyskills` as a skill. It does not install upstream media/transcription dependencies into LLM Wiki. Instead, it bundles a helper that prints safe install commands for [chubbyguan/chubbyskills](https://github.com/chubbyguan/chubbyskills).

Example from a git install (inside Claude Code, ask `/llmwiki:chubbyskills` instead):

```bash
python3 ~/.llmwiki/skills/chubbyskills/scripts/chubbyskills_bridge.py list
python3 ~/.llmwiki/skills/chubbyskills/scripts/chubbyskills_bridge.py plan \
  --vault /path/to/your/vault \
  --skills bilibili-transcribe podcast-transcribe wechat-article-ingest
```

See [CHUBBYSKILLS.md](CHUBBYSKILLS.md).

## Optional X/Twitter capture skill

The plugin also ships the `x-to-obsidian` skill, with the upstream-style browser automation script under its skill directory.

Use it only on machines that can run the workflow requirements: macOS, a supported logged-in browser, Obsidian, and the official Obsidian Web Clipper.

For a git install the script is at `~/.llmwiki/skills/x-to-obsidian/scripts/x_to_obsidian.py`.

See [X_TO_OBSIDIAN.md](X_TO_OBSIDIAN.md).

## Optional memory and Kanban settings

The MCP server includes Markdown memory tools and the read-only `kanban` adapter.

| Env var | Default | Use |
|---|---|---|
| `VAULT_MIND_ACTOR` | `agent` | Actor namespace for Markdown memory and collaboration policy. |
| `VAULT_MIND_ADAPTERS` | default adapter list, including `kanban` | If you override it, include `filesystem,kanban` to keep board search. |
| `VAULT_MIND_KANBAN_GLOB` | `**/*.md` | Optional narrower glob for Markdown-backed Kanban boards. |

Markdown memory files are written under `10-Projects/<project>/agents/<actor>/memory/` when `project` is provided, otherwise under `00-Inbox/Agent-Memory/<actor>/`. Existing `memory.set/get/list/forget` still uses `_ai_memory.json`.

Visual exports use Obsidian core plugins when available: Canvas reads `.canvas` files, Bases reads `.base` dashboards, and Graph/Backlinks use normal Markdown links. No extra community plugin is required for Phase 1 visual exports. Kanban is still optional but recommended if you want Markdown board search.

Source Registry Phase 1 adds `source.register`, `source.list`, and `source.get`. It writes `_llmwiki/source-registry.json` plus Source Notes under `00-Inbox/Sources/<platform>/`, or `10-Projects/<project>/sources/<platform>/` when `project` is provided. URL registration runs read-only ingest preflight; it does not download, transcribe, or scrape.

After registration, use `source.ingest.plan`, then execute the returned exact `planId` with `source.ingest.run`. `source.ingest.inspect` and `source.ingest.verify` remain read-only. Successful changed content creates an Evidence Note and a durable maintenance entry; unchanged content is idempotent.

## Building the plugin from source

Only needed when you change `mcp-server/`, `skills/`, `commands/`, or `plugin/` and want to try it before CI publishes:

```bash
cd mcp-server && npm ci && npm run rebuild && cd ..
node scripts/build-plugin.mjs                 # assembles dist/plugin
(cd dist/plugin && npm ci --omit=dev)
node scripts/smoke-plugin.mjs dist/plugin     # boots it against a temp vault
claude --plugin-dir dist/plugin               # or point another host at dist/plugin
```

`bundle.js` and `dist/` are build outputs and are never committed to `main`.

## Verify the install

Boot the bundle directly with a probe:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | VAULT_MIND_VAULT_PATH=/absolute/path/to/vault node ~/.llmwiki/mcp-server/bundle.js
```

You should see a JSON-RPC response with `serverInfo.name = "obsidian-llm-wiki"`. In Claude Code, `claude mcp list` should show `plugin:llmwiki:vault-mind ... Connected`.

## Troubleshooting

**`fatal: No vault-mind.yaml found and VAULT_MIND_VAULT_PATH not set`** -- the server was started without a vault. In Claude Code run `/plugin configure llmwiki@obsidian-llm-wiki`; elsewhere add `VAULT_MIND_VAULT_PATH` to the MCP entry's env. Older docs said `VAULT_PATH`, which the server never read.

**`[vaultbrain] init failed ... Cannot find package '@electric-sql/pglite'`** (or `pglite-pgvector`) -- a runtime dependency is missing, so keyword recall is off. For a git install run `npm ci --omit=dev` in `~/.llmwiki`. In Claude Code, `/plugin` shows a note on the plugin when its dependency install failed; reinstall the plugin.

**`SyntaxError` or a Node version error** -- the bundle requires Node 20.18.1+. Check `node --version`.

**Obsidian adapter not connecting** -- the WebSocket adapter only activates when Obsidian is running with the `obsidian-vault-bridge` plugin. Without it, the filesystem adapter handles everything (read, search, lint, graph); you only lose live sync.
