# ICEBOX — v3-or-kill

Deferred work that is **not** blocking v2. Revisit during v3 planning
or explicitly kill. Living here instead of open PRs / issue tracker
so the v2 line stays lean.

Last updated: 2026-04-21 (pre v2.0.0 merge).

## Persona + MCP audit (2026-04-20, 12 findings)

Originally slated for execution on `v2-staging`. Scope crept into the
Step 2.x governance chain (AI-Output sediment, review-status, sweep
metrics) and got de-prioritised. Re-tag for v3.

### Partially closed during v2 work

- **#2 mcp-tools-reference.md drift** — mitigated by `mcp-server/src/scripts/generate-tools-doc.ts`
  + drift-guard test (commit `fbd6ed0 test(mcp): drift guard for mcp-tools-reference.md`).
  The doc is now auto-regenerated from `operations.ts`, so drift cannot
  silently return. **Status: closed.**

### Open (deferred to v3)

**P0 (LLM-visible correctness bugs):**

- **#1 vault-curator.md "Stale Notes (90+ days)"** — persona prompt
  references data that `vault.lint` does not produce. Fix: either add
  `staleNotes` to the lint handler, or strip the section from the
  persona. File-scoped, ~20 LOC.

- **#3 vault.graph `type` param ignored** — schema declares
  `type: "backlinks" | "outgoing" | "both"` (operations.ts:177) but
  the handler (index.ts:391-421) doesn't branch on it. The schema
  lies to the LLM. Fix: wire it up or drop the enum.

- **#4 vault.externalSearch always throws** — registered tool that
  throws `"No external search engine configured"` on every call.
  Degrades tool-selection quality. Fix: gate registration on config,
  or return `{ available: false }` instead of throwing.

**P1 (descriptions that underinform tool selection):**

- **#5 Tool descriptions are 3-word stubs** — `query.unified` vs
  `query.search` vs `query.explain` all say "search". Use the
  `vault.enforceDiscipline` / `vault.reindex` verbose style as
  reference.
- **#6 vault-architect.md shows `Unresolved: K`** — `vault.graph`
  returns `orphans` only, no `unresolvedLinks` count. Drop the
  template line, or add the field.
- **#7 vault-historian.md sorts by mtime** — mtime only comes from
  `vault.stat` (1 call per note; 20-result window = 20 roundtrips).
  Add `mtime` to `searchByFrontmatter` results, or add `sort=mtime`
  to `vault.list`.
- **#8 No persona specifies MCP-unavailable fallback** — only
  librarian handles adapter-down. Per `feedback-graduated` rule 8
  (memory-route-first), add one-line fallback per persona.

**P2 (ergonomics that compound):**

- **#9 vault-gardener persona** (revised scope) — headless
  conversational empty-vault seeder using `vault.create` /
  `vault.append`. Original `vault.import` proposal KILLED (see
  strategic decision 1 below). **Partially in repo** as
  `skills/vault-gardener.md` — verify coverage before closing.
- **#10 No first-prompt UX after install** — emit one-line banner
  on stdio startup: "Try: ask `what do I know about X` to invoke
  vault-librarian." Low-cost, high-discoverability.
- **#11 vault-janitor "Max 10 deletions per session"** — norm lives
  in persona prompt only, not enforced by `vault.delete`. Either
  enforce server-side (delete-count state per session id) or accept
  as soft and document.
- **#12 skills/mcp-tools-reference.md** — covered by #2, closed.

### Strategic decisions from the same session (standing)

These are **not** icebox items — they are already committed positions.
Listed here so context isn't lost:

1. **KILL `vault.import`** — bulk ingest goes through Obsidian native
   CLI (https://obsidian.md/cli) + Obsidian Importer plugin. Zero
   conversion code in this repo.
2. **KEEP vault-gardener persona** — pure headless, no plugin dep.
   Distinct from bulk import.
3. **obsidian-vault-bridge repositioned** — multi-agent coordination
   + corpus-landing bus, not an Obsidian-plugin WebSocket adapter.
   Full design: `~/.claude/projects/C--Users-Administrator/memory/project_bridge_architecture_v2.md`.

## obsidian-vault-bridge v2 architecture (separate repo)

Lives at `D:/projects/obsidian-vault-bridge/` (master branch). Design
captured; implementation not started. Three capabilities the native
Obsidian CLI does NOT cover:

1. Multi-agent discovery (any agent in Curry's cluster finds the bridge)
2. Event stream subscription (vault + other feeds push to subscribers)
3. DB writes for language-corpus cleaning (memU pgvector / DuckDB /
   PG 18 are existing backends)

**Status:** out of scope for obsidian-llm-wiki v2. Bridge work
proceeds in its own repo on its own cadence. This file exists so the
design doesn't fall off the map.

## P2 / P3 carry-forward from v2 smoke-test session

- **sweep.log.md rotation** (Step 3 scope) — trend log appends
  indefinitely. Add size-based rotation or date-partitioned files.
- **Hand-test screenshots for GUIDE.md / GUIDE.zh-CN.md** — promised
  three sessions in a row, still TODO. Blocks only the bilingual
  guide's polish, not functionality.
- **CRLF warnings on 7 files** (autocrlf on Windows) — cosmetic.
  Resolved by adding `.gitattributes` with `* text=auto eol=lf`.
- **Smoke test payload shape tolerance** — deliberately accepts
  `files` OR `entries` OR top-level array. A genuine schema
  regression could slip if it still contains `hello.md`. Tighter
  shape assertions belong in unit tests, not the smoke.

## Triage rule

When v3 planning starts: re-read this file, promote to PR whatever
still matters, delete whatever doesn't. Don't let it accrete.
