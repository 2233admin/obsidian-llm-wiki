# Icebox Triage — 2026-04-25 (data-driven)

Triage decisions for `docs/ICEBOX.md` v3-or-kill items, **anchored on
the 2026-04-25 retrieval baseline** (`eval/baseline-{fs,vector}-2026-04-25.md`).

## Baseline-driven triage framework

Today's baseline data:

| metric | filesystem | vault-vector | delta |
|---|---|---|---|
| recall@5 | 0.400 | **0.547** | **+14.7 pp** (+37% rel.) |
| MRR | 0.405 | **0.570** | **+16.5 pp** |
| entity-group r@5 | 0.438 | **0.750** | **+31.3 pp** |

**Structural finding**: obsidian-llm-wiki has 6 adapters but **no
mainlined vault-file vector adapter**. `qmd.ts` requires contributor
install + index; `memu.ts` indexes conversation summaries, not vault
files; `filesystem.ts` is keyword only. RRF fusion (sessions 9-11)
has been merging "filesystem keyword + memu conversation", **not
"keyword vs vault-semantic"**. The vault-semantic path is currently
absent from the fusion pool by default.

This reframes triage priorities:

- **vault-retrieval / semantic-related items**: high ROI, promote
- **persona-prompt cosmetics**: low ROI, kill (strip the line) or defer
- **already-strategic-killed items** (vault.import etc.): keep marked

## Per-item decisions

| # | Item | Orig P | Decision | Pri | Reason |
|---|---|---|---|---|---|
| 1 | vault-curator "Stale Notes" | P0 | **KILL** (strip persona) | — | Persona side-quest. Lint doesn't produce `staleNotes`; cheaper to remove the prompt line than wire a feature no one asked for. |
| 2 | mcp-tools-reference drift | P0 | **CLOSED** | — | Already mitigated by `generate-tools-doc.ts` + drift-guard test. |
| 3 | vault.graph `type` param ignored | P0 | **PROMOTE** | LOW | Schema lies to LLM — "backlinks/outgoing/both" enum but handler ignores. Fix: drop enum or wire handler. ~30 LOC. |
| 4 | vault.externalSearch always throws | P0 | **PROMOTE** | **HIGH** | Pollutes LLM tool selection — every call throws. Direct hit to retrieval routing quality. Fix: gate registration on config OR return `{available:false}`. |
| 5 | Tool descriptions are 3-word stubs | P1 | **PROMOTE** | MED | Affects pipeline entry. `query.unified` / `query.search` / `query.explain` all just say "search". LLM can't pick. Use `vault.enforceDiscipline` style. |
| 6 | vault-architect `Unresolved: K` | P1 | **KILL** (strip line) | — | `vault.graph` doesn't return `unresolvedLinks`. Drop persona template line (cheaper than adding the field for one persona). |
| 7 | vault-historian mtime sort | P1 | **DEFER** | — | 1 call per note × 20 = 20 roundtrips. Real cost only if historian gets used; no usage telemetry. Wait for evidence. |
| 8 | No persona MCP-unavailable fallback | P1 | **PROMOTE** | MED | Robustness. Per `feedback-graduated #8` (memory-route-first), add 1-line fallback per persona. ~5 personas × 1 line. |
| 9 | vault-gardener empty-vault seeder | P2 | **DEFER** | — | Empty-vault scenario doesn't apply to Curry's vault (165+ files). Verify partial coverage in `skills/vault-gardener.md` then revisit only if onboarding-target user appears. |
| 10 | First-prompt stdio banner | P2 | **KILL** | — | MCP clients (Claude Code) don't display stdio startup output to user. Banner would never be seen. |
| 11 | vault-janitor delete cap | P2 | **DEFER** | — | `dry-run default=true` + PROTECTED_DIRS already cover safety floor. Soft cap in persona is fine until evidence shows it gets violated. Document and move on. |
| 12 | skills/mcp-tools-reference.md | P2 | **CLOSED** | — | Covered by #2. |

## Carry-forward (v2 smoke-test session)

| Item | Decision | Pri | Reason |
|---|---|---|---|
| sweep.log rotation | **DEFER** | — | Doesn't affect functionality. Re-visit when log size becomes an actual problem. |
| GUIDE screenshots | **PROMOTE** | LOW | Blocks bilingual guide polish only. Hand-test once, attach images, done. |
| CRLF warnings | **DO NOW** | trivial | 5 min: add `.gitattributes` with `* text=auto eol=lf`. No reason to icebox a 1-line fix. |
| Smoke test payload shape | **PROMOTE** | LOW | Lurking regression risk. Tighten shape assertions in unit tests. ~30 LOC. |

## Strategic decisions (standing — not items)

- **KILL `vault.import`** ✓ confirmed. Bulk ingest via Obsidian CLI. Zero conversion code.
- **KEEP vault-gardener** ✓ confirmed (per #9 deferred but persona stays).
- **obsidian-vault-bridge v2 repositioned** ✓ confirmed. Out of scope for llm-wiki.

## NEW items (baseline-driven, propose for v3)

These are not in current ICEBOX but emerge from today's data:

### NEW-A: Mainline `vault-vector.ts` adapter — **PRIORITY: HIGHEST**

**Why**: vault-vector is the single largest retrieval-quality lever
identified today. recall@5 jumps 0.400 → 0.547 (+37%); entity group
0.438 → 0.750 (+71%). Yet the only existing path is `qmd.ts` which
requires contributor install. Most users (including Curry) have it
disabled. This means RRF fusion **runs without the very capability
that justifies RRF**.

**Spec**:
- New `mcp-server/src/adapters/vault-vector.ts`
- On init: embed every `memory/*.md` (or `vault/**/*.md` for non-Curry
  users) via ollama (or any OpenAI-compatible embedding endpoint)
- Store in PG vector table (same DB as memU; new table `vault_chunks`
  to keep separation)
- Implement `searchByVector` for `query.unified` to fan into
- Re-embed on file change (filesystem watcher) or scheduled
  re-index (cron-style)

**Gold-set anchor**: today's `eval/retrieval-gold.jsonl` already
provides the 25-query regression suite. Vector adapter that drops
below 0.547 recall@5 is a regression.

### NEW-B: Multi-chunk + overlap chunking — **PRIORITY: MEDIUM**

**Why**: q08 (Windows ML 3.12/3.13 → python-toolkit) and q24 (CC 管家 →
my-code-machine) failed because the first 2000 chars of the gold file
don't contain the query's semantic anchor. Single-chunk 2000-char
hard cap is the bottleneck.

**Spec**:
- Sliding window: 1000-char chunks, 200-char overlap
- Per file: store N chunks, each with its embedding
- At query time: max over chunks for file score (or top-K-chunk avg)

Defer until NEW-A ships.

### NEW-C: Alias / shorthand dictionary — **PRIORITY: LOW**

**Why**: q20 (MMC 短板) and q24 (CC 管家) failed because Curry's
shorthand (`MMC`, `CC 管家`) doesn't map to canonical entity names
(`my-code-machine`) by embedding similarity alone. An alias dict
lets retrieval expand `MMC` → `my-code-machine` before embedding.

**Spec**:
- `eval/aliases.yaml`: `MMC: my-code-machine`, `CC 管家: my-code-machine`,
  `llk: llk-server-pentest`, etc.
- Pre-embed query expansion: tokens that hit alias dict get appended
  with their canonical form

Defer until NEW-A + NEW-B ship and remaining failures still cluster
on alias/shorthand.

## Summary scoreboard

| Decision | Count |
|---|---|
| KILL outright | 3 (#1, #6, #10) |
| CLOSED (already done) | 2 (#2, #12) |
| DEFER (revisit on evidence) | 5 (#7, #9, #11, sweep, janitor) |
| PROMOTE — high pri | 1 (#4) + NEW-A |
| PROMOTE — med pri | 2 (#5, #8) + NEW-B |
| PROMOTE — low pri | 4 (#3, GUIDE, smoke, NEW-C) |
| DO NOW (trivial) | 1 (CRLF) |

**Net effect**: 12 ICEBOX items → 5 promotes + 3 kills + 5 defers + 2
already-closed. Plus 3 new items added (1 high, 1 med, 1 low). The
v3 plan-of-record looks roughly:

1. Ship NEW-A (vault-vector adapter) — biggest retrieval lever
2. Promote #4 (externalSearch broken throw)
3. Promote #5 (tool descriptions) + #8 (persona fallbacks) — quality of LLM tool routing
4. Strip kill items (#1, #6, #10) — persona shrinkage
5. Add `.gitattributes` for CRLF (5 min)
6. Defer rest until next baseline run shows them affecting numbers
