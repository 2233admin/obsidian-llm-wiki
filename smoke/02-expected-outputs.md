# Expected Outputs: End-to-End Smoke Test

## Step 1: Setup
- Fresh temp directory created
- `MINIMAX_TOKEN` exported in shell environment

## Step 2: Install
- `./setup` clones repo to `~/.claude/skills/vault-wiki/`
- `.mcp.json` snippet printed to stdout
- CLAUDE.md section with 6 personas printed to stdout

## Step 3: MCP Server
- `node mcp-server/dist/index.js` launches without error
- Server listens on expected port (verify with `curl` or `nc`)
- Demo vault at `examples/demo-vault/` is accessible

## Step 4: Terrarium
- `kt terrarium run @vault-wiki/terrariums/vault-wiki-team` starts
- All 6 creatures + root initialize
- `tasks`, `results`, `team_chat` channels active

## Step 5: Librarian Query
- Send to `tasks` channel: `"what do I know about attention heads"`
- Message routes to `vault-librarian`

## Step 6: Assert Output
- Response appears on `results` channel within 60 seconds
- Response contains citation to `attention-heads.md`
- Citation is from demo vault, not fabricated

## Step 7: Teardown
- `kt terrarium stop` terminates all creatures
- Temp directory removed

## Success Criteria
- At least 2 creatures exercised (librarian + architect/curator/janitor)
- Citation to real file in demo vault present
- No hardcoded secrets in any output
