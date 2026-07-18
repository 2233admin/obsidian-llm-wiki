# MCP Tools Reference

> Auto-generated from `mcp-server/src/core/operations.ts`.
> Run `npm run generate-tools-doc` to regenerate. Do not edit by hand.

Total: **180** operations across **25** namespaces.

## `vault.*` (31)

### `vault.annotate`

Append an AI-generated section to an existing vault note. Accepts a holon ID (resolves source_path automatically) or a vault-relative path. Adds a timestamped callout block under the given heading.

**Mutating:** yes

**Parameters:**

- `id` (string, optional) — Holon ID — used to locate the source .md file automatically
- `path` (string, optional) — Vault-relative path (alternative to id)
- `content` (string, required) — Markdown text to append
- `heading` (string, optional, default: `"## AI Notes"`) — Section heading (default: "## AI Notes")

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

**Mutating:** yes

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
- `project` (string, optional) — Owning project (namespaces the currency entity as project/<slug>/decision/<title>)
- `entity` (string, optional) — Currency entity key override (default derived from project + title)
- `source` (string, optional) — Verifiable source (commit:/path:/test:/url:); without it the decision shows UNSUPPORTED in the currency view
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

Deprecated compatibility update for an already-registered Project. Unknown names are rejected; use project.init to create a Project ID and Work-OS anchor.

**Mutating:** yes

**Parameters:**

- `name` (string, required) — Project name
- `status` (string, optional, default: `"active"`, enum: `active` | `paused` | `completed` | `archived` | `planned`) — Project status
- `summary` (string, optional) — 1-3 sentence project summary
- `team` (array, optional) — Team member names (wikilinked in content)
- `tags` (array, optional) — Extra tags
- `entity` (string, optional) — Currency entity key (default: project/<name-slug>); drives the status-drift guard
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

### `vault.write`

Create or overwrite a Markdown note in the vault. Use to write LLM-inferred conclusions, summaries, or AI-generated notes back into the knowledge base.

**Mutating:** yes

**Parameters:**

- `path` (string, required) — Vault-relative path, e.g. "notes/summary.md"
- `content` (string, required) — Full Markdown content of the note
- `overwrite` (boolean, optional, default: `false`) — Allow overwriting an existing file (default: false)

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

## `query.*` (8)

### `query.adapters`

List registered adapters, their capabilities, and availability

**Mutating:** no

**Parameters:** none

### `query.answer`

Citation-backed extractive answer built on query.trace. Returns answer, claims, citations, gaps, contradictions, confidence, and the underlying trace. Phase A is deterministic and conservative: it cites retrieved snippets and reports gaps instead of inventing missing context.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Question or search query to answer from vault evidence
- `maxResults` (number, optional, default: `5`) — Maximum evidence items to cite (default: 5)
- `adapters` (array, optional) — Limit specific adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers, e.g. {"obsidian":1.2,"filesystem":0.8}
- `caseSensitive` (boolean, optional, default: `false`) — Case-sensitive matching
- `context` (number, optional) — Lines surrounding context per match

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

### `query.trace`

Transparent retrieval trace for query.unified. Returns the query plan, selected adapters, per-adapter branch stats, RRF fusion settings, ranked evidence snippets, and known limitations. Use before evidence-backed answers when you need to explain why results were chosen.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search query string
- `maxResults` (number, optional, default: `10`) — Maximum evidence items return (default: 10)
- `adapters` (array, optional) — Limit specific adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers, e.g. {"obsidian":1.2,"filesystem":0.8}
- `caseSensitive` (boolean, optional, default: `false`) — Case-sensitive matching
- `context` (number, optional) — Lines surrounding context per match

### `query.unified`

Reciprocal Rank Fusion (RRF) search across all active adapters (filesystem, obsidian, kanban, memu, gitnexus). Each adapter returns its ranked top-N; results are merged by RRF score = sum over sources (weight / (60 + rank_in_source)), so a doc that appears in top-5 of multiple sources beats a doc at top-1 of just one. Weights now scale each source's rank contribution (not raw score), so weight=2 doubles a source's influence on tied docs. Use when you want best answers anywhere; for single-adapter ranked search use query.search, for raw grep use vault.search.

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

## `context.*` (4)

### `context.deep_search`

Heavier citation-backed context search returning full query.answer trace for complex cross-vault or project-scoped questions.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Question to answer with deeper trace
- `project` (string, optional) — Optional project key to scope search
- `maxResults` (number, optional, default: `20`) — Maximum evidence items (default: 20)
- `adapters` (array, optional) — Limit specific adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers

### `context.recall`

Topic-scoped citation-backed recall using query.answer. Project argument joins Work-OS context under 01-Projects/<project>/** with project knowledge under 10-Projects/<project>/**.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Topic or question to recall
- `project` (string, optional) — Optional project key to scope recall
- `maxResults` (number, optional, default: `8`) — Maximum evidence items (default: 8)
- `adapters` (array, optional) — Limit specific adapters by name
- `weights` (object, optional) — Per-adapter score weight multipliers

### `context.vault_status`

Read-only vault readiness check: classifies current state into vault_missing/empty_vault/unindexed/stale_or_backgrounding/ready. Never triggers indexing -- passive peek only.

**Mutating:** no

**Parameters:** none

### `context.wakeup`

Read-only MemPalace-style startup context: L0 passport, L1 handoff/sessions/decisions, optional L2 topic recall. Does not write files.

**Mutating:** no

**Parameters:**

- `project` (string, optional) — Optional project key; reads project-scoped actor memory
- `topic` (string, optional) — Optional topic/room for recall
- `maxChars` (number, optional, default: `6000`) — Approximate maximum JSON character budget (default: 6000)
- `maxDecisions` (number, optional, default: `5`) — Maximum recent conversation decisions include (default: 5)
- `maxSessions` (number, optional, default: `5`) — Maximum recent session memories include (default: 5)
- `includeRecall` (boolean, optional) — Run topic recall when topic provided (default: true when topic provided)

## `conversation.*` (3)

### `conversation.decision.capture`

Capture an AI conversation decision as append-only Markdown memory with summary, decision, why, rejected options, constraints, risks, actions, references, and excerpts.

**Mutating:** yes

**Parameters:**

- `project` (string, optional) — Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory/decisions
- `title` (string, required) — Decision title
- `summary` (string, optional) — Short decision context summary
- `decision` (string, optional) — Final decision or current captured conclusion
- `why` (string, optional) — Reasoning behind the decision
- `rejectedOptions` (array, optional) — Alternatives considered and rejected
- `constraints` (array, optional) — Constraint snapshot at decision time
- `assumptions` (array, optional) — Assumptions that may invalidate decision later
- `risks` (array, optional) — Risks and caveats
- `actions` (array, optional) — Follow-up actions
- `references` (array, optional) — Files, notes, links, issues, or sources referenced
- `excerpts` (array, optional) — Selected conversation excerpts, not full transcript
- `tags` (array, optional) — Tags for retrieval and filtering
- `source` (object, optional) — Optional source metadata object, e.g. {client, threadId, url}
- `dryRun` (boolean, optional, default: `false`) — Preview without writing (default: false)

### `conversation.decision.get`

Read a captured conversation decision by exact vault-relative path.

**Mutating:** no

**Parameters:**

- `path` (string, required) — Vault-relative decision markdown path

### `conversation.decision.list`

List captured conversation decision Markdown notes newest first.

**Mutating:** no

**Parameters:**

- `project` (string, optional) — Optional project key; reads project-scoped decision memory
- `limit` (number, optional, default: `20`) — Maximum decisions return (default: 20)
- `tag` (string, optional) — Optional tag filter

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

## `agent.*` (20)

### `agent.binding.create`

Bind an exact Agent Profile revision to one canonical Project Context.

**Mutating:** yes

**Parameters:**

- `input` (object, required)

### `agent.binding.list`

List current Project Agent Bindings for a canonical Project.

**Mutating:** no

**Parameters:**

- `project` (string, optional)
- `profileId` (string, optional)
- `enabled` (boolean, optional)

### `agent.binding.read`

Read the current immutable Project Agent Binding revision.

**Mutating:** no

**Parameters:**

- `bindingId` (string, required)

### `agent.binding.update`

Create the next Project Agent Binding revision under exact Project and optimistic locks.

**Mutating:** yes

**Parameters:**

- `bindingId` (string, required)
- `expectedRevision` (number, required)
- `patch` (object, required)
- `actor` (string, required)

### `agent.context.compile`

Compile a four-layer Context Envelope locked to current canonical Project, Profile, Binding, and approved Memory bytes.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `envelopeId` (string, required)
- `compiledAt` (string, required)
- `tokenBudget` (number, required)
- `profileId` (string, required)
- `expectedProfileRevision` (number, required)
- `bindingId` (string, required)
- `expectedBindingRevision` (number, required)
- `memoryRevisionId` (string, required)
- `expectedMemoryRevision` (number, required)
- `expectedMemoryFingerprint` (string, required)
- `threadId` (string, optional)
- `expectedThreadRevision` (number, optional)
- `deviceId` (string, optional)
- `expectedDeviceRevision` (number, optional)
- `expectedDeviceFingerprint` (string, optional)
- `capabilityGrantIds` (array, optional)
- `expectedFingerprint` (string, optional)
- `explicitNewAttempt` (boolean, optional, default: `false`)
- `input` (unknown, optional)
- `platformKernel` (unknown, optional)
- `runtime` (unknown, optional)
- `deviceCapabilities` (unknown, optional)
- `capabilityGrants` (unknown, optional)
- `modelLock` (unknown, optional)
- `profile` (unknown, optional)
- `binding` (unknown, optional)
- `memoryRevision` (unknown, optional)

### `agent.history`

Get agent action history

**Mutating:** no

**Parameters:**

- `limit` (number, optional, default: `20`) — Maximum number of history entries (default: 20)

### `agent.migration.plan`

Create a deterministic, byte-preserving dry-run plan from legacy passport, handoff, session, and key/value memory into governed Agent domain proposals.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID, slug, or registered alias
- `actor` (string, required) — Legacy Agent actor directory to inventory

### `agent.profile.create`

Create revision 1 of a vault-scoped Agent Profile.

**Mutating:** yes

**Parameters:**

- `input` (object, required)

### `agent.profile.list`

List current Agent Profile revisions deterministically.

**Mutating:** no

**Parameters:**

- `profileIds` (array, optional)

### `agent.profile.read`

Read the current immutable revision of one Agent Profile.

**Mutating:** no

**Parameters:**

- `profileId` (string, required)

### `agent.profile.update`

Create the next Agent Profile revision under an optimistic lock.

**Mutating:** yes

**Parameters:**

- `profileId` (string, required)
- `expectedRevision` (number, required)
- `patch` (object, required)
- `actor` (string, required)

### `agent.room.get`

Derive one read-only Room from Project Context, Agent Profile/Binding, and an active Thread.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `threadId` (string, optional)

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

### `agent.thread.append`

Append one ordered message, artifact, or Work Run reference without promoting it to memory.

**Mutating:** yes

**Parameters:**

- `threadId` (string, required)
- `expectedRevision` (number, required)
- `reference` (object, required)
- `actor` (string, required)

### `agent.thread.create`

Open a durable Thread locked to exact Binding and Profile revisions.

**Mutating:** yes

**Parameters:**

- `input` (object, required)

### `agent.thread.list`

List current durable Threads by canonical identity.

**Mutating:** no

**Parameters:**

- `project` (string, optional)
- `profileId` (string, optional)
- `bindingId` (string, optional)
- `lifecycle` (string, optional, enum: `open` | `closed` | `archived`)

### `agent.thread.read`

Read the current immutable Thread revision.

**Mutating:** no

**Parameters:**

- `threadId` (string, required)

### `agent.thread.transition`

Transition one Thread through its explicit lifecycle under an optimistic lock.

**Mutating:** yes

**Parameters:**

- `threadId` (string, required)
- `expectedRevision` (number, required)
- `lifecycle` (string, required, enum: `open` | `closed` | `archived`)
- `actor` (string, required)

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

Search holons by title or summary. Supports substring (default), BM25 keyword ranking, and hybrid (BM25 + substring merged) modes.

**Mutating:** no

**Parameters:**

- `query` (string, required) — Search string
- `limit` (number, optional, default: `20`) — Max results (default: 20)
- `mode` (string, optional, default: `"substring"`, enum: `substring` | `bm25` | `hybrid`) — substring | bm25 | hybrid (default: substring)

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

## `graph.*` (2)

### `graph.adapters.query`

Read isolated provenance-bearing graph snapshots from graph-capable Knowledge Adapters without merging them into vault.graph.

**Mutating:** no

**Parameters:**

- `adapters` (array, optional) — Optional Knowledge Adapter name allowlist. Empty selects none.

### `graph.export`

Export a causal subgraph as Mermaid diagram, Obsidian Canvas JSON, or Graphviz DOT. When format=canvas and output_path is given, writes the .canvas file into the vault.

**Mutating:** yes

**Parameters:**

- `id` (string, required) — Starting holon ID
- `depth` (number, optional, default: `3`) — BFS depth (default: 3)
- `format` (string, optional, default: `"mermaid"`, enum: `mermaid` | `canvas` | `dot`) — mermaid | canvas | dot (default: mermaid)
- `output_path` (string, optional) — Vault-relative path to write canvas file (e.g. "graphs/attention.canvas"). Only used when format=canvas.

## `memory.*` (10)

### `memory.forget`

Delete a persisted memory by key.

**Mutating:** yes

**Parameters:**

- `key` (string, required) — Key to delete

### `memory.get`

Retrieve persisted memories by exact key or tag. Returns all memories if neither is specified.

**Mutating:** no

**Parameters:**

- `key` (string, optional) — Exact key to retrieve
- `tag` (string, optional) — Tag to filter by

### `memory.handoff.latest`

Read the current Markdown handoff for the current actor. Returns the default handoff template when no file exists.

**Mutating:** no

**Parameters:**

- `project` (string, optional) — Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory

### `memory.handoff.write`

Create or replace the Markdown handoff with Current State, Next Steps, Risks, and Files sections.

**Mutating:** yes

**Parameters:**

- `project` (string, optional) — Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory
- `currentState` (string, optional) — Where the work stands now
- `nextSteps` (array, optional) — Concrete next actions
- `risks` (array, optional) — Known risks or blockers
- `files` (array, optional) — Relevant vault paths or workspace files

### `memory.list`

List all persisted memories (key, tags, preview, timestamp). Use memory.get to retrieve full values.

**Mutating:** no

**Parameters:** none

### `memory.passport.get`

Read the Markdown memory passport for the current actor. Returns the default passport template when no file exists.

**Mutating:** no

**Parameters:**

- `project` (string, optional) — Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory

### `memory.passport.upsert`

Create or replace the Markdown memory passport with Goal, Constraints, Decisions, Open Questions, and Pointers sections.

**Mutating:** yes

**Parameters:**

- `project` (string, optional) — Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory
- `goal` (string, optional) — Project or agent goal
- `constraints` (array, optional) — Constraints that future sessions should preserve
- `decisions` (array, optional) — Durable decisions to carry forward
- `openQuestions` (array, optional) — Open questions for the next session
- `pointers` (array, optional) — Files, notes, or links worth revisiting

### `memory.session.list`

List timestamped Markdown session notes for the current actor, newest first.

**Mutating:** no

**Parameters:**

- `project` (string, optional) — Optional project key; reads from 10-Projects/<project>/agents/<actor>/memory
- `limit` (number, optional, default: `20`) — Maximum sessions to return (default: 20)

### `memory.session.save`

Save a timestamped Markdown session note with Summary, Decisions, Actions, and References sections.

**Mutating:** yes

**Parameters:**

- `project` (string, optional) — Optional project key; stores under 10-Projects/<project>/agents/<actor>/memory
- `title` (string, optional) — Optional session title used in the heading and filename slug
- `summary` (string, required) — Session summary
- `decisions` (array, optional) — Decisions made during the session
- `actions` (array, optional) — Follow-up actions
- `references` (array, optional) — Files, notes, links, or identifiers referenced by the session

### `memory.set`

Persist a named memory across MCP sessions. Use for inferences, user preferences, project state, or any context that should survive server restarts. Storage: <vault>/_ai_memory.json (excluded from holon compilation).

**Mutating:** yes

**Parameters:**

- `key` (string, required) — Unique memory key, e.g. "project/status" or "user_goal"
- `value` (string, required) — Memory content (Markdown supported)
- `tags` (array, optional) — Optional tags for grouping, e.g. ["project", "decision"]

## `project.*` (19)

### `project.base.export`

Export an Obsidian Bases issues dashboard under 01-Projects/<project>/views/issues.base (derived view).

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `dryRun` (boolean, optional, default: `true`) — Preview Bases YAML without writing (default: true)
- `overwrite` (boolean, optional, default: `true`) — Overwrite existing Bases file (default: true)

### `project.board.get`

Render the work-OS Kanban board (Obsidian kanban-plugin format) from the authoritative issue notes. Parity with `python kb_meta.py work board`.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `lang` (string, optional) — Lane-label language (en/zh/ja); default $VAULT_MIND_LANG then auto-detect
- `write` (boolean, optional, default: `false`) — Also write board.md next to the project anchor (derived view)

### `project.canvas.export`

Export an Obsidian Canvas project map under 01-Projects/<project>/views/project-map.canvas (derived view).

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `dryRun` (boolean, optional, default: `true`) — Preview Canvas JSON without writing (default: true)
- `overwrite` (boolean, optional, default: `true`) — Overwrite existing Canvas file (default: true)

### `project.comment.add`

Append a comment to a sibling 01-Projects/<project>/issues/<slug>.comments.md (does not affect the board/authoritative index).

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `slug` (string, required) — Issue slug
- `body` (string, required) — Comment Markdown body
- `actor` (string, optional) — Comment actor; defaults to collaboration actor
- `session` (string, optional) — Optional session/thread id

### `project.context.doctor`

Diagnose Project anchors, aliases, bindings, domain roots, identity agreement, and release-gated compatibility reads.

**Mutating:** no

**Parameters:** none

### `project.context.resolve`

Resolve a Project reference to stable identity, canonical domain roots, bindings, projections, and diagnostics.

**Mutating:** no

**Parameters:**

- `ref` (string, optional) — Canonical Project ID, registered alias/slug, or bound workspace path
- `project` (string, optional) — Compatibility alias for ref

### `project.hub.get`

Compose a read-only Project Hub from registry, Work-OS, knowledge, runtime, settings, capabilities, workspace, and provider-owned integrations.

**Mutating:** no

**Parameters:**

- `ref` (string, optional) — Canonical Project ID, registered alias/slug, or bound workspace path
- `project` (string, optional) — Compatibility alias for ref

### `project.init`

Create a work-OS project anchor note at 01-Projects/<project>/_project.md (single source of truth; no docket store).

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key, single safe path segment
- `description` (string, optional) — One-line project description (<=200 chars)

### `project.issue.create`

Create a work-OS issue note under 01-Projects/<project>/issues/<slug>.md. Default state is todo; review reviewed (authoritative).

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `title` (string, required) — Issue title (-> slug + default card label)
- `slug` (string, optional) — Explicit slug (lowercase-kebab); default derived from title
- `summary` (string, optional) — One-line description (<=200 chars); default from title
- `body` (string, optional) — Detailed issue body (first non-blank line is the card label)
- `state` (string, optional) — Work state: backlog|todo|in-progress|done|canceled (default todo)
- `review` (string, optional, enum: `reviewed` | `draft`) — Review axis (default reviewed = authoritative)
- `priority` (string, optional) — Priority as a string: int "0".."4" (1=urgent..4=low, 0=none) or word urgent/high/medium/low/none. Stored as the int.
- `assignee` (string, optional) — Actor or human owner
- `blocked_by` (array, optional) — Blocking entity refs (project/<proj>/issue/<slug>)

### `project.issue.get`

Read a work-OS issue by slug.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Project key
- `slug` (string, required) — Issue slug

### `project.issue.link`

Edit blocked-by dependencies between work-OS issues. blocks/blocked_by rewrite blocked-by (entity refs); relates is derive-only (soft notice).

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `slug` (string, required) — Source issue slug
- `relation` (string, required, enum: `blocks` | `blocked_by` | `relates`) — Relationship type
- `target` (string, required) — Target issue slug (resolved to its entity)

### `project.issue.list`

List authoritative work-OS issues for a project (drafts excluded), optionally filtered by state or assignee.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Project key
- `state` (string, optional) — Optional work-state filter (backlog|todo|in-progress|done|canceled)
- `assignee` (string, optional) — Optional assignee filter

### `project.issue.update`

Update a work-OS issue (state/priority/review/assignee/blocked_by/description/body); bumps last-verified.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `slug` (string, required) — Issue slug
- `state` (string, optional) — New work state (backlog|todo|in-progress|done|canceled)
- `review` (string, optional, enum: `reviewed` | `draft`) — New review axis value
- `priority` (string, optional) — New priority as a string: int "0".."4" or word urgent/high/medium/low/none. Stored as the int.
- `assignee` (string, optional) — New assignee
- `blocked_by` (array, optional) — Replacement blocking entity refs
- `summary` (string, optional) — Replacement one-line description
- `body` (string, optional) — Replacement body

### `project.migration.apply`

Plan by default; apply canonical Project writes atomically only when apply=true, with resumable audit manifests.

**Mutating:** yes

**Parameters:**

- `apply` (boolean, optional, default: `false`) — Explicitly apply the current deterministic plan (default: false)
- `batch_id` (string, optional) — Safe resumable batch identifier; defaults to the plan hash prefix

### `project.migration.inventory`

Inventory registry, Work-OS, knowledge, legacy work, bindings, leases, and workflow representations without writing.

**Mutating:** no

**Parameters:** none

### `project.migration.plan`

Build a deterministic, hash-guarded Project layout migration plan. This operation is always side-effect free.

**Mutating:** no

**Parameters:** none

### `project.migration.restore`

Preview by default; restore one applied migration manifest only when apply=true and hash preconditions still hold.

**Mutating:** yes

**Parameters:**

- `manifest` (string, required) — Vault-relative manifest under .vault-mind/project-migrations/<batch>/manifest.json
- `apply` (boolean, optional, default: `false`) — Explicitly restore the batch (default: false)

### `project.registry.get`

Resolve a Project reference and return its shared registry entry without mutation.

**Mutating:** no

**Parameters:**

- `ref` (string, optional) — Canonical Project ID, registered alias/slug, or bound workspace path
- `project` (string, optional) — Compatibility alias for ref

### `project.registry.list`

List shared Project identities with local binding health and registry diagnostics.

**Mutating:** no

**Parameters:** none

## `ingest.*` (2)

### `ingest.link.preflight`

Classify a source URL and route it to OPENCLI or MEDIA_TRANSCRIBE. Read-only capability check; capture succeeds only after a provider writes Markdown into the vault.

**Mutating:** no

**Parameters:**

- `url` (string, required) — Absolute source URL to classify
- `preferredProvider` (string, optional, default: `"auto"`, enum: `auto` | `opencli` | `media`) — Override provider routing when needed

### `ingest.providers`

List supported local ingest providers. LLM Wiki routes to OPENCLI for text/web capture and MEDIA_TRANSCRIBE for audio/video parsing, download, and transcription; it does not bundle platform scrapers.

**Mutating:** no

**Parameters:** none

## `source.*` (3)

### `source.get`

Get one Source Registry record by id, canonical URL/path, or original input.

**Mutating:** no

**Parameters:**

- `id` (string, optional) — Source id returned by source.register
- `input` (string, optional) — Original URL or vault-relative path
- `inputType` (string, optional, default: `"url"`, enum: `url` | `vaultPath`) — Input type used when resolving input to a source id

### `source.list`

List Source Registry records, optionally filtered by project, platform, or inputType.

**Mutating:** no

**Parameters:**

- `project` (string, optional) — Filter by project slug
- `platform` (string, optional) — Filter by platform
- `inputType` (string, optional, enum: `url` | `vaultPath`) — Filter by supported input type

### `source.register`

Register a long-lived source in the lightweight Source Registry. URL inputs run ingest preflight only; no download or transcription is executed.

**Mutating:** yes

**Parameters:**

- `input` (string, required) — URL or vault-relative path to register
- `inputType` (string, optional, default: `"url"`, enum: `url` | `vaultPath` | `filePath` | `directoryPath` | `repoPath` | `text`) — Source input type. Phase 1 supports url and vaultPath only.
- `title` (string, optional) — Human-readable source title
- `project` (string, optional) — Optional project slug for project-scoped Source Notes
- `platform` (string, optional) — Optional platform override such as douyin, bilibili, x, youtube
- `sourceKind` (string, optional) — Optional source kind override such as profile, video, post, channel
- `preferredProvider` (string, optional, enum: `opencli` | `media`) — Optional preflight provider preference. Preflight remains read-only.
- `tags` (array, optional) — Optional tags for the Source Note and registry record
- `notes` (string, optional) — Optional operator notes stored in the Source Note

## `workflow.*` (10)

### `workflow.agent.checkpoint`

Record an idempotent Work Run checkpoint, optionally routing output or moving to review/terminal state.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `agent` (string, optional) — Agent id; defaults collaboration actor
- `status` (string, optional, default: `"note"`, enum: `note` | `passed` | `failed` | `blocked`) — Checkpoint status: note|passed|failed|blocked
- `summary` (string, required) — Checkpoint summary
- `evidence` (array, optional) — Evidence refs for this checkpoint
- `next` (string, optional) — Next action or stop condition
- `work_run_id` (string, optional) — Joined Work Run ID; resolved from lifetime when omitted
- `work_run_state` (string, optional, enum: `planned` | `leased` | `running` | `awaiting_review` | `completed` | `failed` | `cancelled`)
- `transition_token` (string, optional) — Idempotency token; generated for legacy calls
- `output_class` (string, optional, enum: `view` | `work-state-transition` | `knowledge-claim` | `external-side-effect`)
- `approval_status` (string, optional, enum: `not-required` | `pending` | `approved` | `denied`)
- `provenance` (array, optional)

### `workflow.agent.doctor`

Check one agent lifetime, Work Run identity, transition receipts, output policy, and event log for consistency.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Project key
- `agent` (string, optional) — Agent id; defaults collaboration actor
- `work_run_id` (string, optional) — Expected Work Run ID for cross-runtime join diagnosis

### `workflow.agent.join`

Assert and join an existing Work Driver lease without overwriting its durable identities.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `agent` (string, optional) — Agent id; defaults collaboration actor
- `role` (string, optional) — Agent role, e.g. manager|worker|reviewer|verifier
- `host` (string, optional) — Agent host, e.g. codex or claude-code
- `objective` (string, optional) — Lifetime objective
- `issue` (string, optional) — Linked issue slug or entity
- `work_run_id` (string, required) — Shared Work Run ID from the Work Driver lease
- `work_run_state` (string, optional, enum: `planned` | `leased` | `running` | `awaiting_review` | `completed` | `failed` | `cancelled`) — Existing Work Run state; leased is expected when attaching a Work Driver lease
- `work_item_id` (string, required) — Canonical project/<slug>/issue/<slug> identity
- `agent_profile_id` (string, optional) — Locked Agent Profile identity asserted against the durable Work Run
- `agent_profile_revision` (number, optional) — Locked positive Agent Profile revision
- `project_agent_binding_id` (string, optional) — Locked Project Agent Binding identity
- `project_agent_binding_revision` (number, optional) — Locked positive Project Agent Binding revision
- `assignment_plan_id` (string, optional) — Approved deterministic Assignment Plan identity
- `assignment_plan_version` (number, optional) — Locked positive Assignment Plan version
- `assignment_plan_fingerprint` (string, optional) — Locked SHA-256 Assignment Plan fingerprint
- `context_envelope_fingerprint` (string, optional) — Locked SHA-256 Context Envelope fingerprint
- `device_snapshot` (object, optional) — Locked portable Device Snapshot used by the Assignment Plan
- `parent_work_run_id` (string, optional) — Exactly one parent Work Run identity for a delegated child
- `lease_mode` (string, optional, default: `"local"`, enum: `local` | `portable-handoff`) — local requires this device active lease. portable-handoff requires a valid expiring handoff token bound to the durable Work Run; any present local lease is still fully validated.
- `handoff_token` (string, optional) — Sensitive secret required only for lease_mode=portable-handoff; never persisted or returned.
- `transition_token` (string, optional) — Stable idempotency token from the Work Driver transition
- `output_class` (string, optional, enum: `view` | `work-state-transition` | `knowledge-claim` | `external-side-effect`)
- `approval_status` (string, optional, enum: `not-required` | `pending` | `approved` | `denied`)
- `provenance` (array, optional) — Logical provenance refs; never local paths or secrets
- `stage` (string, optional, default: `"think"`, enum: `think` | `plan` | `build` | `review` | `test` | `ship` | `reflect`) — Initial lifetime stage: think|plan|build|review|test|ship|reflect. test requires review:* evidence; ship requires review:* and test:* evidence.
- `evidence` (array, optional) — Initial evidence refs. Use prefixes such as review:* and test:* for stage gates.
- `notes` (string, optional) — Join notes

### `workflow.agent.leave`

Leave a Work Run through awaiting-review or terminal state while preserving its durable lifetime and event log.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `agent` (string, optional) — Agent id; defaults collaboration actor
- `summary` (string, optional) — Leave summary
- `work_run_id` (string, optional) — Joined Work Run ID; resolved from lifetime when omitted
- `work_run_state` (string, optional, enum: `awaiting_review` | `completed` | `failed` | `cancelled`) — Final or review handoff state; defaults to cancelled for an unfinished run
- `transition_token` (string, optional) — Idempotency token; generated for legacy calls
- `output_class` (string, optional, enum: `view` | `work-state-transition` | `knowledge-claim` | `external-side-effect`)
- `approval_status` (string, optional, enum: `not-required` | `pending` | `approved` | `denied`)
- `provenance` (array, optional)

### `workflow.agent.start`

Create a restricted manual Work Run without accepting or impersonating Work Driver lease identity fields.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `agent` (string, optional) — Agent id; defaults collaboration actor
- `role` (string, optional) — Agent role, e.g. manager|worker|reviewer|verifier
- `host` (string, optional) — Agent host, e.g. codex or claude-code
- `objective` (string, optional) — Lifetime objective
- `issue` (string, optional) — Linked issue slug or entity
- `transition_token` (string, optional) — Stable idempotency token for retrying manual creation
- `output_class` (string, optional, enum: `view` | `work-state-transition` | `knowledge-claim` | `external-side-effect`)
- `approval_status` (string, optional, enum: `not-required` | `pending` | `approved` | `denied`)
- `provenance` (array, optional) — Logical provenance refs; never local paths or secrets
- `stage` (string, optional, default: `"think"`, enum: `think` | `plan` | `build` | `review` | `test` | `ship` | `reflect`) — Initial lifetime stage: think|plan|build|review|test|ship|reflect. test requires review:* evidence; ship requires review:* and test:* evidence.
- `evidence` (array, optional) — Initial evidence refs. Use prefixes such as review:* and test:* for stage gates.
- `notes` (string, optional) — Manual start notes

### `workflow.agent.step`

Advance a joined agent and its shared Work Run with idempotent transitions, review/test evidence gates, and terminal-state enforcement.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `agent` (string, optional) — Agent id; defaults collaboration actor
- `stage` (string, required, enum: `think` | `plan` | `build` | `review` | `test` | `ship` | `reflect`) — Next lifetime stage
- `status` (string, optional, enum: `active` | `blocked` | `done` | `archived`) — Agent status: active|blocked|done|archived
- `objective` (string, optional) — Replacement objective
- `issue` (string, optional) — Replacement linked issue slug or entity
- `work_run_id` (string, optional) — Joined Work Run ID; resolved from lifetime when omitted
- `work_run_state` (string, optional, enum: `planned` | `leased` | `running` | `awaiting_review` | `completed` | `failed` | `cancelled`)
- `work_item_id` (string, optional) — Replacement canonical Work Item identity
- `transition_token` (string, optional) — Idempotency token; generated for legacy calls
- `output_class` (string, optional, enum: `view` | `work-state-transition` | `knowledge-claim` | `external-side-effect`)
- `approval_status` (string, optional, enum: `not-required` | `pending` | `approved` | `denied`)
- `provenance` (array, optional)
- `evidence` (array, optional) — Evidence refs to merge into lifetime. Use review:* before test and test:* before ship.
- `summary` (string, optional) — Transition summary
- `next` (string, optional) — Next action or stop condition

### `workflow.checkpoint.add`

Append an agent workflow checkpoint under 01-Projects/<project>/workflow/checkpoints.md.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `stage` (string, required, enum: `intake` | `understand` | `plan` | `execute` | `review` | `verify` | `archive`) — Workflow stage for this checkpoint
- `summary` (string, required) — Checkpoint summary
- `status` (string, optional, default: `"note"`, enum: `note` | `passed` | `failed` | `blocked`) — Checkpoint status: note|passed|failed|blocked
- `evidence` (array, optional) — Evidence refs for this checkpoint
- `next` (string, optional) — Next action or stop condition

### `workflow.doctor`

Check whether a project has the vault-first workflow files needed by Codex, Claude Code, and MCP tools.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Project key

### `workflow.state.get`

Read the current vault-first agent workflow state for a project.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Project key

### `workflow.state.set`

Create or update the vault-first agent workflow state at 01-Projects/<project>/workflow/status.md.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Project key
- `stage` (string, required, enum: `intake` | `understand` | `plan` | `execute` | `review` | `verify` | `archive`) — Workflow stage: intake|understand|plan|execute|review|verify|archive
- `objective` (string, optional) — Current project objective
- `branch` (string, optional) — Current execution branch or workstream
- `host` (string, optional) — Agent host, e.g. codex or claude-code
- `evidence` (array, optional) — Evidence refs such as test:, source:, commit:, or path:
- `notes` (string, optional) — Short workflow notes

## `settings.*` (10)

### `settings.assignment.set`

Set one assignment with complete-scope validation and optimistic expected-revision commit.

**Mutating:** yes

**Parameters:**

- `scope` (string, required, enum: `user-device` | `vault` | `workspace-project` | `session`)
- `targetId` (string, optional)
- `key` (string, required)
- `value` (unknown, required)
- `expectedRevision` (number, required)
- `updatedBy` (string, optional)
- `reason` (string, optional)
- `expiresAt` (string, optional)

### `settings.assignment.unset`

Unset one assignment with complete-scope validation and optimistic expected-revision commit.

**Mutating:** yes

**Parameters:**

- `scope` (string, required, enum: `user-device` | `vault` | `workspace-project` | `session`)
- `targetId` (string, optional)
- `key` (string, required)
- `expectedRevision` (number, required)
- `updatedBy` (string, optional)
- `reason` (string, optional)

### `settings.definitions.get`

Get one canonical setting definition by namespaced key.

**Mutating:** no

**Parameters:**

- `key` (string, required)

### `settings.definitions.list`

List the versioned canonical setting definitions and presentation metadata.

**Mutating:** no

**Parameters:** none

### `settings.doctor`

Report evidence-backed available, degraded, unavailable, and disabled capability health.

**Mutating:** no

**Parameters:**

- `context` (object, optional)

### `settings.migrations.plan`

Plan Settings document schema migrations without writing.

**Mutating:** no

**Parameters:**

- `context` (object, optional)

### `settings.scopes.get`

Read one redacted scoped settings document and its revision.

**Mutating:** no

**Parameters:**

- `scope` (string, required, enum: `product` | `user-device` | `vault` | `workspace-project` | `session`)
- `targetId` (string, optional)

### `settings.snapshot.explain`

Explain one effective setting, including precedence, unset scopes, and overridden candidates.

**Mutating:** no

**Parameters:**

- `key` (string, required)
- `context` (object, optional)

### `settings.snapshot.resolve`

Resolve the deterministic redacted Settings Snapshot for a runtime context.

**Mutating:** no

**Parameters:**

- `context` (object, optional)

### `settings.validate`

Validate definitions, complete scope documents, effective values, and cross-setting constraints.

**Mutating:** no

**Parameters:**

- `context` (object, optional)

## `usage.*` (3)

### `usage.append`

Append one immutable Project-attributed Usage Event or replay its existing logical event.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Canonical Project ID or registered compatibility reference
- `event` (object, required) — Versioned privacy-safe Usage Event

### `usage.policy.evaluate`

Evaluate one versioned Project-scoped Usage budget/admission policy over immutable Usage facts.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID or registered compatibility reference
- `policy` (object, required) — Versioned Usage Policy with an exact Project scope
- `from` (string, optional) — Inclusive canonical UTC RFC3339 start
- `to` (string, optional) — Exclusive canonical UTC RFC3339 end

### `usage.project`

Return a deterministic Project-owned Usage projection without mutating the Usage ledger.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID or registered compatibility reference
- `groupBy` (array, optional) — Usage dimensions used to form deterministic groups
- `filters` (object, optional) — Additional Usage dimension filters; Project cannot drift
- `from` (string, optional) — Inclusive canonical UTC RFC3339 start
- `to` (string, optional) — Exclusive canonical UTC RFC3339 end

## `host.*` (14)

### `host.assignment.approve`

Approve one exact pending AssignmentPlan fingerprint under its locked Project Binding and Capability Grant.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Canonical Project ID
- `bindingId` (string, required) — Server-side current Project Agent Binding ID
- `grantId` (string, required) — Server-issued active Child Work Run Capability Grant ID
- `planId` (string, required)
- `expectedFingerprint` (string, required)
- `approvedBy` (string, required)

### `host.assignment.plan`

Create and persist a deterministic pending AssignmentPlan under Project Binding and Capability Grant gates.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Canonical Project ID
- `bindingId` (string, required) — Server-side current Project Agent Binding ID
- `grantId` (string, required) — Server-issued active Child Work Run Capability Grant ID
- `requirement` (object, required)
- `policy` (object, required)
- `devices` (array, optional)
- `plannedAt` (string, optional)

### `host.assignment.read`

Read an AssignmentPlan only through its current Project Binding and Capability Grant.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID
- `bindingId` (string, required) — Server-side current Project Agent Binding ID
- `grantId` (string, required) — Server-issued active Child Work Run Capability Grant ID
- `planId` (string, required)

### `host.connector.list`

List governed connector registrations without resolving credentials or connecting.

**Mutating:** no

**Parameters:**

- `project` (string, optional)

### `host.connector.read`

Read one exact governed connector version with redaction-safe configuration.

**Mutating:** no

**Parameters:**

- `connectorId` (string, required)
- `connectorVersion` (string, required)
- `project` (string, optional)

### `host.connector.register`

Register a governed Host Capability Connector; credentials must remain Secret Reference locators.

**Mutating:** yes

**Parameters:**

- `project` (string, optional) — Canonical Project ID for workspace-project Settings
- `registration` (object, required) — Connector, health, public configuration, and optional Secret Reference locator

### `host.descriptor.list`

List registered Expert Descriptors without connecting to external hosts.

**Mutating:** no

**Parameters:** none

### `host.descriptor.read`

Read one exact Expert Descriptor version.

**Mutating:** no

**Parameters:**

- `descriptorId` (string, required)
- `descriptorVersion` (string, required)

### `host.descriptor.register`

Register an approved versioned Expert Descriptor with health and source observation.

**Mutating:** yes

**Parameters:**

- `registration` (object, required) — Versioned Expert Descriptor registration

### `host.doctor`

Project read-only descriptor, connector, health, Secret Reference, and approved-plan diagnostics without external calls.

**Mutating:** no

**Parameters:**

- `project` (string, optional)

### `host.project`

Project-scoped Host Capability, health, grant visibility, and AssignmentPlan projection without external calls.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID
- `bindingId` (string, required) — Server-side current Project Agent Binding ID
- `grantId` (string, required) — Server-issued active Child Work Run Capability Grant ID

### `host.proxy.describe`

Describe the current granted descriptor and connector bytes without connecting.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID
- `bindingId` (string, required) — Server-side current Project Agent Binding ID
- `grantId` (string, required) — Server-issued active Child Work Run Capability Grant ID
- `descriptorId` (string, required)
- `descriptorVersion` (string, required)

### `host.proxy.invoke`

Invoke one described operation through the persisted approved AssignmentPlan, Project Binding, and Capability Grant.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Canonical Project ID
- `bindingId` (string, required) — Server-side current Project Agent Binding ID
- `grantId` (string, required) — Server-issued active Child Work Run Capability Grant ID
- `planId` (string, required)
- `descriptorId` (string, required)
- `descriptorVersion` (string, required)
- `operation` (string, required)
- `describedDescriptorFingerprint` (string, required)
- `workItemId` (string, optional)
- `input` (unknown, optional)
- `timeoutMs` (number, optional)

### `host.proxy.search`

Search only Project-visible and granted Host Capability descriptors without opening transports.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID
- `bindingId` (string, required) — Server-side current Project Agent Binding ID
- `grantId` (string, required) — Server-issued active Child Work Run Capability Grant ID
- `query` (string, optional)
- `capability` (string, optional)
- `operation` (string, optional)

## `dreamtime.*` (13)

### `dreamtime.approve`

Approve one exact immutable Memory Proposal fingerprint under a manual actor and revision lock.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `proposalId` (string, required)
- `presentedFingerprint` (string, required)
- `expectedRevision` (number, required)
- `transitionToken` (string, required)
- `actor` (string, required)
- `reason` (string, optional)

### `dreamtime.cadence.run`

Explicitly run one due Project-scoped cadence as a canonical Work Run and immutable proposal that remains pending manual approval.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `cadence` (string, required, enum: `daily` | `weekly` | `monthly`)
- `asOf` (string, required)
- `tokenBudget` (number, required)
- `sourceIdentities` (object, required)
- `candidateDiff` (array, required)
- `provenance` (array, required)
- `warnings` (array, optional)
- `expiresAt` (string, required)
- `actor` (string, required)

### `dreamtime.cadence.status`

Compute one disabled-by-default Project-scoped UTC Dream Time cadence window without running a background scheduler.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `cadence` (string, required, enum: `daily` | `weekly` | `monthly`)
- `asOf` (string, required)

### `dreamtime.checkpoint.propose`

Create an immutable proposal-only checkpoint candidate without granting a worker any write, network, or connector authority.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `workerInput` (object, required)
- `candidate` (object, required)
- `actor` (string, required)

### `dreamtime.doctor`

Read proposal, decision, warning, conflict, model-lock, provenance, and revision health without mutating memory.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `profileId` (string, optional)

### `dreamtime.learn.propose`

Create an immutable proposal-only learn candidate without granting a worker any write, network, or connector authority.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `workerInput` (object, required)
- `candidate` (object, required)
- `actor` (string, required)

### `dreamtime.promotion.handoff`

Route a reviewed Dream Time durable-knowledge candidate into the existing quarantined AI-Output Promotion path.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `proposalId` (string, required)
- `proposalFingerprint` (string, required)
- `candidateDiff` (array, required)
- `provenance` (array, required)
- `actor` (string, required)

### `dreamtime.proposal.read`

Read one immutable proposal with its terminal decision lifecycle projected separately.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `proposalId` (string, required)

### `dreamtime.reject`

Reject one exact immutable Memory Proposal fingerprint under a manual actor and revision lock.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `proposalId` (string, required)
- `presentedFingerprint` (string, required)
- `expectedRevision` (number, required)
- `transitionToken` (string, required)
- `actor` (string, required)
- `reason` (string, optional)

### `dreamtime.review.propose`

Create an immutable proposal-only review candidate without granting a worker any write, network, or connector authority.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `workerInput` (object, required)
- `candidate` (object, required)
- `actor` (string, required)

### `dreamtime.revision.current`

Read the current approved Memory Revision for one Project Agent.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)

### `dreamtime.revision.history`

Project immutable Memory Revisions and append-only decision events.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)

### `dreamtime.revision.read`

Read one exact approved Memory Revision identity.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `profileId` (string, required)
- `revisionId` (string, required)

## `consult.*` (1)

### `consult.execute`

Execute one authorized as-of Context Consult and persist only its read-only Artifact Projection.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `request` (object, required)
- `invocationToken` (string, required)
- `workerOutput` (object, required)
- `inputArtifactIds` (array, optional)
- `actor` (string, required)
- `grant` (unknown, optional)

## `delegation.*` (5)

### `delegation.approve`

Approve one exact Delegation Plan and idempotently create one same-Project Child Work Run with an expiring scoped grant.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `planId` (string, required)
- `presentedFingerprint` (string, required)
- `expectedRevision` (number, required)
- `transitionToken` (string, required)
- `approvedExternalClasses` (array, required)
- `actor` (string, required)

### `delegation.artifact.project`

Project one provenance-preserving artifact from a Child Work Run back to its parent review surface.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `workRunId` (string, required)
- `expectedRevision` (number, required)
- `transitionToken` (string, required)
- `actor` (string, required)
- `artifact` (object, required)

### `delegation.plan`

Persist one explicit, reviewable Delegation Plan locked to canonical Project, parent Work Run, Agent, Binding, assignment, budget, and side-effect scope.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `input` (object, required)
- `actor` (string, required)

### `delegation.read`

Read one immutable Delegation Plan and its deterministic Child Work Run projection when approved.

**Mutating:** no

**Parameters:**

- `project` (string, required)
- `planId` (string, required)

### `delegation.transition`

Transition one Child Work Run without inferring any parent terminal state.

**Mutating:** yes

**Parameters:**

- `project` (string, required)
- `workRunId` (string, required)
- `expectedRevision` (number, required)
- `lifecycle` (string, required, enum: `running` | `completed` | `failed` | `cancelled`)
- `transitionToken` (string, required)
- `actor` (string, required)
- `diagnosticArtifact` (object, optional)

## `visual.*` (3)

### `visual.map.apply`

Apply one complete verified VisualEditPlan with replay-safe local receipt semantics.

**Mutating:** yes

**Parameters:**

- `project` (string, required) — Canonical Project ID (project/<slug>)
- `plan` (object, required) — Complete immutable VisualEditPlan
- `presentedFingerprint` (string, required)
- `actor` (string, required)
- `transitionToken` (string, required)

### `visual.map.plan`

Create an immutable, hash-bound visual edit preview without writing.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID (project/<slug>)
- `path` (string, required) — 01-Projects/<slug>/maps/**.md path
- `nextDocument` (object, required) — Complete next MindMapDocument
- `actor` (string, required) — Actor recorded in immutable plan provenance
- `origin` (string, required, enum: `user` | `assistant` | `import`)
- `warnings` (array, optional) — Review warnings retained by the plan

### `visual.map.read`

Read one canonical managed mind-map Markdown section without writing.

**Mutating:** no

**Parameters:**

- `project` (string, required) — Canonical Project ID (project/<slug>)
- `path` (string, required) — 01-Projects/<slug>/maps/**.md path
