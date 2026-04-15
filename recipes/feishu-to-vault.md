---
id: feishu-to-vault
name: Feishu-to-Vault
version: 0.1.0
description: Feishu group messages -> vault chat digests
category: sense
secrets:
  - name: FEISHU_APP_ID
    description: Feishu app ID (cli_xxx format)
    where: https://open.feishu.cn/app -> App Credentials -> App ID
  - name: FEISHU_APP_SECRET
    description: Feishu app secret
    where: https://open.feishu.cn/app -> App Credentials -> App Secret
health_checks:
  - command: 'curl -sf -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal -H "Content-Type: application/json" -d "{\"app_id\":\"$FEISHU_APP_ID\",\"app_secret\":\"$FEISHU_APP_SECRET\"}" | grep -q "tenant_access_token" && echo OK'
setup_time: 15 min
cost_estimate: "$0 (Feishu REST API, free tier)"
requires: []
---

# Feishu-to-Vault

Fetches messages from Feishu group chats and compiles them into dated digest notes
in `04-Research/chat-digest/`.

Bots can only read messages sent **after** the bot was added to a chat. Historical
messages before the bot joined are not accessible via the Feishu IM API.

## What it does

- Auto-discovers all group chats the bot is in, or reads from `FEISHU_CHATS` if set
- Tracks `since_time` cursor per chat for incremental syncs (no duplicates)
- Parses `text`, `post`, `file`, `image`, and other message types
- Checkpoints state after each chat (safe to interrupt and resume)
- Outputs `~/.vault-mind/recipes/feishu-to-vault/digests/YYYY-MM-DD.md`

## Prerequisites

1. Create a Feishu app at https://open.feishu.cn/app
2. Under **Permissions & Scopes**, add:
   - `im:message:readonly` -- read group messages
   - `im:chat:readonly` -- list chats the bot is in
3. Under **Event Subscriptions**, publish the app version
4. Add the bot to each Feishu group you want to monitor

## Output location

```
~/.vault-mind/recipes/feishu-to-vault/
  digests/YYYY-MM-DD.md   -- dated digest (compile.py input)
  state.json               -- per-chat since_time cursor
  heartbeat.jsonl          -- sync log
```

## Setup

### Step 1: Create the Feishu app and get credentials

Go to https://open.feishu.cn/app, create an app, and note the App ID and App Secret.
Add the required scopes listed above and publish the app.

### Step 2: Set credentials

```bash
export FEISHU_APP_ID="cli_your_app_id"
export FEISHU_APP_SECRET="your_app_secret"
```

### Step 3: Add bot to groups

In each Feishu group you want to monitor, add the bot via group settings -> Apps.

### Step 4: (Optional) Pin specific chats

By default the collector auto-discovers all group chats the bot is in.
To limit to specific chat IDs:

```bash
export FEISHU_CHATS="oc_abc123,oc_def456"
```

### Step 5: (Optional) Adjust lookback window

On first run the collector fetches the last N days. Default is 1 day.
To fetch the past week on first run:

```bash
export FEISHU_LOOKBACK_DAYS=7
```

### Step 6: Run first sync

```bash
FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx bun run recipes/collectors/feishu-collector.ts
```

## Cron schedule

```
# Every 30 minutes
*/30 * * * * cd <VAULT_MIND_DIR> && FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx bun run recipes/collectors/feishu-collector.ts >> ~/.vault-mind/recipes/feishu-to-vault/cron.log 2>&1

# Compile digests -> vault 3x/day
0 8,14,22 * * * cd <VAULT_MIND_DIR> && python mcp-server/kb_meta.py compile 04-Research/chat-digest --tier haiku >> ~/.vault-mind/recipes/feishu-to-vault/compile.log 2>&1
```

## Troubleshooting

**`Auth failed: code=10003`**: Invalid app ID or secret. Double-check credentials.

**`No group chats found`**: The bot is not added to any Feishu groups. Add it via group settings -> Apps.

**`chat oc_xxx messages unavailable: code=230002`**: Bot was removed from the chat or was never added. Remove the chat ID from `FEISHU_CHATS` or re-add the bot.

**`code=230003`**: Missing `im:message:readonly` scope. Re-check app permissions and republish.

**Sender IDs show as `ou_..xxxxxx`**: User name resolution requires `contact:user.base:readonly` scope (optional, not implemented in v0.1.0).
