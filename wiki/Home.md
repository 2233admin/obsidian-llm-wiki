# Home

LLM Wiki Bridge (`obsidian-llm-wiki`) is a headless-first MCP server that compiles a markdown vault into a concept graph and exposes it as tools to any MCP-compatible agent. This wiki is the accumulation asset: design decisions, rationale, adapter spec, and FAQ. The `README` is the pitch; the wiki is the explanation.

---

## What this repo is

- A Node/TypeScript MCP server (`mcp-server/`) speaking stdio to Claude Code, Codex, OpenCode, Gemini CLI, and any other MCP host.
- A Python zero-dep compiler (`compiler/`) that turns wikilinks, aliases, tags, and frontmatter into a concept graph.
- Four pluggable adapters (`adapters/`): `filesystem` (always-on), `obsidian` (optional, via separate bridge plugin), `memU` (optional semantic), `gitnexus` (optional code-aware).
- Six agent personas that ship as skills: `vault-librarian`, `vault-architect`, `vault-curator`, `vault-teacher`, `vault-historian`, `vault-janitor`.

v2.0.0 shipped 2026-04-21. Tag `v2.0.0` points at commit `d141e3a`.

---

## What this repo is not

- Not an Obsidian plugin. It does not need Obsidian running. The filesystem adapter is the floor and is always available.
- Not a vector database. For semantic similarity at scale, enable the optional `memU` adapter.
- Not a code-understanding tool. It indexes text, wikilinks, and structure.
- Not a bidirectional real-time sync with Obsidian. The `obsidian` adapter requires the companion `obsidian-vault-bridge` plugin to be running; without it, `filesystem` still works.

See [[Rationale]] for why these non-goals are non-goals, not "coming soon".

---

## Who this wiki is for

| Reader | Start here |
|---|---|
| User who cloned the repo and wants to know what they got | `README.md` at repo root |
| User deciding whether to clone | `README.md`, then [[Rationale]] |
| Contributor sizing up an adapter or new namespace | [[Architecture]], then [[Adapter-Spec]] |
| Agent host integrator (Claude Code / Codex / others) | `docs/GUIDE.md`, then [[Architecture]] |
| Curious user ("why not just grep?") | [[Rationale]] |
| Stuck user ("does it need Obsidian?") | [[FAQ]] |

The repo `README` stays short and sales-y on purpose. Depth lives here.

---

## Page map

- **[[Architecture]]** -- Four-layer system diagram, request lifecycle, data model, extension points.
- **[[Rationale]]** -- Why this exists: not-just-grep, not-just-a-plugin, not-just-embeddings. Honest about product drift.
- **[[FAQ]]** -- Common questions. v1 draft -- will be wrong in spots until real users surface real questions.
- **[[Adapter-Spec]]** -- Adapter contract, capability matrix, failure modes, recipe for adding a fifth adapter.

Pages not yet written (leave stubs as `[[Page-Name]]` and add them when the question arrives):

- `[[Compile-Pipeline]]` -- link discovery, graph build, surplus evaluation stages.
- `[[Persona-Design]]` -- why six personas, how they share vs specialise MCP tool usage.
- `[[Security-Model]]` -- dry-run default, protected dirs, preflight gates.
- `[[Recipes]]` -- content collectors (napcat-to-vault, x-to-vault, etc.) and how to author one.

---

## Conventions used in this wiki

- ASCII punctuation. `--` not em-dash, `->` not unicode arrow, straight quotes. Keeps Windows tooling happy and diffs clean.
- `[[Page-Name]]` Obsidian-style wikilinks. GitHub Wiki resolves these natively. Same syntax works if you clone the wiki into a local vault.
- Exact MCP operation names, e.g. `vault.search`, `query.unified`. Authoritative list: `docs/mcp-tools-reference.md` in the main repo. Do not invent operations here.
- No emojis. No "Let me explain". Open with the answer.

---

## If you only read one thing

Read [[Rationale]]. The README tells you what this does. The rationale tells you why the shape is the shape and what we are not pretending to solve. Everything else in this wiki is downstream of those two choices.

---

## See also

- [[Architecture]]
- [[Rationale]]
- [[FAQ]]
- [[Adapter-Spec]]
- `README.md` (repo root) -- the 30-second pitch.
- `docs/GUIDE.md` / `docs/GUIDE.zh-CN.md` -- bilingual user guide.
- `docs/mcp-tools-reference.md` -- auto-generated MCP operation catalog.
- `docs/philosophy.md` -- design philosophy (Aufhebung, surplus, contradiction-driven agent scheduling).
