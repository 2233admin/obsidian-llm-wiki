# MCP Tools Reference

> Auto-generated from `mcp-server/src/core/operations.ts`.
> Run `npm run generate-tools-doc` to regenerate. Do not edit by hand.

Total: **38** operations across **5** namespaces.

## `vault.*` (21)

### `vault.append`

Append content to a note

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative path to the note
- `content` (string, required) — Content to append
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

### `vault.backlinks`

Find notes linking to a note

**Mutating:** no

**Parameters:**

- `path` (string, required) — Vault-relative path of the target note

### `vault.batch`

Execute multiple vault operations

**Mutating:** no

**Parameters:**

- `operations` (array, required) — Array of {method, params} objects to execute
- `dryRun` (boolean, optional) — Apply dryRun to all mutating operations in the batch

### `vault.create`

Create a new note (dry-run by default)

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative path for the new note
- `content` (string, optional) — Initial content
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

### `vault.delete`

Delete a note or folder

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative path to delete
- `dryRun` (boolean, optional, default: `true`) — Simulate without deleting (default: true)

### `vault.enforceDiscipline`

Retroactively enforce Karpathy LLM Wiki discipline: ensure each top-level topic folder has _index.md (catalog) and log.md (chronicle). Skips folders that already have a recognized catalog (Home.md/INDEX.md/README.md) or chronicle (Log.md). Dry-run by default.

**Mutating:** yes

**Parameters:**

- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)
- `topLevelOnly` (boolean, optional, default: `true`) — Only process top-level directories (default: true)
- `skipDirs` (array, optional) — Additional directory names to skip beyond the built-in protected list

### `vault.exists`

Check if a path exists

**Mutating:** no

**Parameters:**

- `path` (string, required) — Vault-relative path to check

### `vault.getMetadata`

Get parsed metadata for a note

**Mutating:** no

**Parameters:**

- `path` (string, required) — Vault-relative path to the note

### `vault.graph`

Build full wikilink graph of the vault. Returns nodes (with exists flag), edges (from/to/count), orphans (.md files with no inbound links), and unresolvedLinks count. Filter edges with type=resolved|unresolved|both (default both).

**Mutating:** no

**Parameters:**

- `type` (string, optional, default: `"both"`, enum: `resolved` | `unresolved` | `both`) — Link type filter (default: both)

### `vault.init`

Scaffold a new knowledge base topic

**Mutating:** yes

**Parameters:**

- `topic` (string, required) — Topic name (used as directory name and KB title)

### `vault.lint`

Vault health audit: finds orphans (no inbound wikilinks), broken wikilinks, empty files, duplicate titles, and optionally missing required frontmatter keys. Read-only; does not check modification time.

**Mutating:** no

**Parameters:**

- `requiredFrontmatter` (array, optional) — List of frontmatter keys that every note must have

### `vault.list`

List files and folders

**Mutating:** no

**Parameters:**

- `path` (string, optional, default: `""`) — Vault-relative directory path (default: root)

### `vault.mkdir`

Create a directory

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative directory path to create
- `dryRun` (boolean, optional, default: `true`) — Simulate without creating (default: true)

### `vault.modify`

Overwrite an existing note

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative path to the note
- `content` (string, required) — New content
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

### `vault.read`

Read a note's content

**Mutating:** no

**Parameters:**

- `path` (string, required) — Vault-relative path to the note

### `vault.reindex`

Bulk-index all markdown files into VaultBrain semantic store. Use after initial setup or vault migration.

**Mutating:** no

**Parameters:**

- `dryRun` (boolean, optional, default: `false`) — Count files without ingesting (default: false)
- `concurrency` (number, optional, default: `4`) — Max concurrent ingest calls (default: 4)

### `vault.rename`

Rename/move a file

**Mutating:** yes

**Parameters:**

- `from` (string, required) — Source vault-relative path
- `to` (string, required) — Destination vault-relative path
- `dryRun` (boolean, optional, default: `true`) — Simulate without moving (default: true)

### `vault.search`

Fulltext grep across vault .md files (filesystem-only, single-adapter). Returns matching lines with line numbers, not ranked results. Use regex=true for patterns, glob to restrict scope. For cross-adapter weighted search use query.unified.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search query string
- `regex` (boolean, optional) — Treat query as regex
- `caseSensitive` (boolean, optional) — Case-sensitive matching
- `maxResults` (number, optional, default: `50`) — Maximum results to return (default: 50)
- `glob` (string, optional) — Glob pattern to restrict search scope

### `vault.searchByFrontmatter`

Find notes by frontmatter key-value

**Mutating:** no

**Parameters:**

- `key` (string, required) — Frontmatter key to filter on
- `value` (string, optional) — Value to compare against
- `op` (string, optional, default: `"eq"`, enum: `eq` | `ne` | `gt` | `lt` | `gte` | `lte` | `contains` | `regex` | `exists`) — Comparison operator (default: eq)

### `vault.searchByTag`

Find notes with a given tag

**Mutating:** no

**Parameters:**

- `tag` (string, required) — Tag to search for (with or without leading #)

### `vault.stat`

Get file/folder metadata

**Mutating:** no

**Parameters:**

- `path` (string, required) — Vault-relative path

## `query.*` (4)

### `query.adapters`

List registered adapters, their capabilities, and availability

**Mutating:** no

**Parameters:** none

### `query.explain`

Concept explanation via top-10 cross-adapter results with 3 lines of surrounding context per match. Same fan-out as query.unified but fixes maxResults=10 and context=3, tuned for paragraph-length summarization. Use when synthesizing prose, not browsing raw results.

**Mutating:** no

**Parameters:**

- `concept` (string, required) — Concept to explain

### `query.search`

Filesystem-only ranked knowledge search. Same scoring pipeline as query.unified but restricted to the filesystem adapter. Use for deterministic filesystem-rooted results without memu/gitnexus noise; use vault.search for raw grep-style matching without ranking.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search query string
- `maxResults` (number, optional, default: `50`) — Maximum results to return (default: 50)

### `query.unified`

Weighted multi-adapter search across all active adapters (filesystem, obsidian, memu, gitnexus). Results merged and re-ranked by per-adapter weight. Use when you want best answers anywhere; for single-adapter search use query.search (filesystem-only, ranked) or vault.search (raw filesystem grep, unranked).

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search query string
- `maxResults` (number, optional, default: `50`) — Maximum results to return (default: 50)
- `adapters` (array, optional) — Limit to specific adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers, e.g. {"obsidian":1.2,"filesystem":0.8}
- `caseSensitive` (boolean, optional, default: `false`) — Case-sensitive matching
- `context` (number, optional) — Lines of surrounding context per match

## `compile.*` (4)

### `compile.abort`

Abort running compilation

**Mutating:** yes

**Parameters:** none

### `compile.diff`

Show compilation diff

**Mutating:** no

**Parameters:**

- `topic` (string, optional) — Topic filter

### `compile.run`

Run compilation

**Mutating:** yes

**Parameters:**

- `topic` (string, optional) — Topic to compile

### `compile.status`

Get compilation status

**Mutating:** no

**Parameters:** none

## `recipe.*` (5)

### `recipe.doctor`

Full diagnostic: secrets + health checks for a recipe

**Mutating:** yes

**Parameters:**

- `id` (string, required) — Recipe id

### `recipe.list`

List all recipes with their status (secrets present/missing)

**Mutating:** no

**Parameters:** none

### `recipe.run`

Run a recipe collector. Secrets must be set in the MCP server environment.

**Mutating:** yes

**Parameters:**

- `id` (string, required) — Recipe id (e.g. napcat-to-vault)
- `timeout_ms` (number, optional) — Timeout ms (default 120000)

### `recipe.show`

Show a recipe's frontmatter and setup guide

**Mutating:** no

**Parameters:**

- `id` (string, required) — Recipe id (e.g. x-to-vault)

### `recipe.status`

Check secret configuration status for a recipe

**Mutating:** no

**Parameters:**

- `id` (string, required) — Recipe id

## `agent.*` (4)

### `agent.history`

Get agent action history

**Mutating:** no

**Parameters:**

- `limit` (number, optional, default: `20`) — Maximum number of history entries (default: 20)

### `agent.schedule`

Schedule an agent task

**Mutating:** no

**Parameters:**

- `task` (string, required) — Task to schedule
- `cron` (string, required) — Cron expression

### `agent.status`

Get agent status

**Mutating:** no

**Parameters:**

- `mode` (string, optional) — Agent mode filter

### `agent.trigger`

Trigger an agent action

**Mutating:** yes

**Parameters:**

- `action` (string, required) — Action to trigger (compile, emerge, reconcile, prune, challenge)
- `mode` (string, optional) — Agent mode
