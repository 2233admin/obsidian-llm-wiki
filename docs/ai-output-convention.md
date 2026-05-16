# AI-Output Convention

This document describes the filing layer for role-authored analyses. Sessions in LLMwiki are write-once-read-many by default: each role command (`vault-architect`, `vault-gardener`, ...) can produce a useful analysis and then lose it at session end. The AI-Output convention fixes that by persisting role outputs into a dedicated subtree of the vault with a typed frontmatter schema, status lifecycle, and automated staling policy.

The full design rationale (three-gap analysis, step-ordering, status-transition debate) lives in the corresponding planning notes; this page is the reference for humans working with the resulting files.

## Input gate (Step 2.5 → Step 2.6: warning mode)

`vault.writeAIOutput` flags low-signal writes with structured warnings but **does not reject** them. Step 2.5 originally chose hard-reject with three thresholds; Step 2.6 downgraded to warnings because the thresholds were guesses and rejection was blocking short-but-legitimate analyses before we had real call-distribution data. Plan: collect 2-4 weeks of warning counts via sweep metrics (Step 2.5), then retune or re-promote to reject.

Warnings emitted in the `warnings` field of the write result (always present, empty array when clean):

- **`body-too-short`** — `body` trims to < 50 chars. AI-Output entries usually need enough analysis that a reader can judge the conclusion.
- **`query-looks-like-shell-cmd`** — `parent-query` matches `pwd` / `ls` / `cd` / `cat` / `rg` / `grep` / `echo` / `git status` / `git diff`. Suggests navigation/inspection, not knowledge.
- **`no-anchor`** — both `parent-query` and `sourceNodes` are empty. The entry has no question and no citations.

Each warning also emits a `[writeAIOutput] low-signal persona=… warnings=…` line on stderr for MCP-server log aggregation. `persona` is the current API parameter name; product docs call these role commands.

## Sweep metrics (Step 2.5)

`vault.sweepAIOutput` now returns a `metrics` object alongside candidates:

```json
{
  "metrics": {
    "totalEntries": 42,
    "byPersona": { "vault-architect": 18, "vault-gardener": 9, ... },
    "byStatus": { "draft": 20, "reviewed": 15, "stale": 7 },
    "byQuarantineState": { "new": 35, "reviewed": 5, "promoted": 2 },
    "realBacklinkHitRate": 0.38
  }
}
```

Purpose (from governance-layer §P0.5's "promotion-ready count" signal): future threshold tuning needs evidence. A vault where `realBacklinkHitRate` is <10% suggests the Inbox is producing analyses no human ever cites — the role prompts need tightening, not the stale thresholds. A vault where most entries sit in `quarantine-state: new` after months is a promotion pipeline stall, distinct from a staleness issue.

### Trend log (Step 2.8)

Each `dry_run: false` sweep appends a single flow-style YAML line to `00-Inbox/AI-Output/sweep.log.md`. This turns the metrics snapshot above into a time-series so tuning decisions have evidence not just a point-in-time read:

```yaml
- {ts: "2026-04-22T03:00:00.000Z", totalEntries: 42, staleHits: 3, supersedeHits: 0, realBacklinkHitRate: 0.381}
- {ts: "2026-04-23T03:00:00.000Z", totalEntries: 45, staleHits: 1, supersedeHits: 1, realBacklinkHitRate: 0.400}
```

Dry-run sweeps skip the append (no-write-on-dry-run invariant). Empty-vault sweeps skip too (no need to spam zero-entry lines). The file is created on first non-empty real sweep with a `# Sweep trend log` header.

## Storage layout

```
{vault}/00-Inbox/AI-Output/{role}/YYYY-MM-DD-{slug}.md
```

- `{role}` — one of `vault-architect`, `vault-gardener`, `vault-curator`, `vault-teacher`, `vault-historian`, `vault-janitor`, `vault-librarian`; the MCP API still names this parameter `persona` for backward compatibility
- `{slug}` — auto-derived by `vault.writeAIOutput` from the user's query (first ~6 words, lowercase, kebab-case, filesystem-unsafe chars stripped). Collisions on the same day append `-2`, `-3`, ...

Per-role subdirs keep lint/stale policy local to each role for MVP; if per-content-type differentiation matters more than per-role later, the layout can flatten without a schema change (all required info is in frontmatter).

## Schema (8 fields — 6 required, 2 governance with defaults; human signature on an Obsidian body tag)

```yaml
---
generated-by: vault-architect           # role command / output owner
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
<optional trailing tag: #user-confirmed>  # set by reviewStatus: user-confirmed
```

Each field has a distinct failure mode if absent. None are optional:

| Field | Failure if absent |
|---|---|
| `generated-by` | No per-role aggregation — "show me what architect said" becomes impossible |
| `generated-at` | Rename/move strips mtime; age judgments become fiction |
| `agent` | Cross-model quality regression becomes undiagnosable |
| `parent-query` | Reader sees the conclusion without knowing why the analysis was requested |
| `source-nodes` | Reverse-linking (`vault.backlinks` onto this entry's citations) breaks |
| `status` | Inbox accumulates as WORM; no lifecycle management is possible |
| `scope` | Cross-project leakage risk — entries mint as `project` if caller doesn't specify |
| `quarantine-state` | Trust gate collapses into content-lifecycle (Step 1 bug); promotion becomes ungoverned |

> Human confirmation is stored as an Obsidian body tag `#user-confirmed`, not a frontmatter field. See *human signature* below.

### `scope` vs `status` vs `quarantine-state` — three axes + body tag

Step 2 (Appendix D of the governance plan) splits what Step 1 tried to encode in `status` alone. They move independently:

- `scope` — **namespace** of the entry. `project` = this repo only (default). `global` = user-stable fact (e.g. "Curry prefers Bun over npm"). `cross-project` = generalisable pattern. `host-local` = machine-specific (paths, env).
- `status` — **content timeliness**. Does this analysis still reflect the vault's current state? Gardener sweeps the age+anchor axis here.
- `quarantine-state` — **machine trust gate**. Gardener's model of maturity along the candidate lifecycle (`new → reviewed → promoted`, or `discarded`). An entry can be `status: reviewed` (content-useful) but `quarantine-state: new` (not yet vetted for cross-project promotion). `quarantine-state: promoted` is the gate for Step 3 durable-memory injection.
- `#user-confirmed` (body tag) — **human signature**. Curry explicitly signed off — not an automated gardener advance. Rides on Obsidian's native tag infrastructure: `vault.searchByTag user-confirmed` returns the set for free, no frontmatter field needed. The source of truth remains `history[].trigger == manual-user-confirmed-write`; the tag is the index, the history row is the audit trail. Passing `reviewStatus: user-confirmed` to `vault.writeAIOutput` appends the tag at body end (idempotent).

Rationale for defaults: `scope=project` keeps entries local unless the caller opts into wider namespace; `quarantine-state=new` means no automatic machine-promotion; absence of the `#user-confirmed` tag means no human signature yet — the write op never auto-claims one, only explicit `reviewStatus: user-confirmed` or a manual-user-confirmed-write history append (with a matching hand-added tag) does.

### `history` — structured audit trail

Any state transition MUST append a flow-style item to the `history:` array. `vault.sweepAIOutput` does this automatically for `draft → stale` flips; human-driven transitions (`draft → reviewed`, `reviewed → superseded`, any `quarantine-state` change) are expected to edit the frontmatter by hand and MUST also append an entry.

```yaml
history:
  - {ts: "2026-04-22T10:00:00.000Z", axis: status, from: draft, to: stale, trigger: auto-stop-summary, evidence_level: low, human_in_loop: false, note: "gardener sweep"}
  - {ts: "2026-04-23T15:14:00.000Z", axis: status, from: stale, to: reviewed, trigger: manual-review-approve, evidence_level: high, human_in_loop: true, note: "Curry kept"}
  - {ts: "2026-04-25T08:00:00.000Z", axis: quarantine-state, from: new, to: promoted, trigger: manual-promote, evidence_level: high, human_in_loop: true, note: "cross-project reusable"}
```

Why flow style (`{key: val, ...}`) rather than block style (`  - ts: ...\n    from: ...`): the current frontmatter parser only handles scalar-array items. Flow style round-trips as an opaque string, preserving the item byte-for-byte on subsequent reads. When the parser graduates to full nested YAML, the flow syntax remains valid — no migration needed.

Required fields in a history entry (enum values from the governance plan):

| Field | Values |
|---|---|
| `ts` | ISO 8601 UTC timestamp of the transition |
| `axis` | `status` \| `quarantine-state` — names which governance axis the entry moved along. Added in Step 2.7 because `from: reviewed, to: promoted` alone was ambiguous (both axes have a `reviewed` value) |
| `from` / `to` | the before/after value on `axis` |
| `trigger` | `auto-stop-summary` / `auto-observation-pattern` / `manual-promote` / `manual-review-approve` / `manual-user-confirmed-write` / `migration-import` |
| `evidence_level` | `low` (can't rise above `project` scope) / `medium` / `high` |
| `human_in_loop` | bool |
| `note` | ≤2 sentences; free-form justification |

The full relevance/trust gate schema (from `agent-memory-runtime`) is tracked in the project-governance plan — Step 2 records only the fields above; later phases may extend entries with `namespace_basis`, `relevance_basis`, `trust_basis` without breaking existing files.

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

1. Age (from `generated-at`) exceeds the per-role threshold, and
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

## Stale thresholds (per-role, days)

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

These are initial guesses, intentionally hardcoded in `mcp-server/src/index.ts` for MVP. When usage produces enough data to show per-role differences are real (or unreal), they can graduate to `vault-mind.yaml` config. Don't tune them speculatively — let the sweep reports tell you which numbers are wrong.

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

Invoke the `vault-gardener` role. Its skill file instructs it to call `vault.sweepAIOutput({ dry_run: true })`, show results, ask for confirmation, then call with `dry_run: false` if you approve.

### Is there a way to see what the sweep did without running it?

Yes — `dry_run: true` (the default) returns exactly what would change without writing anything. Same output shape; `applied` array is empty on dry run.

## Related reading

- `docs/mcp-tools-reference.md` — auto-generated reference for all MCP tools including `vault.writeAIOutput` and `vault.sweepAIOutput`
- `skills/vault-*.md` — each role skill file documents the exact params to pass to `vault.writeAIOutput`
- `skills/vault-gardener.md` — the sweep-invocation instructions and the review-before-apply contract
