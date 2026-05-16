# Cross-Device Vault Sync Verification

LLMwiki does not synchronize files between devices. It reads and writes the
local markdown vault configured by `VAULT_MIND_VAULT_PATH` or `vault-mind.yaml`.
Cross-device consistency is therefore verified at the markdown vault layer:
write a probe on device A, let the external sync tool copy it, then confirm
device B can see it through MCP tools.

## Preconditions

- Both devices run the same LLMwiki release, such as `v2.1.0`, or the same git
  commit.
- Both devices point LLMwiki at their local copy of the same synced vault:
  - Windows example: `VAULT_MIND_VAULT_PATH=D:\SynologyDrive\Vault`
  - macOS/Linux example: `VAULT_MIND_VAULT_PATH=~/SynologyDrive/Vault`
- The MCP server has been built or installed. In a source checkout, run the
  normal MCP build first so `mcp-server/dist/index.js` exists, or use the
  packaged `mcp-server/bundle.js`.

## Device A -> Device B

On device A, write a probe through the MCP server:

```bash
python scripts/mcp_sync_probe.py write \
  --vault "D:\SynologyDrive\Vault" \
  --path "00-Inbox/sync-probe-2026-05-16-a.md"
```

The command prints a JSON object containing the `path` and unique `token`.
Wait for the external sync tool to finish.

On device B, verify the synced file through MCP:

```bash
python scripts/mcp_sync_probe.py verify \
  --vault "$HOME/SynologyDrive/Vault" \
  --path "00-Inbox/sync-probe-2026-05-16-a.md" \
  --token "llmwiki-sync-probe-YYYYMMDDTHHMMSSZ" \
  --wait 120
```

The verification calls:

- `vault.exists` for the probe path
- `vault.read` and checks the unique token
- `vault.search` and checks the probe path appears in search results

It also fails if the probe content contains the verifier's absolute local vault
path, which catches device-specific path pollution in the note body.

## Device B -> Device A

Repeat in the other direction with a fresh path:

```bash
python scripts/mcp_sync_probe.py write \
  --vault "$HOME/SynologyDrive/Vault" \
  --path "00-Inbox/sync-probe-2026-05-16-b.md"
```

Then verify on device A with the printed token:

```bash
python scripts/mcp_sync_probe.py verify \
  --vault "D:\SynologyDrive\Vault" \
  --path "00-Inbox/sync-probe-2026-05-16-b.md" \
  --token "llmwiki-sync-probe-YYYYMMDDTHHMMSSZ" \
  --wait 120
```

## Acceptance Criteria

- Both directions pass verification from the other device.
- `vault.read` returns the exact token written by the source device.
- `vault.search` returns the probe note for the token.
- Probe note content does not contain local absolute vault paths.
- The GitHub repository remains clean: `.claude`, `.outreach`, `.repowise`,
  `.cocoindex_code`, local lockfiles, and tool state directories stay untracked.

## Repository Cleanliness Check

Run this from the source checkout:

```bash
git status --ignored --short
git ls-files .claude .outreach .repowise .cocoindex_code package-lock.json .github/workflows
```

Expected result: local tool directories may appear as `!!` ignored entries, but
only `.github/workflows/*` should appear in the tracked-file list from the paths
above.
