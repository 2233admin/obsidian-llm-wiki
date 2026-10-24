---
name: chubbyskills
description: Integrate chubbyguan/chubbyskills as LLM Wiki's local multi-channel ingest pack, turning Chinese feeds, videos, podcasts, articles, and social posts into searchable Obsidian/Markdown knowledge.
---

# ChubbySkills local ingest pack

Use this skill when the user wants LLM Wiki to behave like a local NotebookLM / NetbookLM over their own feeds and saved content.

LLM Wiki's role:

- Own the vault path, search, citations, graph, memory, review, and promotion workflow.
- Query saved Markdown through `vault.search`, `query.unified`, `vault.read`, `memory.*`, and AI-Output review tools.
- Keep governance boundaries: raw source, compiled wiki, agent output, reviewed decisions.

ChubbySkills' role:

- Own platform-specific capture and transcription.
- Convert links from Douyin, Bilibili, Xiaohongshu, WeChat, X/Twitter, podcasts, YouTube, Weibo, Zhihu, TikTok, and related feeds into Markdown assets.
- Use its own optional dependencies for video/audio transcription, subtitles, images, and enrichment.

Source project: `https://github.com/chubbyguan/chubbyskills`.

## Integration model

Do not copy large upstream dependencies into the LLM Wiki MCP server.

Instead:

1. Install LLM Wiki normally.
2. Install upstream ChubbySkills separately when the user wants multi-channel capture.
3. Point both systems at the same local vault:

```bash
export VAULT_MIND_VAULT_PATH=/path/to/your/vault
export VAULT_DIR="$VAULT_MIND_VAULT_PATH"
```

4. Let ChubbySkills write captured Markdown into the vault.
5. Let LLM Wiki search, cite, enrich, review, and promote the result.

## Recommended vault layout

```text
raw/                         # LLM Wiki raw compiler sources
素材库/                       # ChubbySkills raw captured material
wiki/                        # compiled / structured knowledge
00-Inbox/AI-Output/<actor>/  # agent-authored review candidates
00-Inbox/Agent-Memory/<actor>/
20-Decisions/
30-Architecture/
40-Runbooks/
```

If the user's vault already has a different Chinese folder structure, preserve it. Do not force migration.

## Skill routing

| Need | Upstream ChubbySkills skill | LLM Wiki follow-up |
|---|---|---|
| Douyin video | `douyin-transcribe` | `query.unified`, `vault.writeAIOutput` |
| Bilibili video | `bilibili-transcribe` | `query.unified`, concept compilation |
| YouTube video | `youtube-transcribe` | bilingual summary, tags, AI-Output |
| Podcast | `podcast-transcribe` | learning notes, memory handoff |
| WeChat article | `wechat-article-ingest` | source-backed wiki page |
| Xiaohongshu | `xiaohongshu-ingest` | image/video routing, hook analysis |
| X/Twitter single tweet | `x-ingest` | raw Markdown ingest |
| X/Twitter high-signal browser capture | `x-to-obsidian` | Web Clipper capture, LLM Wiki search |
| Any captured note | `content-enrich` | summary, tags, value judgment |
| Whole vault management | `knowledge-base-management` | LLM Wiki doctor, health, MCP query |

## Helper script

This skill bundles a tiny helper that prints safe install and environment commands:

```bash
python3 scripts/chubbyskills_bridge.py --help
python3 scripts/chubbyskills_bridge.py list
python3 scripts/chubbyskills_bridge.py plan --vault /path/to/vault --skills bilibili-transcribe podcast-transcribe
```

The helper does not install or clone anything by default. Treat it as a reproducible checklist.

## Operating procedure

1. Identify the source URL or content channel.
2. Pick the upstream skill using the routing table.
3. If upstream ChubbySkills is not installed, run the helper `plan` command and show the user the commands.
4. Run upstream capture only when the local environment is ready.
5. Confirm the Markdown note exists under the vault.
6. Use LLM Wiki MCP tools to search and summarize the saved note.
7. File agent-authored synthesis under `00-Inbox/AI-Output/<actor>/`.
8. Promote durable conclusions only after review.

## Good prompts

```text
/chubbyskills install the Bilibili and podcast ingest path for my LLM Wiki vault
/chubbyskills turn this Bilibili video into a searchable vault note, then summarize it
/chubbyskills capture these WeChat articles into 素材库 and build a wiki index
/chubbyskills make this vault work like a local NotebookLM over my saved feeds
```

## Safety rules

- Respect source platform terms and rate limits.
- Do not bypass login, paywalls, private content, or deleted content.
- Do not hardcode cookies, API keys, or tokens into vault notes.
- Keep heavy transcription dependencies outside LLM Wiki's MCP bundle.
- Prefer source-preserving Markdown over lossy summaries.
- Never claim "local NotebookLM" completeness unless retrieval was tested against the saved notes.
