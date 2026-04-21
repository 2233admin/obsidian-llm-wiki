---
id: voile-to-vault
name: Voile-to-Vault
version: 0.1.0
description: QQ + WeChat messages (via Voile) -> vault chat digests
category: sense
secrets:
  - name: VOILE_DB_URL
    description: Postgres DSN for the Voile database
    where: set when running Voile docker compose (default localhost:5432/voile)
health_checks:
  - command: 'psql "$VOILE_DB_URL" -c "SELECT COUNT(*) FROM messages" -t 2>&1 | grep -q "[0-9]" && echo OK'
setup_time: 5 min (after Voile is running)
cost_estimate: "$0 (local DB read)"
requires: []
---

# Voile-to-Vault

Reads normalized QQ and WeChat messages from [Voile](https://github.com/2233admin/voile)'s Postgres
database and compiles them into dated digest notes in `04-Research/chat-digest/`.

Voile handles all platform complexity (NapCatQQ / WeFlow integration). This recipe is a
read-only adapter -- it never writes to Voile's DB.

## What it does

- Auto-discovers all active channels, or reads from `VOILE_CHANNELS` if set
- Tracks `since_id` per channel for incremental syncs (no duplicates)
- Per channel: includes topic tags, sentiment breakdown, and recent messages
- Checkpoints state after each channel (safe to interrupt and resume)
- Outputs `~/.vault-mind/recipes/voile-to-vault/digests/YYYY-MM-DD.md`

## Prerequisites

Voile must be running and its DB must contain data:

```bash
cd <path-to-voile-repo>
docker compose up -d
# Verify:
psql postgres://postgres:postgres@localhost:5432/voile -c "SELECT COUNT(*) FROM messages"
```

## Output location

```
~/.vault-mind/recipes/voile-to-vault/
  digests/YYYY-MM-DD.md   -- dated digest (compile.py input)
  state.json               -- per-channel since_id cursor
  heartbeat.jsonl          -- sync log
```

## Setup

### Step 1: Start Voile

```bash
cd <path-to-voile-repo>
docker compose up -d
```

### Step 2: Set the DB URL (if non-default)

The default `postgres://postgres:postgres@localhost:5432/voile` works when Voile runs
locally. Override only if you moved the DB:

```bash
export VOILE_DB_URL="postgres://user:pass@host:5432/voile"
```

### Step 3: (Optional) Pin specific channels

By default the collector auto-discovers all channels with messages.
To limit to specific QQ group IDs:

```bash
export VOILE_CHANNELS="123456789,987654321"
```

### Step 4: Run first sync

```bash
bun run recipes/collectors/voile-collector.ts
```

## Cron schedule

```
# Every 30 minutes
*/30 * * * * cd <VAULT_MIND_DIR> && bun run recipes/collectors/voile-collector.ts >> ~/.vault-mind/recipes/voile-to-vault/cron.log 2>&1

# Compile digests -> vault 3x/day
0 8,14,22 * * * cd <VAULT_MIND_DIR> && python mcp-server/kb_meta.py compile 04-Research/chat-digest --tier haiku >> ~/.vault-mind/recipes/voile-to-vault/compile.log 2>&1
```

## Troubleshooting

**`DB connect failed`**: Voile is not running. Run `docker compose up -d` in the Voile directory.

**`No channels found`**: Voile has no messages yet. Wait for NapCatQQ to ingest some messages.

**Topics/Sentiment missing**: Voile's analysis workers (`topic_worker`, `sentiment_worker`) have not
run yet. The digest will still include raw messages.
