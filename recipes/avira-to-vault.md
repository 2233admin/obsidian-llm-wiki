---
id: avira-to-vault
name: Avira / 小红伞 Security Scan to Vault
version: 0.1.0
description: Run a local Avira-compatible antivirus scan command and save the report into the vault
category: sense
secrets:
  - name: AVIRA_SCAN_CMD
    description: Local Avira/小红伞 scan command template. Use {target} where the scan path should be inserted.
    where: Local machine Avira CLI, wrapper script, or enterprise scanner command
health_checks:
  - command: 'node -e "if(!process.env.AVIRA_SCAN_CMD)process.exit(1);console.log(''AVIRA_SCAN_CMD configured'')"'
setup_time: 5 min
cost_estimate: "$0 (uses your local Avira/小红伞 installation)"
requires: []
---

# Avira / 小红伞 Security Scan to Vault

Runs a local Avira-compatible antivirus scan command and writes a Markdown report into the vault so later agent sessions can cite security scan evidence.

LLMwiki does not bundle an antivirus engine and does not upload files. This recipe only orchestrates a local command you configure.

## What it does

- Reads `AVIRA_SCAN_CMD` from the MCP server environment.
- Scans `AVIRA_SCAN_TARGET` when set.
- Otherwise scans `VAULT_MIND_VAULT_PATH`, `VAULT_PATH`, `VAULT_DIR`, or the current working directory.
- Writes reports to `00-Inbox/Security/avira/` when a vault path is configured.
- Falls back to `~/.vault-mind/recipes/avira-to-vault/reports/` when no vault path is configured.
- Appends heartbeat events under `~/.vault-mind/recipes/avira-to-vault/heartbeat.jsonl`.

## Environment

Set a command template. Use `{target}` where the collector should insert the quoted path:

```bash
export AVIRA_SCAN_CMD='avscan {target}'
```

Windows examples vary by Avira edition. Prefer a wrapper script when the executable path or arguments are complex:

```powershell
$env:AVIRA_SCAN_CMD = 'powershell -ExecutionPolicy Bypass -File C:\tools\avira-scan.ps1 {target}'
```

Optional target override:

```bash
export AVIRA_SCAN_TARGET="/path/to/vault/or/project"
```

Optional timeout override:

```bash
export AVIRA_SCAN_TIMEOUT_MS=600000
```

## Run

Through MCP:

```text
recipe.doctor id=avira-to-vault
recipe.run id=avira-to-vault timeout_ms=600000
```

Directly:

```bash
bun run recipes/collectors/avira-collector.ts
```

## Output

```text
00-Inbox/Security/avira/YYYY-MM-DDTHH-mm-ssZ-avira-scan.md
```

The report includes command template, target, exit code, stdout, stderr, and a short interpretation. If Avira returns a non-zero exit code for detections, the report is still written and `recipe.run` returns `ok=false`.

## Safety

- Configure only commands you trust locally.
- Do not put API keys or credentials in `AVIRA_SCAN_CMD`.
- Do not claim a clean scan unless the generated report shows exit code `0`.
- Treat detections, timeouts, or scanner errors as evidence to investigate, not as final remediation.
