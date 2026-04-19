# obsidian-llm-wiki setup (PowerShell)
# Usage: .\setup.ps1 [-Host <name>] [-DryRun]

param(
  [string]$Host = "claude",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$SkillName = "vault-wiki"
switch ($Host) {
  "claude"   { $SkillsDir = "$HOME\.claude\skills\$SkillName" }
  "codex"    { $SkillsDir = "$HOME\.codex\skills\$SkillName" }
  "opencode" { $SkillsDir = "$HOME\.config\opencode\skills\$SkillName" }
  "gemini"   { $SkillsDir = "$HOME\.gemini\skills\$SkillName" }
  default {
    Write-Error "Unknown --host '$Host'. Expected: claude, codex, opencode, gemini"
    exit 1
  }
}

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = "." }

$VaultPath = if ($env:VAULT_PATH) { $env:VAULT_PATH } else { $ScriptDir }

$ParentDir = Split-Path $SkillsDir -Parent
if (-not (Test-Path $ParentDir)) {
  Write-Error "Host directory not found: $ParentDir"
  Write-Error "Is $Host installed?"
  exit 1
}

if ($DryRun) {
  Write-Host "[dry-run] Would copy $ScriptDir to $SkillsDir" -ForegroundColor Cyan
} else {
  New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null
  Copy-Item -Path "$ScriptDir\*" -Destination $SkillsDir -Recurse -Force
  Remove-Item -Path "$SkillsDir\setup*" -Force -ErrorAction SilentlyContinue
  Write-Host "Installed to: $SkillsDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Set your vault path: `$env:VAULT_PATH = 'YOUR_VAULT_PATH'"
Write-Host "2. Add vault-mind to your .mcp.json (see .mcp.json snippet below)"
Write-Host "3. Add persona section to CLAUDE.md (see below)"
Write-Host "4. Try: /vault-librarian what is attention heads"
Write-Host "5. View graph: open https://obsidian-llm-wiki.vercel.app"
Write-Host ""
Write-Host ".mcp.json snippet:"
Write-Host @"
{
  "mcpServers": {
    "vault-mind": {
      "command": "node",
      "args": ["PATH/TO/SKILL/mcp-server/dist/index.js"],
      "env": { "VAULT_PATH": "YOUR_VAULT_PATH" }
    }
  }
}
"@
Write-Host ""
Write-Host "CLAUDE.md Personas section:"
Write-Host @"
## Vault Personas

Your markdown vault is managed by a 6-persona virtual team:

| Persona | Skill | What it does |
|---------|-------|--------------|
| Librarian  | /vault-librarian  | Search + read with citations |
| Architect  | /vault-architect  | Run concept_graph, summarize changes |
| Curator    | /vault-curator     | Detect orphans, stale notes, duplicates |
| Teacher    | /vault-teacher     | Explain how a concept relates to others |
| Historian  | /vault-historian   | Time-window search by mtime |
| Janitor    | /vault-janitor     | Propose orphan/duplicate/broken-link fixes |
"@
