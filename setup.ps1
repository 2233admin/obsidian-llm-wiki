# LLMwiki setup -- legacy-compatible host skill install.
#
# Claude Code users should prefer:
# /plugin marketplace add 2233admin/obsidian-llm-wiki
# /plugin install llmwiki@obsidian-llm-wiki

param(
  [ValidateSet("claude", "codex", "opencode", "gemini")]
  [string]$VaultHost = "claude",

  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) {
  $ScriptDir = "."
}

$ManifestPath = Join-Path $ScriptDir "packaging\llmwiki-distribution.json"
if (-not (Test-Path $ManifestPath)) {
  Write-Error "Missing distribution manifest: $ManifestPath"
  exit 1
}

$Manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
$HostConfig = $Manifest.hosts.$VaultHost
if (-not $HostConfig) {
  Write-Error "Unknown -VaultHost '$VaultHost'."
  exit 1
}

$SkillsDir = $HostConfig.skillsDir.Replace("{home}", $HOME).Replace("{legacySkillBundle}", $Manifest.legacySkillBundle)
$SkillsDir = $SkillsDir -replace "/", [System.IO.Path]::DirectorySeparatorChar

$BundlePath = Join-Path $ScriptDir "mcp-server\bundle.js"
if (-not (Test-Path $BundlePath)) {
  Write-Error @"
mcp-server\bundle.js not found at $BundlePath

Build it first:
  cd mcp-server; npm install; npm run rebuild

Released tarballs ship bundle.js pre-built; this usually only happens when
installing from an actively changing source checkout.
"@
  exit 1
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  if ($DryRun) {
    Write-Host "[dry-run] $Description"
  } else {
    & $Action
  }
}

function Copy-PathOrDryRun {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  if (-not (Test-Path $Source)) {
    return
  }

  Invoke-Step "copy $Source -> $Destination" {
    Copy-Item -Path $Source -Destination $Destination -Recurse -Force
  }
}

$ParentDir = Split-Path $SkillsDir -Parent
if ((-not (Test-Path $ParentDir)) -and (-not $DryRun)) {
  Write-Error "Host skills directory not found: $ParentDir`nInstall or launch $VaultHost once, then re-run setup."
  exit 1
}

Invoke-Step "mkdir $SkillsDir" {
  New-Item -ItemType Directory -Force -Path $SkillsDir | Out-Null
}

foreach ($dir in $Manifest.install.copyDirs) {
  Copy-PathOrDryRun -Source (Join-Path $ScriptDir $dir) -Destination $SkillsDir
}

foreach ($file in $Manifest.install.copyFiles) {
  Copy-PathOrDryRun -Source (Join-Path $ScriptDir $file) -Destination $SkillsDir
}

$McpDest = Join-Path $SkillsDir "mcp-server"
Invoke-Step "mkdir $McpDest" {
  New-Item -ItemType Directory -Force -Path $McpDest | Out-Null
}

foreach ($file in $Manifest.install.mcpFiles) {
  Copy-PathOrDryRun -Source (Join-Path $ScriptDir $file) -Destination $McpDest
}

$InstalledSkills = 0
foreach ($skill in $Manifest.install.topLevelSkills) {
  $skillDir = Join-Path $ScriptDir "skills\$skill"
  $skillMd = Join-Path $skillDir "SKILL.md"
  if (-not (Test-Path $skillMd)) {
    continue
  }

  $destDir = Join-Path $ParentDir $skill
  Invoke-Step "mkdir $destDir" {
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  }
  Copy-PathOrDryRun -Source (Join-Path $skillDir "*") -Destination $destDir
  $InstalledSkills++
}

$InstallPath = (Join-Path $SkillsDir "mcp-server\bundle.js") -replace "\\", "/"

Write-Host @"

$($Manifest.displayName) installed to legacy-compatible skill bundle:
  $SkillsDir
Top-level skills registered: $InstalledSkills

Next steps for ${VaultHost}:
1. Add this MCP entry to your host config:

{"mcpServers":{"$($Manifest.mcpServerName)":{"command":"node","args":["$InstallPath"],"env":{"$($Manifest.vaultPathEnv)":"YOUR_VAULT_PATH"}}}}

2. Restart $VaultHost and ask a cited vault question, for example:
   What do I know about attention heads? Use vault/search tools and cite notes.

Claude Code users can skip this script and use the plugin path instead:
  $($Manifest.pluginInstall.marketplace)
  $($Manifest.pluginInstall.install)

Manifest source: packaging/llmwiki-distribution.json ($($Manifest.publicName))
"@
