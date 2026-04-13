---
id: x-to-vault
name: X-to-Vault
version: 0.1.0
description: Twitter/X timeline + mentions -> vault research notes
category: sense
secrets:
  - name: X_BEARER_TOKEN
    description: Twitter API v2 Bearer token (read-only)
    where: https://developer.x.com/portal/projects-and-apps
health_checks:
  - command: 'curl -sf -H "Authorization: Bearer $X_BEARER_TOKEN" "https://api.x.com/2/users/me" && echo OK'
setup_time: 15 min
cost_estimate: "$0 (read-only free tier, 1500 tweets/month)"
---

# X-to-Vault

Syncs your Twitter/X timeline and mentions into vault research notes. Each sync produces a dated digest file in `04-Research/x-digest/` formatted for compile.py consumption.

## What it does

- Fetches your timeline tweets (up to 100/sync) and mentions
- Filters out retweets and known bot accounts
- Groups tweets by author and generates a dated `digests/{YYYY-MM-DD}.md`
- Stores raw API responses in `raw/{tweet_id}.json` for replay
- Tracks pagination state in `state.json` for incremental syncs

## Output location

Runtime state: `~/.vault-mind/recipes/x-to-vault/`
Vault notes: `{vault}/04-Research/x-digest/`

## Setup

### Step 1: Get your Bearer Token

1. Go to https://developer.x.com/portal/projects-and-apps
2. Create a project (Free tier is sufficient for read-only)
3. Copy the **Bearer Token** from the "Keys and Tokens" tab

### Step 2: Set the environment variable

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, or Windows environment variables):

```
export X_BEARER_TOKEN="your-bearer-token-here"
```

### Step 3: Verify access

Run the health check:
```bash
curl -sf -H "Authorization: Bearer $X_BEARER_TOKEN" "https://api.x.com/2/users/me"
```

Expected: JSON response with your user ID and username.

### Step 4: Run first sync

```bash
cd D:/projects/vault-mind
node --loader ts-node/esm recipes/collectors/x-collector.ts
```

Or with Bun:
```bash
bun run recipes/collectors/x-collector.ts
```

## Cron schedule (optional)

```
# Every 30 minutes
*/30 * * * * cd <VAULT_MIND_DIR> && bun run recipes/collectors/x-collector.ts >> ~/.vault-mind/recipes/x-to-vault/cron.log 2>&1

# Compile digest -> vault 3x/day
0 8,14,22 * * * cd <VAULT_MIND_DIR> && python mcp-server/kb_meta.py compile 04-Research/x-digest --tier haiku >> ~/.vault-mind/recipes/x-to-vault/compile.log 2>&1
```

## Rate limits

- Free tier: 1,500 tweets/month read limit
- The collector tracks usage in `state.json` and backs off when approaching limits
- Timeline only (no search) -- search requires Basic tier ($100/month)

## Troubleshooting

**`401 Unauthorized`**: Bearer token invalid or expired. Regenerate at developer.x.com.
**`429 Too Many Requests`**: Rate limit hit. Wait 15 minutes. Collector will auto-retry.
**`403 Forbidden`**: Your app may need "Read" permissions enabled in the portal.
