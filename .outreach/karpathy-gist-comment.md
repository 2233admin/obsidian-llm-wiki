# Draft: Comment on Karpathy's LLM Wiki gist

Paste target: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f

---

## Short version (≈80 words, for top comment)

Built an Obsidian-native reference implementation of this pattern:
https://github.com/2233admin/obsidian-llm-wiki

Sticks to the original orthodoxy — **no embeddings at small scale**, `index.md` + `log.md` catalog/chronicle, three operations wired as MCP tools (Ingest / Query / Lint). Filesystem adapter uses ripgrep only; memU and pgvector are *optional* adapters you can ignore.

Also ships 10 source collectors (Gmail, X, Linear, Feishu, NapCat/WeChat/Feishu for Chinese ecosystem) that dump into the vault as markdown. Designed for ~100–10k-file personal vaults.

Happy to add qmd as an optional search backend — let me know if `tobi/qmd` has a stable CLI/MCP surface.

---

## Long version (≈200 words, if short version lands)

Andrej — thanks for writing this pattern down. It's been the mental model I've been circling for a while.

I shipped a reference implementation at https://github.com/2233admin/obsidian-llm-wiki that tries to be faithful to every choice in the gist:

- **Three operations as MCP tools**: `recipe.run` (Ingest), `vault.search` (Query), `vault.health` + `/vault-reconcile` (Lint)
- **`.omc/wiki/index.md` + `.omc/wiki/log.md`** — auto-maintained catalog + append-only chronicle
- **No embeddings at moderate scale** — filesystem adapter is pure ripgrep. memU (pgvector) is an *optional* adapter. The global invariant is "filesystem always works."
- **Obsidian as browsing IDE** — native adapter over WebSocket, no Local REST API plugin required. Works headless too.
- **qmd as search backend** — coming in v1.1 as an optional plug-in per your recommendation.

Also includes 10 source collectors (Gmail, X, Linear, Feishu, NapCat/WeChat/AstrBot for Chinese chat ecosystems) that dump each source as markdown with cursor state.

Positioning vs the other implementations in the thread: **gbrain** is the "heavy" read of this pattern (Postgres + pgvector, dream cycles); this project is the "original orthodoxy" — laptop scale, plain markdown, no DB required.

5 stars / 3 forks organically. If anyone wants to kick the tires — especially the Chinese-ecosystem collectors — issues/PRs welcome.

---

## Tone notes for the user (Curry)

- Do NOT open with "I built"/"here's mine"; lead with the pattern match. Karpathy values utility over self-promotion.
- Do NOT attack gbrain by name. The draft above frames the difference as **"different use cases"**, not "gbrain is wrong".
- Do NOT claim to be the "official" implementation — the gist doesn't bless any. Claim "**reference implementation**" at most, which is defensible (faithful to the original gist, explicitly documented).
- Post the **short version** first. Only escalate to long if Karpathy or a commenter asks.
- Timing: ideally within 24h of any Karpathy tweet mentioning the gist, or after a new community fork lands in the thread (piggyback on re-surfacing).
