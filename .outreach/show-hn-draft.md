# Draft: Show HN post

**Title**: `Show HN: Karpathy's LLM Wiki, without the Postgres (obsidian-llm-wiki v1.0)`

**URL**: https://github.com/2233admin/obsidian-llm-wiki

---

## Body (≈300 words, HN-appropriate)

When Karpathy published his LLM Wiki gist in April, the comment thread immediately filled with variations that added things the gist explicitly said weren't needed at small scale — mostly embeddings and vector DBs.

obsidian-llm-wiki is a deliberately orthodox implementation:

- **Three operations**, as the gist describes: Ingest / Query / Lint. Implemented as MCP tools so any MCP client (Claude Code, Cline, etc.) can drive them.
- **No embeddings at moderate scale.** Filesystem adapter uses ripgrep. Embeddings/memU/pgvector are *optional* adapters — you can ignore them entirely and still have a working system.
- **`index.md` + `log.md`** catalog and chronicle, auto-maintained, exactly as the gist prescribes.
- **Obsidian-native** — WebSocket adapter for live two-way sync, and a filesystem fallback so it runs headless too.
- **10 source collectors** that dump into the vault as markdown with cursor state: Gmail, X, Linear, Circleback, plus Chinese-ecosystem connectors (Feishu, NapCat/QQ, WeChat, AstrBot, WeFlow).

It is explicitly **not** competing with gbrain or other "heavy" implementations — those serve different use cases. If you want dream cycles and a Postgres warehouse, use gbrain. If you want the laptop-scale, markdown-in-git, "my Obsidian vault with a brain behind it" flavor, use this.

**Not yet shipped** (roadmap in `progress.txt`):
- Concept graph generator (currently in the architecture diagram but not the code)
- `qmd` adapter as optional search backend (Karpathy recommended qmd; no reason to duplicate it)
- Link discovery (suggests `[[wikilinks]]` the vault is missing)

Tech: TypeScript + @modelcontextprotocol/sdk (stdio), Python 3.11+ compiler (zero-dep), ripgrep. Runs on Windows / macOS / Linux. GPL-3.0.

v1.0 shipped 2026-04-08, currently 5 stars / 3 forks organically. Looking for feedback, especially from Obsidian power users and people running Chinese-chat-ecosystem workflows.

---

## Response drafts for common HN questions

**Q: "How is this different from gbrain / qmd / [other forks]?"**
A: Different axis, not direct competitor. See the comparison table in the README. In one line: gbrain = Postgres+pgvector ("heavy Karpathy"), qmd = search-only, this = "orthodox Karpathy + Obsidian-native + multi-source collectors."

**Q: "Why no embeddings?"**
A: Because Karpathy's gist says explicitly: at ~100 sources / hundreds of pages, the infra cost of embeddings is not justified — plain index + grep works. We took that literally. If you have >10k notes, pgvector is available as an optional adapter.

**Q: "Why Obsidian?"**
A: Because Obsidian vaults already exist in a lot of developer knowledge workflows, and the data model (markdown + `[[wikilinks]]` + frontmatter) is a perfect fit for the LLM Wiki pattern. It's also optional — filesystem fallback works without Obsidian running.

**Q: "Can I use this without Claude Code?"**
A: Yes. It's an MCP stdio server. Use any MCP-compatible client.

**Q: "License?"**
A: GPL-3.0. If that's a dealbreaker for your use case, open an issue and we'll discuss.

---

## Tone/timing notes for Curry

- Post to Show HN on **Tuesday or Wednesday, 07:00-09:00 Pacific** — maximum global overlap.
- Do NOT post before Phase C (Compiler actually generates concept graphs). Reviewers will ding "architecture diagram without matching code" if the compiler layer is still aspirational.
- Alternative: post *now* as "v1.0 — taking feedback before v1.1" framing, which is honest about the Compiler-still-aspirational status.
- Engage every top-level comment within the first 2 hours or HN algorithm de-ranks.
- If someone compares negatively to gbrain, DO NOT defend aggressively — acknowledge it's a different axis and point to the comparison table.
- If Karpathy shows up (low probability but nonzero), be gracious; don't ask for anything.
