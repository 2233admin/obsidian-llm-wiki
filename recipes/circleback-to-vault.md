---
id: circleback-to-vault
name: Circleback-to-Vault
version: 0.1.0
description: Meeting notes and action items from Circleback AI -> vault meeting digests
category: sense
secrets:
  - name: CIRCLEBACK_API_KEY
    description: Circleback personal API key
    where: https://app.circleback.ai/settings -> API -> Generate API Key
health_checks:
  - command: 'curl -sf -H "Authorization: Bearer $CIRCLEBACK_API_KEY" https://api.circleback.ai/v1/notes?limit=1 | grep -q "data" && echo OK'
setup_time: 3 min
cost_estimate: "$0 (Circleback API included in plan)"
requires: []
---

# Circleback-to-Vault

Fetches meeting notes and action items from [Circleback](https://circleback.ai) via the REST API
and writes dated digest notes to `04-Research/meeting-digest/`.

Each digest includes meeting summaries, attendees, and action items so meetings land in your
knowledge graph and get compiled with the rest of your vault.

## What it does

- Fetches all meeting notes created since the last run (default: last 7 days on first run)
- Extracts summary, attendees, action items, and next steps per meeting
- Tracks `last_synced` timestamp for incremental syncs (no duplicates)
- Outputs `~/.vault-mind/recipes/circleback-to-vault/digests/YYYY-MM-DD.md`

## Prerequisites

1. A Circleback account with at least one recorded meeting
2. An API key from https://app.circleback.ai/settings

## Output location

```
~/.vault-mind/recipes/circleback-to-vault/
  digests/YYYY-MM-DD.md   -- dated digest (compile.py input)
  state.json               -- last_synced timestamp cursor
  heartbeat.log            -- sync log
```

## Setup

### Step 1: Generate a Circleback API key

Go to https://app.circleback.ai/settings, navigate to **API**, and click **Generate API Key**.
Copy the key.

### Step 2: Set the API key

```bash
export CIRCLEBACK_API_KEY="cb_your_key_here"
```

### Step 3: (Optional) Adjust lookback window

Controls how far back the first run reaches. Default is 7 days.

```bash
export CIRCLEBACK_LOOKBACK_DAYS=30
```

### Step 4: Run first sync

```bash
CIRCLEBACK_API_KEY=cb_xxx bun run recipes/collectors/circleback-collector.ts
```

## Cron schedule

```
# Every hour
0 * * * * cd <VAULT_MIND_DIR> && CIRCLEBACK_API_KEY=cb_xxx bun run recipes/collectors/circleback-collector.ts >> ~/.vault-mind/recipes/circleback-to-vault/cron.log 2>&1

# Compile digests -> vault 3x/day
0 8,14,22 * * * cd <VAULT_MIND_DIR> && python mcp-server/kb_meta.py compile 04-Research/meeting-digest --tier haiku >> ~/.vault-mind/recipes/circleback-to-vault/compile.log 2>&1
```

## Troubleshooting

**`CIRCLEBACK_API_KEY is required`**: Set `export CIRCLEBACK_API_KEY=cb_xxx` before running.

**`401 Unauthorized`**: API key is invalid or has been revoked. Generate a new one at https://app.circleback.ai/settings.

**`No notes found`**: Either no meetings were recorded in the lookback window, or the Circleback account has no notes yet. Try increasing `CIRCLEBACK_LOOKBACK_DAYS`.

**`API schema mismatch`**: Circleback may update their API shape. Check https://docs.circleback.ai and adjust the collector's type interfaces to match the current response.
