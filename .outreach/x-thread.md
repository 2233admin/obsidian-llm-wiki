# Draft: X/Twitter thread — launch post

Target handle: @2233admin (or Curry's personal handle)
Length: 5-7 tweets, ≤280 chars each.

---

## Thread

**Tweet 1 (hook)**
Karpathy shipped the LLM Wiki pattern in April. gbrain shipped the heavy version.

I shipped the small-scale orthodox one — plain markdown, no embeddings, runs on a laptop, native to Obsidian.

https://github.com/2233admin/obsidian-llm-wiki

**Tweet 2 (architecture)**
Three operations, exactly as Karpathy described:

- Ingest → `recipe.run`
- Query → `vault.search` (ripgrep, no vector DB)
- Lint → `vault.health` + `/vault-reconcile`

Filesystem adapter is the global invariant. Everything else (Obsidian, memU, GitNexus) is optional.

**Tweet 3 (differentiation)**
Why not gbrain? Different use case.

gbrain = Postgres + pgvector + dream cycles. Built for 10k+ files and long-running agents.

LLM Wiki Bridge = plain markdown + Obsidian UI + MCP. Built for your personal vault, your laptop, your Claude Code session.

**Tweet 4 (collectors)**
Ships with 10 source collectors that dump directly to your vault:

Gmail · X · Linear · Circleback
Feishu · NapCat/QQ · WeChat · AstrBot · WeFlow · Voile

Chinese-ecosystem connectors are a moat no YC company is going to build.

**Tweet 5 (Karpathy orthodoxy)**
Karpathy's gist says: at ~100-hundreds of pages, you do NOT need embedding-based RAG.

Most LLM Wiki forks ignore this and bolt on vector search anyway.

This one doesn't. ripgrep + `index.md` + `log.md`. That's the whole spec. Stay orthodox.

**Tweet 6 (ask)**
v1.0.0 shipped. 5 stars / 3 forks organically, window still open.

If you run an Obsidian vault + Claude Code, try it and send issues.

Especially: Chinese-ecosystem users — NapCat/WeChat/Feishu collectors need dogfooders.

https://github.com/2233admin/obsidian-llm-wiki

**Tweet 7 (optional — ally ping)**
Shout-out to @tobi — working on a `qmd` adapter for v1.1 so it plugs in as an optional search backend. Karpathy recommended qmd in the gist; feels right to make them interoperate instead of duplicating work.

---

## Tone notes

- Do NOT @karpathy or @garrytan in the launch thread itself — feels like clout-chasing. Let them find it organically (the gist comment is the proper channel to reach Karpathy).
- `@tobi` ping in Tweet 7 is OK because it's an actual technical alliance ask. Only send if qmd adapter is actually started.
- If Tweet 1 doesn't get traction in 2 hours, don't post Tweets 2-7. Wait a week, rewrite the hook, try again.
- Best day to post: Tuesday-Thursday, 09:00-11:00 Pacific (reaches both US and EU dev audiences).
- If a high-signal amplifier (Karpathy, Tan, tobi, simonw) engages, reply with Tweet 2+ immediately rather than posting as scheduled thread.

---

## Chinese version (optional — for 微博/即刻)

Karpathy 的 LLM Wiki 概念 4 月发了，gbrain 发了重量版本 (Postgres+pgvector)。

我发了小体量正统派: 纯 markdown，不上 embedding，笔记本就能跑，Obsidian 原生。

三个操作 (Ingest / Query / Lint) 按 Karpathy 原文来，10 个 collector (含飞书/NapCat/微信/AstrBot)，MCP stdio 接 Claude Code。

https://github.com/2233admin/obsidian-llm-wiki

注：中文发微博前，Curry 可以加一句 "不适用于企业级，仅个人知识库 100-10k 笔记"。
