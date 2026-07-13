# ChubbySkills integration

LLM Wiki supports `chubbyguan/chubbyskills` as an optional local ingest pack.

Together they form a local NotebookLM-style workflow:

```text
feeds / links / videos / podcasts
  -> ChubbySkills capture and transcription
  -> local Obsidian / Markdown vault
  -> LLM Wiki search, memory, citations, review, promotion
```

## Why this belongs in the skill layer

ChubbySkills has platform-specific capture logic and optional heavy dependencies such as `ffmpeg`, `yt-dlp`, `funasr`, `torch`, `faster-whisper`, and article parsing packages. LLM Wiki should not bundle that into the MCP server.

Instead, LLM Wiki exposes a `/chubbyskills` skill that coordinates the upstream toolkit and keeps the vault contract consistent.

## Upstream capabilities

The upstream project describes itself as a set of AI Skills for ingesting Chinese multi-channel content into a personal knowledge base. It includes Douyin, Bilibili, Xiaohongshu, WeChat, X/Twitter, podcasts, YouTube, Weibo, Zhihu, TikTok, content enrichment, knowledge-base management, and workflow automation.

Source: `https://github.com/chubbyguan/chubbyskills`.

## Install pattern

Install LLM Wiki as usual:

```bash
./setup --host codex
```

Then use the installed `/chubbyskills` skill or helper script to plan the upstream install:

```bash
python3 ~/.codex/skills/chubbyskills/scripts/chubbyskills_bridge.py list
python3 ~/.codex/skills/chubbyskills/scripts/chubbyskills_bridge.py plan \
  --vault /path/to/your/vault \
  --skills bilibili-transcribe podcast-transcribe wechat-article-ingest
```

The helper prints commands such as:

```bash
export VAULT_MIND_VAULT_PATH="/path/to/your/vault"
export VAULT_DIR="$VAULT_MIND_VAULT_PATH"
git clone https://github.com/chubbyguan/chubbyskills.git ~/chubbyskills
cd ~/chubbyskills
bash setup.sh bilibili-transcribe podcast-transcribe wechat-article-ingest
```

## Recommended vault layout

```text
素材库/                       # raw captured material from ChubbySkills
raw/                         # raw compiler source material for LLM Wiki
wiki/                        # compiled / structured knowledge
00-Inbox/AI-Output/<actor>/  # agent-authored synthesis candidates
00-Inbox/Agent-Memory/<actor>/
20-Decisions/
30-Architecture/
40-Runbooks/
```

You do not need to rename an existing vault. Treat this as a recommended convention for new vaults.

## Workflow

1. Drop a platform link into the agent.
2. `/chubbyskills` selects the relevant upstream skill.
3. ChubbySkills captures Markdown and assets into the vault.
4. LLM Wiki confirms visibility with `vault.search` or `query.unified`.
5. The agent writes source-backed synthesis into `00-Inbox/AI-Output/<actor>/`.
6. Durable knowledge is reviewed and promoted into `wiki/`, `20-Decisions/`, `30-Architecture/`, or `40-Runbooks/`.

## Safety

- Respect source platform terms and rate limits.
- Do not bypass private content, deleted content, paywalls, or login boundaries.
- Do not store cookies or API keys in vault notes.
- Keep heavyweight media/transcription dependencies outside `mcp-server/bundle.js`.
- Keep raw source references so LLM Wiki answers can cite local files.
