# AI-Output Convention

This document describes the sediment layer for persona analyses. Sessions in LLM Wiki Bridge are write-once-read-many by default: each persona (`vault-architect`, `vault-gardener`, ...) can produce a useful analysis and then lose it at session end. The AI-Output convention fixes that by persisting persona outputs into a dedicated subtree of the vault with a typed frontmatter schema, status lifecycle, and automated staling policy.

The full design rationale (three-gap analysis, step-ordering, status-transition debate) lives in the corresponding planning notes; this page is the reference for humans working with the resulting files.

## Storage layout

```
{vault}/00-Inbox/AI-Output/{persona}/YYYY-MM-DD-{slug}.md
```

- `{persona}` — one of `vault-architect`, `vault-gardener`, `vault-curator`, `vault-teacher`, `vault-historian`, `vault-janitor`, `vault-librarian`
- `{slug}` — auto-derived by `vault.writeAIOutput` from the user's query (first ~6 words, lowercase, kebab-case, filesystem-unsafe chars stripped). Collisions on the same day append `-2`, `-3`, ...

Per-persona subdirs keep lint/stale policy local to each persona for MVP; if per-content-type differentiation matters more than per-persona later, the layout can flatten without a schema change (all required info is in frontmatter).

## Schema (8 fields — 6 required, 2 governance with defaults)

```yaml
---
generated-by: vault-architect           # one of the 7 personas
generated-at: 2026-04-21T14:32:00.000Z  # ISO 8601 UTC; primary age signal
agent: claude-opus-4-7                  # model identifier, version included
parent-query: "user's original ask"     # ≤ 200 chars, verbatim, no fm reserved chars
source-nodes:                           # wikilinks cited during analysis; [] valid
  - "[[auth-architecture]]"
  - "[[session-tokens]]"
status: draft                           # draft | reviewed | stale | superseded
scope: project                          # project | global | cross-project | host-local
quarantine-state: new                   # new | reviewed | promoted | discarded
---

<body markdown, no frontmatter block inside>
```

Each field has a distinct failure mode if absent. None are optional:

| Field | Failure if absent |
|---|---|
| `generated-by` | No per-persona aggregation — "show me what architect said" becomes impossible |
| `generated-at` | Rename/move strips mtime; age judgments become fiction |
| `agent` | Cross-model quality regression becomes undiagnosable |
| `parent-query` | Reader sees the conclusion without knowing why the analysis was requested |
| `source-nodes` | Reverse-linking (`vault.backlinks` onto this entry's citations) breaks |
| `status` | Inbox accumulates as WORM; no lifecycle management is possible |
| `scope` | Cross-project leakage risk — entries mint as `project` if caller doesn't specify |
| `quarantine-state` | Trust gate collapses into content-lifecycle (Step 1 bug); promotion becomes ungoverned |

### `scope` vs `status` vs `quarantine-state` — three orthogonal axes

Step 2 (Appendix D of the governance plan) splits what Step 1 tried to encode in `status` alone. They move independently:

- `scope` — **namespace** of the entry. `project` = this repo only (default). `global` = user-stable fact (e.g. "Curry prefers Bun over npm"). `cross-project` = generalisable pattern. `host-local` = machine-specific (paths, env).
- `status` — **content timeliness**. Does this analysis still reflect the vault's current state? Gardener sweeps the age+anchor axis here.
- `quarantine-state` — **trust gate** (from the agent-memory-runtime governance model). An entry can be `status: reviewed` (content-useful) but `quarantine-state: new` (not yet vetted for cross-project promotion). A `quarantine-state: promoted` entry is the gate for Step 3 durable-memory injection.

Rationale for defaults: `scope=project` keeps entries local unless the caller opts into wider namespace; `quarantine-state=new` means no automatic promotion — a human (or future gardener policy) must flip to `reviewed`/`promoted`.

## Status lifecycle

Exactly three transitions are legal:

```
draft ────────► reviewed          (manual — human decides)
  │
  └────────────► stale             (automatic — gardener sweep)

reviewed ─────► superseded         (semi-automatic — gardener proposes, human confirms)
```

Any other transition is invalid. Backward transitions (`reviewed → draft`, `stale → draft`) are not supported by the sweep op — if you disagree with a stale flip, edit the file by hand.

### `draft → reviewed`

Curry (or the vault owner) manually flips `status: draft` to `status: reviewed` after reading the entry and judging it correct / useful. No automation — the human is the only reliable verdict source.

### `draft → stale` (auto)

Run by `vault.sweepAIOutput({ dry_run: false })`. Flips when **both** conditions hold:

1. Age (from `generated-at`) exceeds the per-persona threshold, and
2. No non-AI-Output file in the vault contains a wikilink to this entry.

"Non-AI-Output" means: source file's own frontmatter does **not** carry a `generated-by` key. AI-Output entries citing each other form self-anchoring hallucination chains; they do not count as anchor votes.

### `reviewed → superseded`

The sweep op **reports** candidates but never applies. A candidate is a pair (older, newer) where:

- Both are `status: reviewed`
- Both have the same `generated-by`
- Both have non-empty `source-nodes`
- Jaccard overlap of their source-nodes ≥ 0.6
- Newer has later `generated-at` (with mtime as fallback)

The human reads the candidate list and manually flips the older entry's frontmatter to `status: superseded`, typically after writing a `[[...]]` reference from the newer entry back to the older one in the body.

## Stale thresholds (per-persona, days)

```
vault-architect   45
vault-gardener    30
vault-historian  180
vault-librarian   60
vault-curator     60   (catch-all)
vault-teacher     60   (catch-all)
vault-janitor     60   (catch-all)
any other         60   (catch-all)
```

These are initial guesses, intentionally hardcoded in `mcp-server/src/index.ts` for MVP. When usage produces enough data to show per-persona differences are real (or unreal), they can graduate to `vault-mind.yaml` config. Don't tune them speculatively — let the sweep reports tell you which numbers are wrong.

Rationale for current picks:

- **architect (45d)** — technical judgments iterate but not weekly
- **gardener (30d)** — health reports are inherently periodic; old ones are noise
- **historian (180d)** — factual timelines age slowly; half-year gate is a "nobody ever cited this" filter, not a truth decay
- **librarian (60d)** — retrieval synthesis; medium shelf life
- **catch-all (60d)** — default until content shows it should differ

## FAQ

### Who flips `reviewed`?

You. Manually. Edit the frontmatter in Obsidian or any text editor, change `status: draft` → `status: reviewed`. Gardener never promotes.

Rationale: the value of `reviewed` is that a human signed off. AI self-review is a second layer of the same hallucination.

### What counts as a backlink for the stale rule?

A wikilink `[[...]]` from any `.md` file in the vault **whose own frontmatter lacks a `generated-by` key**. That means:

- ✅ A hand-written note in `notes/` linking to the AI-Output — counts.
- ✅ A PROJECT.md, README.md, etc. linking to it — counts.
- ❌ Another AI-Output file citing it — does NOT count.

### Why exclude AI→AI references?

Two AI-Output entries can happen to cite each other without either being grounded in anything Curry actually cares about. If they were allowed to anchor each other, neither would ever stale — the Inbox would fill with mutually-self-anchoring noise. The non-AI-Output test forces at least one human "this is worth keeping" signal.

### What if I deleted the source note — does the AI-Output go stale?

Yes. When the original note disappears, the wikilink in the AI-Output becomes broken (detectable via `vault.lint`), and the backlink disappears from the sweep's count. That's intended: an AI-Output that cited notes which no longer exist has lost its anchor.

### Can an AI-Output itself be linked from a human note, graduate to `reviewed`, and then stop being AI-Output?

The AI-Output convention lives in the frontmatter, not the path. If you promote a useful AI-Output to a "real" note, the right move is to **move** it (e.g., via `vault.rename`) out of `00-Inbox/AI-Output/` into its proper topic folder, and strip or rename the `generated-by` key so it no longer counts as AI-Output. After that, sweep stops caring about it.

### What happens to `stale` entries — are they deleted?

No. Staling is a soft signal, not deletion. `status: stale` just means "age+anchor test failed." Use `vault.searchByFrontmatter status=stale` to find them; review them; either promote (edit the file, move it out of AI-Output, set non-stale status), or archive (move to `00-Inbox/AI-Output/.archive/` or delete manually). The sweep does not auto-delete.

### How do I tell the gardener to run a sweep?

Invoke the `vault-gardener` persona. Its skill file instructs it to call `vault.sweepAIOutput({ dry_run: true })`, show results, ask for confirmation, then call with `dry_run: false` if you approve.

### Is there a way to see what the sweep did without running it?

Yes — `dry_run: true` (the default) returns exactly what would change without writing anything. Same output shape; `applied` array is empty on dry run.

## Related reading

- `docs/mcp-tools-reference.md` — auto-generated reference for all MCP tools including `vault.writeAIOutput` and `vault.sweepAIOutput`
- `skills/vault-*.md` — each persona's skill file documents the exact params to pass to `vault.writeAIOutput`
- `skills/vault-gardener.md` — the sweep-invocation instructions and the review-before-apply contract
