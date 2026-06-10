---
id: notebooklm-to-vault
name: NotebookLM-to-Vault
version: 0.1.0
description: Bidirectional bridge -- push vault notes to NotebookLM as sources, pull cited answers and reports back into the vault
category: research
setup_time: 10 min
cost_estimate: "$0 (NotebookLM free tier; unofficial API)"
requires: ["python>=3.10", "notebooklm-py", "one-time `notebooklm login`"]
---

# NotebookLM-to-Vault (experimental)

Bridges your vault and [NotebookLM](https://notebooklm.google.com) via
[notebooklm-py](https://github.com/teng-lin/notebooklm-py) (16k+ stars, MIT).

- **push**: upload vault notes as NotebookLM sources
- **ask**: query a notebook, save the cited answer to `00-Inbox/NotebookLM/`
- **report**: generate a briefing doc / study guide, save to `Research/NotebookLM/`

## Stability warning

notebooklm-py wraps Google's **undocumented** RPC APIs with cookie-based auth.
Google can break it without notice (the library is actively maintained and
tracks drift, but treat this recipe as experimental). Nothing in vault-mind's
core depends on it -- if it breaks, only this recipe stops working.

## Setup

```bash
pip install notebooklm-py            # ~10 MB core
notebooklm login                     # one-time; opens a browser for Google login
# alternative without Playwright: notebooklm login --browser-cookies chrome
notebooklm auth check --test --json  # verify: "status": "ok"
```

Auth state lands in `~/.notebooklm/profiles/default/storage_state.json`.

## Usage

```bash
# Push notes as sources (creates the notebook if missing)
python recipes/collectors/notebooklm-collector.py push \
  --vault "$VAULT_PATH" --notebook "My Research" \
  Research/topic-a.md Research/topic-b.md

# Ask with citations -> 00-Inbox/NotebookLM/YYYY-MM-DD--{question-slug}.md
python recipes/collectors/notebooklm-collector.py ask \
  --vault "$VAULT_PATH" --notebook "My Research" "What are the open questions?"

# Generate a report -> Research/NotebookLM/YYYY-MM-DD--{notebook}--briefing-doc.md
python recipes/collectors/notebooklm-collector.py report \
  --vault "$VAULT_PATH" --notebook "My Research" --format briefing-doc
```

Every command prints one JSON object. Exit codes: 0 ok, 1 error, 2 not logged in.

Or just use the slash command: `/vault-notebooklm push|ask|report ...` — it wraps
this collector and files outputs with AI-First frontmatter automatically.

## Output conventions

- Answers land in `00-Inbox/NotebookLM/` with `status: draft` frontmatter --
  same review-then-promote flow as every other AI output in this vault
- Citations reference NotebookLM source IDs (not vault paths); the source title
  is the pushed file's stem, so mapping back is usually obvious
- Reports land in `Research/NotebookLM/` ready for `/vault-synthesize`
