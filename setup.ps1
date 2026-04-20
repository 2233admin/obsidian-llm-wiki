# obsidian-llm-wiki setup (PowerShell)
# Usage: .\setup.ps1 [-VaultHost <name>] [-DryRun]
#
# Copies a curated allowlist into the host's skills directory.
# ~1.7 MB install (vs 64 MB of repo) -- ships a pre-bundled MCP server
# so the user doesn't need to npm install anything.

param(
  [string]$VaultHost = "claude",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$SkillName = "vault-wiki"
switch ($VaultHost) {
  "claude"   { $SkillsDir = "$HOME\.claude\skills\$SkillName" }
  "codex"    { $SkillsDir = "$HOME\.codex\skills\$SkillName" }
  "opencode" { $SkillsDir = "$HOME\.config\opencode\skills\$SkillName" }
  "gemini"   { $SkillsDir = "$HOME\.gemini\skills\$SkillName" }
  default {
    Write-Error "Unknown -VaultHost '$VaultHost'. Expected: claude, codex, opencode, gemini"
    exit 1
  }
}

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = "." }

# Bundle must exist before install. Fail loud so paste-install users see
# the real cause instead of a missing-file error at MCP boot.
$BundlePath = Join-Path $ScriptDir "mcp-server\bundle.js"
if (-not (Test-Path $BundlePath)) {
  Write-Error @"
mcp-server\bundle.js not found at $BundlePath

Build it first:
  cd mcp-server; npm install; npm run rebuild

(Released tarballs ship bundle.js pre-built; this only happens
when installing from a fresh source clone.)
"@
  exit 1
}

$ParentDir = Split-Path $SkillsDir -Parent
if (-not (Test-Path $ParentDir)) {
  Write-Error "Host directory not found: $ParentDir`nIs $VaultHost installed?"
  exit 1
}

function Copy-Item-OrDryRun {
  param([string]$Source, [string]$Destination, [switch]$Recurse)
  if ($DryRun) {
    Write-Host "[dry-run] copy $Source -> $Destination"
  } else {
    if ($Recurse) {
      Copy-Item -Path $Source -Destination $Destination -Recurse -Force
    } else {
      Copy-Item -Path $Source -Destination $Destination -Force
    }
  }
}

if ($DryRun) {
  Write-Host "[dry-run] mkdir $SkillsDir"
} else {
  New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null
}

# Allowlist copy. Anything not listed here is excluded from the install.
$AllowlistDirs  = @("skills", "examples", "docs", "terrariums", "viewer", "smoke")
$AllowlistFiles = @("README.md", "CHANGELOG.md", "RELEASE_NOTES.md", "vercel.json")

foreach ($d in $AllowlistDirs) {
  $src = Join-Path $ScriptDir $d
  if (Test-Path $src) {
    Copy-Item-OrDryRun -Source $src -Destination $SkillsDir -Recurse
  }
}

foreach ($f in $AllowlistFiles) {
  $src = Join-Path $ScriptDir $f
  if (Test-Path $src) {
    Copy-Item-OrDryRun -Source $src -Destination $SkillsDir
  }
}

# mcp-server: ship only bundle.js + package.json
$McpDest = Join-Path $SkillsDir "mcp-server"
if ($DryRun) {
  Write-Host "[dry-run] mkdir $McpDest"
} else {
  New-Item -ItemType Directory -Force -Path $McpDest | Out-Null
}
Copy-Item-OrDryRun -Source (Join-Path $ScriptDir "mcp-server\bundle.js")    -Destination $McpDest
Copy-Item-OrDryRun -Source (Join-Path $ScriptDir "mcp-server\package.json") -Destination $McpDest

$InstallPath = (Join-Path $SkillsDir "mcp-server\bundle.js") -replace '\\', '/'

if (-not $DryRun) {
  Write-Host "Installed to: $SkillsDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Set your vault path: `$env:VAULT_PATH = 'YOUR_VAULT_PATH'"
Write-Host "2. Add vault-mind to your .mcp.json (snippet below)"
Write-Host "3. Add persona section to CLAUDE.md (snippet below)"
Write-Host "4. Try: /vault-librarian what is attention heads"
Write-Host "5. View graph: open https://obsidian-llm-wiki.vercel.app"
Write-Host ""
Write-Host ".mcp.json snippet:"
Write-Host @"
{
  "mcpServers": {
    "vault-mind": {
      "command": "node",
      "args": ["$InstallPath"],
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
