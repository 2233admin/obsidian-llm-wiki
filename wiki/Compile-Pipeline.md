# Compile Pipeline

The compile pipeline turns a directory of markdown files into a concept graph and surplus signals. It is a zero-dependency Python module (`compiler/`, stdlib only) invoked by the MCP namespace `compile.*`. This page walks the stages, the data that flows between them, and the four MCP operations that drive them from outside.

---

## Why there is a compile step at all

Repeated from [[Rationale]] axiom 3: compile that only re-formats is not compile. The stages below exist so that the output is not the same information in a different file -- it is new information (resolved aliases, transitive links, orphan and stale flags, contradiction candidates) that the raw markdown did not carry.

---

## Module layout (`compiler/`)

The stdlib-only Python modules, roughly in dependency order:

| Module | Role |
|---|---|
| `_md_parse.py` | Frontmatter + markdown tokeniser. No third-party dep. |
| `chunker.py` | Splits notes into overlap-windowed chunks. Config: `chunk_size`, `chunk_overlap`. |
| `extractor.py` | Pulls wikilinks, aliases, tags, headings, mtime out of each note. |
| `link_discovery.py` | Resolves `[[target]]` to real note paths; handles alias maps, case-folding, missing targets. |
| `concept_graph.py` | Builds `{nodes, edges, orphans, unresolvedLinks}` from the extraction pass. |
| `evaluate.py` | Surplus signals: orphans, stale notes, contradictions, concept coverage gaps. |
| `scheduler.py` | Decides which agent action (compile | emerge | reconcile | prune | challenge) runs next. |
| `frontmatter_generator.py` | Writes computed metadata back into note frontmatter on request. |
| `kb_meta.py` | Top-level catalog state (`_index.md`, `log.md`) per Karpathy LLM Wiki discipline. |
| `compile.py` | Entry point. Orchestrates stages and writes graph to disk. |
| `models.py` | Dataclasses for Node, Edge, GraphSummary, EvaluationReport. |

No embeddings. No LLM calls inside the pipeline. Everything is deterministic text processing. Optional semantic features live in separate adapters; see [[Adapter-Spec]].

---

## Stages

Pipeline flow, roughly:

```
raw .md files
  -> _md_parse (frontmatter + body tokens)
  -> chunker (optional, for downstream semantic adapters)
  -> extractor (links, aliases, tags, headings, mtime)
  -> link_discovery (resolve [[target]] -> path, build alias map)
  -> concept_graph (nodes, edges, orphan/unresolved flags)
  -> evaluate (surplus: stale, contradictions, coverage gaps)
  -> scheduler (which agent action to run next)
  -> graph written back to disk
```

### 1. Parse
`_md_parse.py` reads each `.md` file, splits frontmatter YAML from body, and emits a token stream. Malformed YAML is logged and the file is indexed as body-only; the pipeline does not crash on one bad note.

### 2. Chunk (optional)
`chunker.py` produces overlap-windowed chunks sized by `compiler.chunk_size` / `compiler.chunk_overlap` in `vault-mind.yaml`. Used by the optional `memU` and `vaultbrain` adapters; the core graph build does not need chunks.

### 3. Extract
`extractor.py` walks the parsed token stream and collects, per note:
- wikilinks `[[Target]]` and `[[Target|alias]]`
- declared aliases (`aliases:` in frontmatter)
- tags (inline `#tag` and `tags:` in frontmatter)
- headings (for anchor targets)
- mtime (for stale detection)

### 4. Link discovery
`link_discovery.py` builds a name-to-path map (including aliases) and resolves every `[[target]]` to a real path. Case folding and whitespace normalization live here. Unresolved links become `unresolvedLinks` in the graph summary -- not errors, signals.

### 5. Concept graph
`concept_graph.py` emits the graph structure exposed via `vault.graph`:
- `nodes[]` with `exists` flag
- `edges[]` with `{from, to, count}`
- `orphans[]` -- `.md` files with no inbound wikilinks
- `unresolvedLinks` count

### 6. Evaluate
`evaluate.py` is where surplus is produced. Outputs:
- stale-note candidates (mtime older than threshold + no recent inbound traffic)
- contradiction candidates (same concept, divergent claims across notes)
- coverage gaps (topic folders thinner than their sibling folders)
- orphan + broken-link counts

### 7. Schedule
`scheduler.py` reads the evaluation report and proposes the next agent action. Actions: `compile`, `emerge`, `reconcile`, `prune`, `challenge`. This is the `agent.trigger` MCP operation's brain; see `agent.schedule` for cron-based scheduling.

---

## MCP operations exposed

Four operations, all in the `compile.*` namespace (source: `docs/mcp-tools-reference.md`):

| Operation | Mutating | What it does |
|---|---|---|
| `compile.run` | yes | Run the pipeline. Optional `topic` param scopes to a subdirectory. |
| `compile.status` | no | Current compile state (idle | running | last-run summary). |
| `compile.diff` | no | Show what would change on the next compile (optional `topic` filter). |
| `compile.abort` | yes | Cancel a running compile. Useful when a large vault mid-compile starts pinning CPU. |

`compile.run` is incremental by default -- unchanged nodes are reused. A full rebuild is achieved by deleting the on-disk graph cache and re-invoking.

---

## Where the output lives

The compiler writes its artefacts as plain files alongside the vault (exact path configurable via `vault-mind.yaml`; default is a `.compile/` subdirectory). Filesystem-only. No database.

This is load-bearing: it is what makes headless operation possible. See [[Rationale]] "Why not just a vector database?" and [[Architecture]] for the headless-first invariant.

---

## Performance reference point

On the author's reference vault: 554 notes, 2507 edges, full compile in under 3 seconds on a laptop. Incremental compile of 1-2 edits in under 500 ms. 10k+ note vaults have not been benchmarked -- if you have one, open an issue and we will replace this paragraph with real numbers.

---

## Integration with the agent scheduler

`compile.run` is one of five actions the `agent.*` namespace can trigger:

| Action | When it runs |
|---|---|
| `compile` | Staleness threshold exceeded or scheduler chose it as the primary contradiction. |
| `emerge` | Surplus evaluation found enough new pattern-level signal to propose a synthesis. |
| `reconcile` | Contradiction candidates exceed threshold; agent proposes dry-run merges. |
| `prune` | Orphans + stale exceed threshold; agent proposes dry-run deletions/archives. |
| `challenge` | Concept coverage gap or group of notes that asserts without citation. |

Only `compile` is pure code. The other four emit dry-run proposals for a persona (usually `vault-architect` or `vault-curator`) to review. Nothing mutates the vault without human approval; see [[Security-Model]].

---

## Extending the pipeline

Add a new stage by:

1. Dropping a module into `compiler/` that accepts a `CompileContext` and returns a new field on the report.
2. Registering it in `compile.py` between existing stages.
3. If the stage emits a new kind of signal the agent scheduler should act on, extend `scheduler.py` with a rule.
4. If the stage's output should be queryable from outside, add an MCP operation in the `compile.*` or `query.*` namespace. See [[Architecture]] "Extension points".

---

## See also

- [[Architecture]] -- the compiler is layer 3 of four; this page zooms into that layer.
- [[Rationale]] -- axiom 3 explains why compile must produce surplus.
- [[Adapter-Spec]] -- semantic adapters that consume chunks from this pipeline.
- [[Security-Model]] -- why agent-proposed mutations are dry-run by default.
- `docs/philosophy.md` -- the Aufhebung framing of compile as de-alienation.
- `docs/mcp-tools-reference.md` -- authoritative signatures for the four `compile.*` operations.
