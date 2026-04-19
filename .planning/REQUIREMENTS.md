# Requirements: obsidian-llm-wiki v2 (shipability)

**Defined:** 2026-04-20 (v2 — ship-ready pivot)
**Core Value:** Your markdown vault becomes a 6-persona virtual team for Claude Code / Codex / OpenCode / any agent. MCP + compiler are plumbing; personas are the product.

**Benchmark:** [garrytan/gstack](https://github.com/garrytan/gstack) (77k stars). Pattern extraction: persona framing, paste-to-install UX, emotional hook, 30-second "you'll know" gate, multi-agent support, meta-defense docs.

**Out-of-scope (explicit):** Obsidian Community plugin, LLM-pass-2 in link_discovery, perf optimization, tag stopword filter, graph viz as the entry point.

---

## v1 status (reference; shipped 2026-04-08 + gap-closure 2026-04-20)

v1 was the headless MCP + compiler reference impl. Shipped as v1.0.0, 5 stars, 3 forks. v1 artifacts (MCP server with 39 tools, compiler with link_discovery + concept_graph, 86 MCP tests + 44 Python tests) are the foundation this v2 sits on. No v1 work remains.

---

## v2 Requirements

### Personas (Layer 0 — the product)

- [ ] **P-01**: `/vault-librarian` skill — read/search/list wrapper. Given a question, grep vault, return citations. Calls vault.search + vault.read.
- [ ] **P-02**: `/vault-architect` skill — run concept_graph compiler, emit summary of new/changed edges, suggest 1-3 refactors per invocation.
- [ ] **P-03**: `/vault-curator` skill — run link_discovery + detect stale notes (mtime based) + orphans (no backlinks) + duplicates (title collision).
- [ ] **P-04**: `/vault-teacher` skill — given a note path, pull related notes via graph.json, generate "this concept relates to X, Y, Z because ..." explanation.
- [ ] **P-05**: `/vault-historian` skill — time-window search ("Nov 2025 decisions on auth"), sorted by mtime, summarized.
- [ ] **P-06**: `/vault-janitor` skill — propose (dry-run by default) orphan removal, duplicate merge, broken link fixes.

Each persona: 1 markdown file in `skills/`, < 150 lines, calls MCP tools via Claude Code skill contract. No new server code.

### Install UX (Layer 1 — distribution)

- [ ] **I-01**: Paste-to-install prompt for Claude Code:
  `Install obsidian-llm-wiki: git clone --depth 1 https://github.com/2233admin/obsidian-llm-wiki ~/.claude/skills/vault-wiki && cd ~/.claude/skills/vault-wiki && ./setup` (mirror gstack).
- [ ] **I-02**: `./setup` script: detects vault path (env VAULT_PATH or CWD check), writes `.mcp.json` snippet, appends to CLAUDE.md the 6 persona list.
- [ ] **I-03**: Multi-agent support: `./setup --host claude|codex|opencode` installs skill in the right dir (match gstack auto-detect table).
- [ ] **I-04**: Team mode: `./setup --team` puts skill as a dev dep + auto-update check. Deferred to v2.1 if time is tight.

### Demo (Layer 2 — 30-second value)

- [ ] **D-01**: `examples/demo-vault/` — 10 fake "AI-notes-about-AI" markdown files. Deliberate: 1 dangling wikilink, 3 tag clusters, 2 duplicates, 1 stale note (old mtime).
- [ ] **D-02**: Pre-compiled `examples/demo-vault/.compile/graph.json` committed (so Vercel doesn't need to run the compiler).
- [ ] **D-03**: Hosted demo at `obsidian-llm-wiki.vercel.app` — cytoscape.js loads demo graph.json; user can paste their own JSON.
- [ ] **D-04**: README GIF (< 10s): paste install prompt -> Claude Code runs `/vault-librarian what do I know about attention heads` on demo-vault -> answer with citations.

### README (Layer 3 — narrative)

- [ ] **R-01**: Emotional hook (3-5 lines). Not "Karpathy ref impl" — state the pain: "Your vault has 500 notes. You forget half. Your AI agent can't read them."
- [ ] **R-02**: 30-second "you'll know" gate — explicit CTA: "Install, try `/vault-librarian`, decide in 30 seconds."
- [ ] **R-03**: Who-this-is-for section (3 personas, mirror gstack format).
- [ ] **R-04**: 4 example prompts (mirror gstack cold-start / warm-start / format-specific / iterate).
- [ ] **R-05**: Meta-defense: `docs/WHY_NOT_JUST_GREP.md` (pre-empt "grep already does this"). Short, evidence-based.
- [ ] **R-06**: MIT license badge + "Fork it. Improve it. Make it yours."

### Ship (Layer 4 — release)

- [ ] **S-01**: Tag v2.0.0 on main. Update CHANGELOG.md.
- [ ] **S-02**: Vercel project wired to `main` branch auto-deploy.
- [ ] **S-03**: X thread (< 5 tweets) and/or HackerNews Show post. Deferred — don't ship without.
- [ ] **S-04**: ClawHub listing if applicable (gstack uses this distribution, we should too).

---

## Traceability

| Req | Phase | Dependencies |
|-----|-------|--------------|
| P-01..06 | Phase 1 | v1 MCP server (done) |
| I-01..03 | Phase 2 | Personas skeleton (P-01) |
| I-04 | v2.1 (deferred) | - |
| D-01..02 | Phase 3 | compile-able with current compiler |
| D-03..04 | Phase 4 | Demo vault (D-01) + graph.json (D-02) |
| R-01..06 | Phase 5 | All above |
| S-01..04 | Phase 6 | All above |

---

## Non-negotiable constraints

1. **Stdlib-only for compiler** (already enforced). No new Python deps.
2. **No Obsidian runtime dependency**. Headless-first invariant from v1.
3. **No vendored files in user's repo** (mirror gstack — skill lives in `~/.claude/skills/vault-wiki/`, not user project).
4. **All personas are markdown skills**, no new server code.
5. **Vercel deploy is static** — no serverless functions, cytoscape + graph.json only.
6. **Demo vault stays under 20 md files** (performance + reviewability).

---

## Definition of Done (project-level)

A stranger Claude Code user can:
1. Paste the install prompt into Claude Code.
2. Claude Code clones + sets up + prints next-step.
3. User runs `/vault-librarian what's this demo about`.
4. Gets a citation-backed answer from demo-vault in < 10 seconds.
5. Opens `obsidian-llm-wiki.vercel.app` and sees the demo concept graph.
6. Decides whether to point it at their own vault.

No step requires reading the README beyond the first screen.

---

## Unresolved (open questions for next planning session)

1. Personas that touch memU / gitnexus adapters — include in v2 or defer to v3?
2. Auto-update check on session start (gstack pattern) — worth it for 5-star repo, or premature?
3. X thread draft — who writes it (Claude, Codex, Curry)?
4. Vercel custom domain or leave on `.vercel.app`?

---
*Original v1 requirements archived at `.planning/archive/REQUIREMENTS-v1-shipped.md` (to be moved).*
