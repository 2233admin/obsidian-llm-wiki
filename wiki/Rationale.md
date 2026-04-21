# Rationale

This page answers "why does this exist at all, when X already does most of it?" for four values of X: `grep`, an Obsidian plugin, a vector database, and an LLM with a long context window. It also names the product-positioning drift we are watching and have not resolved, so future readers know which parts are stable and which parts will be rewritten.

---

## Why not just grep?

Seeded from `docs/WHY_NOT_JUST_GREP.md`. Four reasons, ordered by how much they matter:

1. **Grep finds substrings. This finds concepts.**
   Grep matches characters. `vault.search` matches wikilinks `[[attention-heads]]`, resolves aliases declared in frontmatter, and traverses tags. A query for "attention" returns every note that mentions or relates to the concept, including notes titled `A3: KV-Cache Optimization` with alias `kv-cache` that never type the word "attention" at all.

2. **Grep is stateless. This is compiled.**
   Grep scans on every invocation; the 1000th query costs as much as the first. The compiler builds the concept graph once -- 554 notes, 2507 edges, under 3 seconds in the reference vault -- and subsequent `vault.backlinks`, `vault.graph`, `query.unified` calls reuse it.

3. **Grep outputs text. This outputs MCP tools.**
   Grep returns filenames and line numbers. `vault.search` returns structured results: path, title, matched snippet, backlink count, frontmatter tags, mtime. The agent uses the structure to decide what to read next and what to cite. Grep gives the agent raw text to parse; MCP gives it a data model.

4. **Grep is for you. This is for your agent.**
   When you grep, you interpret. When Claude Code runs `/vault-librarian what do I know about X`, the agent calls `vault.search` and `vault.read` directly, reads the cited notes, and answers with evidence. The grep equivalent is the agent pasting a grep hit-list into its context window and guessing. We would rather the agent call `vault.backlinks` than guess.

If you have 10 notes and never re-visit them, grep is fine. This starts earning its weight somewhere between 100 and 500 notes.

---

## Why not just an Obsidian plugin?

Obsidian plugins are a known good shape. They run in Obsidian's process, get access to its API, and ship through Community Plugins. Several knowledge-base MCP servers take that shape.

We did not, for three reasons:

1. **Headless-first.** Agents run on servers, in CI, in background schedulers, on machines where Obsidian is not installed. A plugin that requires Obsidian Desktop to be the frontmost application is a non-starter for that workflow. The filesystem adapter is the floor; you can use the MCP server with zero Obsidian involvement on a vault stored as a plain markdown directory.

2. **Separation of runtime and editor.** The vault is text files on disk; Obsidian is a viewer and an authoring tool. Treating the editor as the runtime conflates two concerns and makes the thing fragile in the way Electron apps are fragile. Headless compilation plus MCP transport keeps the runtime honest.

3. **Plugin API surface is a moving target.** Obsidian versions change the plugin API periodically; a plugin-first approach inherits that churn. The filesystem contract (markdown, wikilinks, frontmatter) is older than Obsidian and will outlive it.

The trade-off: features that genuinely require the Obsidian API (graph view internals, workspace state, live preview rendering) cannot be done headless. For those, the optional `obsidian` adapter talks WebSocket to a running Obsidian Desktop via the companion `obsidian-vault-bridge` plugin.

### Product drift we are watching

Honest note: the positioning between this repo (`obsidian-llm-wiki`, headless MCP) and its sibling (`obsidian-vault-bridge`, Obsidian plugin) is not fully settled. The bridge is being repositioned to absorb more plugin-mediated commands as their scope becomes clearer -- discovery, event streams, DB writes -- rather than being a thin transport for plugin API calls. If that direction holds, this Rationale page will be rewritten, not patched, because the "why not a plugin" framing loses some force when the plugin ingests more of what used to live here.

What stays stable regardless: the filesystem adapter is still the floor, headless is still the default, and users who never install the bridge still get a working system. If you are reading this wiki six months after v2.0.0, check `docs/ICEBOX.md` and the most recent commits on both repos before trusting the sharp edges of this argument.

---

## Why not just a vector database?

Embedding-based semantic search is powerful and we are not arguing against it. We are arguing against it as the default:

- **Small vaults do not need it.** Under a few thousand notes, wikilinks plus aliases plus tags plus ranked filesystem search cover the ground that embedding retrieval would cover, with zero infrastructure.
- **Embeddings lose structure.** A concept graph carries directed relationships (A links to B, not the reverse), frontmatter, and orphan/stale signals. A vector index flattens all of that into cosine distance. Both are useful; only one of them knows that note A cites note B.
- **Embeddings drift.** Re-embedding on every edit is expensive. Stale embeddings silently degrade answer quality.

When you do want semantic similarity, the optional `memU` adapter is a pgvector-backed store you enable in config. It participates in `query.unified` with tunable weights. See [[Adapter-Spec]].

---

## Why not just dump the vault into a long-context LLM?

Three reasons:

1. **Cost.** A 5000-note vault at ~1 KB average is ~5 MB of markdown. Every turn of the conversation that pays the token cost of those 5 MB is money and latency.
2. **Citations.** LLMs without tool-call grounding hallucinate which note said what. Tool-call citations are verifiable; context-window paraphrases are not.
3. **Freshness.** The vault is edited while the agent is running. A compiled graph plus per-call `vault.read` sees today's edits; a stuffed-context approach sees whatever you pasted at conversation start.

Long-context is complementary, not a replacement. Use both.

---

## What we claim this solves

- Finding notes by concept, not character string.
- Following backlinks and resolving aliases without manual work.
- Letting an agent cite evidence instead of paraphrasing from memory.
- Lint-style hygiene: orphans, broken wikilinks, duplicates, stale notes.
- Vault-wide refactor suggestions from a concept graph, with dry-run gates on every mutation.

## What we do not claim this solves

- Understanding code inside your notes. Text only.
- Replacing a vector DB at scale. Enable `memU` if you need that.
- Bidirectional real-time sync with Obsidian. The bridge approximates it; it is not a database replication protocol.
- Reading your mind. The concept graph is only as good as the structure you put into your notes.

---

## Design axioms (short list)

These are the non-negotiables. Anything in this wiki that contradicts them is wrong and should be corrected, not the axiom.

1. **Filesystem is the floor.** If a feature requires anything other than a directory of markdown files, it is optional, not default.
2. **Dry-run by default for mutations.** Every `vault.create | vault.modify | vault.delete | vault.rename | vault.mkdir | vault.append` defaults `dryRun=true`. The user opts into writes.
3. **Compile produces surplus.** Compile that only re-formats is not compile. The concept graph must surface relationships, contradictions, or synthesis that the raw notes did not.
4. **Agent calls tools, not paragraphs.** The MCP surface is the contract. Personas are opinionated prompts on top; they do not bypass the tools.
5. **Headless-first is a runtime invariant, not a marketing slogan.** Every release validates that `filesystem`-only works end-to-end.

---

## See also

- [[Home]] -- what lives where.
- [[Architecture]] -- how the four layers cash out the axioms above.
- [[FAQ]] -- the 1-line versions of some of these arguments.
- [[Adapter-Spec]] -- the `memU` and `obsidian` adapter contracts that this page gestures at.
- `docs/WHY_NOT_JUST_GREP.md` -- the seed document this Rationale's section 1 is built on.
- `docs/philosophy.md` -- the deeper philosophical motivation (Aufhebung, surplus, contradiction).
