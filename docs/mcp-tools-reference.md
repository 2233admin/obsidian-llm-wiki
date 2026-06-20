# MCP Tools Reference

> Auto-generated from `mcp-server/src/core/operations.ts`.
> Run `npm run generate-tools-doc` to regenerate. Do not edit by hand.

Total: **58** operations across **10** namespaces.

## `vault.*` (29)

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

### `vault.daily`

Create or update today's daily note with AI-First frontmatter (date, mood, energy, summary). Path: Daily/YYYY-MM-DD.md

**Mutating:** yes

**Parameters:**

- `summary` (string, optional) — 1-3 sentence day summary
- `mood` (string, optional, enum: `great` | `good` | `neutral` | `low` | `bad`) — Mood rating
- `energy` (string, optional, enum: `high` | `medium` | `low`) — Energy level
- `tags` (array, optional) — Extra tags
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

### `vault.decide`

Create a structured decision log (ADR). Path: Decisions/YYYY-MM-DD -- {title-slug}.md

**Mutating:** yes

**Parameters:**

- `title` (string, required) — Decision title
- `context` (string, required) — Situation and constraints
- `decision` (string, required) — What was decided
- `rationale` (string, optional) — Why this decision
- `consequences` (string, optional) — Trade-offs and outcomes
- `status` (string, optional, default: `"accepted"`, enum: `proposed` | `accepted` | `deprecated` | `superseded`) — Decision status
- `tags` (array, optional) — Extra tags
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

### `vault.ingest`

Ingest content into vault with AI-First frontmatter (ai-first: true, source, recency markers). Path: 00-Inbox/{title-slug}.md

**Mutating:** yes

**Parameters:**

- `content` (string, required) — Content to ingest (text, URL, or pasted article)
- `title` (string, required) — Note title
- `source` (string, optional) — Source URL if from web
- `type` (string, optional, default: `"note"`, enum: `article` | `research` | `note` | `reference`) — Content type
- `tags` (array, optional) — Extra tags
- `preamble` (string, optional) — 2-3 sentence "For future Claude" preamble
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

### `vault.init`

Scaffold the vault. methodology mode creates the folder layout (generic|para|lyt|zettelkasten) plus a Home.md index with AI-First frontmatter, dry-run by default, existing folders are skipped; topic mode scaffolds a knowledge base topic directory (writes immediately).

**Mutating:** yes

**Parameters:**

- `topic` (string, optional) — Topic name (used as directory name and KB title); topic mode
- `methodology` (string, optional, enum: `generic` | `para` | `lyt` | `zettelkasten`) — Vault folder scaffold to create; methodology mode
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (methodology mode only, default: true)

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

### `vault.meeting`

Create a meeting note with attendees, decisions, and action items. Path: Meetings/YYYY-MM-DD -- {title-slug}.md

**Mutating:** yes

**Parameters:**

- `title` (string, required) — Meeting title
- `attendees` (array, optional) — Attendee names (wikilinked)
- `decisions` (array, optional) — List of decisions made
- `actions` (array, optional) — Action items (strings)
- `summary` (string, optional) — Meeting summary
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

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

### `vault.person`

Create or update a person note with AI-First frontmatter. Path: People/{name}.md

**Mutating:** yes

**Parameters:**

- `name` (string, required) — Person's full name
- `role` (string, optional) — Job title or role
- `company` (string, optional) — Organization
- `relationship` (string, optional) — How you know them
- `notes` (string, optional) — Additional context
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

### `vault.project`

Create or update a project note with AI-First frontmatter. Path: Projects/{name}.md

**Mutating:** yes

**Parameters:**

- `name` (string, required) — Project name
- `status` (string, optional, default: `"active"`, enum: `active` | `paused` | `completed` | `archived` | `planned`) — Project status
- `summary` (string, optional) — 1-3 sentence project summary
- `team` (array, optional) — Team member names (wikilinked in content)
- `tags` (array, optional) — Extra tags
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

### `vault.sweepAIOutput`

Sweep 00-Inbox/AI-Output for stale drafts (age > persona threshold and no non-AI-Output backlinks) and supersede candidates (same-persona reviewed pairs with source-nodes Jaccard >= 0.6). Reports candidates; when dry_run=false flips draft→stale in place. Never auto-applies supersede.

**Mutating:** yes

**Parameters:**

- `dry_run` (boolean, optional, default: `true`) — Report only without writing (default: true)
- `now` (string, optional) — Inject ISO 8601 timestamp for deterministic tests

### `vault.writeAIOutput`

Write a persona-authored analysis into 00-Inbox/AI-Output/{persona}/YYYY-MM-DD-{slug}.md with the 8-field provenance frontmatter (generated-by, generated-at, agent, parent-query, source-nodes, status=draft, scope, quarantine-state). Human confirmation rides on an Obsidian body tag (#user-confirmed), not a frontmatter field. Dry-run by default.

**Mutating:** yes

**Parameters:**

- `persona` (string, required) — Persona identifier, must match ^vault-[a-z]+$
- `parentQuery` (string, required) — User's original query (truncated to 200 chars)
- `sourceNodes` (array, required) — Wikilinks cited during analysis (empty array is valid)
- `agent` (string, required) — Model identifier (e.g. claude-opus-4-7)
- `body` (string, required) — Markdown body without frontmatter
- `slug` (string, optional) — Optional filename slug; auto-derived from parentQuery if omitted
- `scope` (string, optional, default: `"project"`, enum: `project` | `global` | `cross-project` | `host-local`) — Governance namespace for the entry (default: project)
- `quarantineState` (string, optional, default: `"new"`, enum: `new` | `reviewed` | `promoted` | `discarded`) — Trust-gate state in the candidate lifecycle (default: new)
- `reviewStatus` (string, optional, default: `"none"`, enum: `none` | `user-confirmed`) — When user-confirmed, appends #user-confirmed tag to the body so Obsidian tag search picks it up. Default: none (no tag appended).
- `dryRun` (boolean, optional, default: `true`) — Simulate without writing (default: true)

## `query.*` (6)

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

Filesystem-only RRF-ranked knowledge search. Same fusion pipeline as query.unified restricted to the filesystem adapter (single-source RRF degenerates to rank preservation). Use for deterministic filesystem-rooted results without memu/gitnexus noise; use vault.search for raw grep-style matching without ranking.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search query string
- `maxResults` (number, optional, default: `50`) — Maximum results to return (default: 50)

### `query.semantic`

Text-input semantic search. Embeds the query via an OpenAI-compatible embedding endpoint (default: ollama qwen3-embedding:0.6b at localhost:11434 -- the same model that produced memU's stored 1024-dim vectors), then fans out to all embeddings-capable adapters (currently memu, pgvector cosine). Use this for natural-language queries that should match by meaning rather than keyword. Override endpoint/model via VAULT_MIND_EMBED_URL and VAULT_MIND_EMBED_MODEL env. For pre-computed vectors use query.vector; for keyword matching use query.unified (RRF fusion of keyword adapters).

**Mutating:** no

**Parameters:**

- `query` (string, required) — Natural-language text to embed and semantic-search
- `maxResults` (number, optional, default: `50`) — Maximum results to return (default: 50)
- `adapters` (array, optional) — Limit to specific embedding-capable adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers

### `query.unified`

Reciprocal Rank Fusion (RRF) search across all active adapters (filesystem, obsidian, memu, gitnexus). Each adapter returns its ranked top-N; results are merged by RRF score = sum over sources (weight / (60 + rank_in_source)), so a doc that appears in top-5 of multiple sources beats a doc at top-1 of just one. Weights now scale each source's rank contribution (not raw score), so weight=2 doubles a source's influence on tied docs. Use when you want best answers anywhere; for single-adapter ranked search use query.search, for raw grep use vault.search.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search query string
- `maxResults` (number, optional, default: `50`) — Maximum results to return (default: 50)
- `adapters` (array, optional) — Limit to specific adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers, e.g. {"obsidian":1.2,"filesystem":0.8}
- `caseSensitive` (boolean, optional, default: `false`) — Case-sensitive matching
- `context` (number, optional) — Lines of surrounding context per match

### `query.vector`

Weighted multi-adapter semantic search via pre-computed query vector. Fans out to adapters declaring the "embeddings" capability (currently memu via pgvector cosine). Caller supplies the vector -- adapters are model-agnostic, so callers must produce an embedding matching the adapter's stored vector space (memu: 1024-dim). Use for vector-similarity ranking when you already have an embedding; for text-input semantic search use query.semantic; for keyword fusion use query.unified (RRF).

**Mutating:** no

**Parameters:**

- `vector` (array, required) — Pre-computed query embedding as number[] (memu expects 1024-dim)
- `maxResults` (number, optional, default: `50`) — Maximum results to return (default: 50)
- `adapters` (array, optional) — Limit to specific embedding-capable adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers

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

## `multimodal.*` (1)

### `multimodal.ingest`

Parse a vault-relative multimodal document through the RAG-Anything HTTP bridge and write the extracted Markdown back into the vault. Dry-run by default. Requires RAGANYTHING_URL and a running wrapper service.

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative source file path, e.g. attachments/report.pdf
- `outputPath` (string, optional) — Vault-relative Markdown output path. Defaults to 00-Inbox/Multimodal/<source-name>.md
- `parser` (string, optional) — Parser hint passed to RAG-Anything, e.g. mineru, docling, paddleocr
- `docId` (string, optional) — Optional document id passed through to the processing service
- `dryRun` (boolean, optional, default: `true`) — Return extracted Markdown without writing (default: true)

## `lightrag.*` (1)

### `lightrag.ingest`

Send a vault-relative file into an external LightRAG server. Markdown/text files use /documents/text; other files use /documents/upload. Dry-run by default. Requires LIGHTRAG_URL.

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative source file path
- `mode` (string, optional, default: `"auto"`, enum: `auto` | `text` | `upload`) — Ingest mode. auto sends .md/.txt as text and other files as upload.
- `dryRun` (boolean, optional, default: `true`) — Return the planned LightRAG request without sending it (default: true)

## `holon.*` (4)

### `holon.get`

Get a compiled holon by ID

**Mutating:** no

**Parameters:**

- `id` (string, required) — Holon ID (e.g. concepts/attention)

### `holon.list`

List compiled holons with optional kind/status filter

**Mutating:** no

**Parameters:**

- `kind` (string, optional) — Filter by kind (research, decision, note, knowledge-task, …)
- `status` (string, optional) — Filter by status (active, frozen, …)
- `limit` (number, optional, default: `50`) — Max results (default: 50)

### `holon.search`

Search holons by title or summary (case-insensitive substring)

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search string
- `limit` (number, optional, default: `20`) — Max results (default: 20)

### `holon.tasks`

List knowledge-task holons with task stats

**Mutating:** no

**Parameters:**

- `status` (string, optional) — Filter by status (active, frozen, …)

## `causal.*` (3)

### `causal.chain`

BFS-traverse the causal graph outward from a starting holon

**Mutating:** no

**Parameters:**

- `id` (string, required) — Starting holon ID
- `max_depth` (number, optional, default: `3`) — Max traversal depth (default: 3)
- `min_confidence` (number, optional, default: `0`) — Min edge confidence 0–1 (default: 0)

### `causal.hyperedges`

List all n-ary hyperedges (meetings, events, collaborations) involving a holon, or all hyperedges if no id given

**Mutating:** no

**Parameters:**

- `id` (string, optional) — Holon ID to filter by (omit for all hyperedges)
- `relation` (string, optional) — Filter by relation type (e.g. "meeting")

### `causal.neighbors`

Get direct causal neighbors (depth 1) of a holon

**Mutating:** no

**Parameters:**

- `id` (string, required) — Holon ID
- `direction` (string, optional, default: `"outbound"`, enum: `outbound` | `inbound` | `both`) — outbound | inbound | both (default: outbound)

## `provenance.*` (1)

### `provenance.get`

Get provenance for a holon: content hash, wikilinks, and annotated causal edges

**Mutating:** no

**Parameters:**

- `id` (string, required) — Holon ID
