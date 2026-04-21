# Persona Design

The README advertises six personas. The `skills/` directory contains seventeen skill files. This page reconciles the two numbers, explains why personas are opinionated wrappers over a shared MCP surface instead of distinct capabilities, and documents the design discipline that keeps them from collapsing into one generic agent.

---

## Six personas vs seventeen skills

The six **personas** in `README.md`:

| Persona | Role | Primary MCP tools |
|---|---|---|
| `vault-librarian` | reads, searches, cites from the vault | `vault.search`, `vault.read`, `vault.list` |
| `vault-architect` | compiles concept graph, suggests refactors | `vault.graph`, `vault.backlinks`, `compile.run` |
| `vault-curator` | orphans, dead links, duplicates, stale notes | `vault.lint`, `vault.searchByTag`, `vault.search` |
| `vault-teacher` | explains a note in context of its neighbors | `vault.backlinks`, `vault.read`, `vault.graph` |
| `vault-historian` | answers "what was I thinking on date X" | `vault.searchByFrontmatter`, `vault.stat`, `vault.search` |
| `vault-janitor` | dry-run cleanups | `vault.lint`, `vault.delete` (dry), `vault.rename` (dry) |

The other eleven files in `skills/` are **support skills** -- workflow-shaped scripts that personas compose rather than standalone personas you invoke directly:

| Support skill | Composed by |
|---|---|
| `vault-ingest` | called by `vault-librarian` or `vault-architect` when a new source arrives |
| `vault-emerge` | agent scheduler's `emerge` action |
| `vault-reconcile` | agent scheduler's `reconcile` action |
| `vault-challenge` | agent scheduler's `challenge` action |
| `vault-gardener` | routine hygiene, composed by `vault-curator` |
| `vault-graduate` | concept promotion from scratch-notes to top-level |
| `vault-health` | diagnostic report, composed by `vault-architect` |
| `vault-connect` | cross-domain synthesis |
| `vault-bridge` | bridge-plugin-mediated ops (see [[Adapter-Spec]] obsidian adapter) |
| `vault-save` | writes output with provenance, composed by any persona authoring into the vault |
| `vault-world` | global briefing / across-vault state |

Personas are invoked with a slash: `/vault-librarian`. Support skills are called as subroutines by the personas or the agent scheduler; users typically do not invoke them directly. The split is a design choice, not an accident -- see the next section.

---

## Why split instead of one persona

One generic persona would either:

- Bloat its own system prompt trying to describe every tool-call pattern, or
- Lose the specialization that lets `vault-librarian` privilege `vault.search` + `vault.read` while `vault-curator` privileges `vault.lint` + orphan-hunting.

Six personas, each with a short and opinionated prompt, hit a better quality-per-token ratio than one sprawling prompt. Same MCP surface -- it is the opinions that differ, not the capabilities.

This is the same argument at the skill level: `vault-ingest` is a thousand-line workflow (search vault, classify sources, rewrite notes, generate synthesis pages). Inlining it into `vault-librarian`'s persona prompt would make every librarian call carry that weight. Splitting it keeps the persona prompt thin and the workflow reusable.

---

## Design discipline

Five rules the personas hold to. Violations are how a persona drifts into being a different persona.

1. **Tools, not prose.** Every persona prompt ends with "call X, Y, Z first, then reason about the results". The persona does not answer from model knowledge; it answers from what `vault.search` returned. Bypassing the MCP surface is a bug.

2. **One-thing-well primary tool.** Each persona declares its primary tool in its description. `vault-librarian` is a read persona; `vault-curator` is a lint persona. A librarian that starts proposing deletions is drifting.

3. **Dry-run default inherited.** All mutating operations default `dryRun=true` at the MCP level (see [[Security-Model]]). Persona prompts do not override this. A persona that routinely sets `dryRun=false` without user confirmation is a broken persona.

4. **Language match.** Persona reports match the user's vault language, declared in the vault's `_CLAUDE.md` file. Chinese vaults get "## 摄入报告：" not "## Ingestion Report:".

5. **Cite or stay silent.** Every factual claim a persona emits about vault content carries a `[[wikilink]]` or file-path citation. If the persona cannot cite, it says so instead of paraphrasing from the context window.

---

## Adding a new persona

Checklist:

1. Pick a job the six personas do not already cover. Duplication is a smell.
2. Declare the primary MCP tool in one line. If you cannot, the persona is not specialised enough.
3. Write the prompt as short as possible -- the goal is "decide which tool to call when", not "explain every MCP operation".
4. Drop the file in `skills/vault-<name>.md` with the `---\nname: vault-<name>\ndescription: >\n  ...\n---` header used by the other skills.
5. Run `./setup --host <your-agent-host>` -- setup copies the `skills/` bundle into the host's skills directory.
6. Test against a real vault before opening a PR.

Adding a support skill is the same shape, but the description should make clear that it is a subroutine composed by personas rather than a user-facing entry point.

---

## Why the agent scheduler matters here

Personas are user-invoked. The agent scheduler (`agent.*` namespace: `agent.trigger`, `agent.schedule`, `agent.status`, `agent.history`) is the autonomous side. When scheduled, it fires actions -- `compile | emerge | reconcile | prune | challenge` -- which compose support skills the same way personas do. The shared skill library is the reason the autonomous loop and the interactive personas produce consistent outputs: both are working through the same composable vocabulary.

See [[Compile-Pipeline]] for the scheduler's input (evaluation report) and the action dispatch logic.

---

## See also

- [[Home]] -- where personas sit in the overall system.
- [[Architecture]] -- the MCP tool surface personas operate on.
- [[Compile-Pipeline]] -- the agent scheduler that composes support skills autonomously.
- [[Security-Model]] -- the dry-run discipline every persona inherits.
- [[FAQ]] "Why six personas and not one?" -- the short version of the argument above.
- `skills/` (repo) -- the 17 skill files themselves.
- `README.md` persona table -- the six user-facing entry points.
