# LLM Wiki setup (PowerShell)
# Usage: .\setup.ps1 [-VaultHost <name>] [-DryRun]
#
# Copies a curated allowlist into the host's skills directory.
# ~1.7 MB install (vs 64 MB of repo) -- ships a pre-bundled MCP server
# so the user doesn't need to npm install anything.

param(
  [string]$VaultHost = "claude",
  [switch]$DryRun,
  [switch]$Doctor,
  [switch]$List
)

$ErrorActionPreference = "Stop"

$SkillName = "vault-wiki"
$SupportedHosts = @("claude", "codex", "opencode", "gemini")
switch ($VaultHost) {
  "claude"   { $SkillsDir = "$HOME\.claude\skills\$SkillName" }
  "codex"    { $SkillsDir = "$HOME\.codex\skills\$SkillName" }
  "opencode" { $SkillsDir = "$HOME\.config\opencode\skills\$SkillName" }
  "gemini"   { $SkillsDir = "$HOME\.gemini\skills\$SkillName" }
  default {
    Write-Error "Unknown -VaultHost '$VaultHost'. Expected: $($SupportedHosts -join ', ')"
    exit 1
  }
}

$ScriptDir = $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = "." }

# -Doctor: run MCP server verification and exit
if ($Doctor) {
    $checksFailed = $false

    Write-Host "LLM Wiki doctor check"
    Write-Host "===================="
    Write-Host ""

    # (a) bundle exists
    $bundlePath = Join-Path $ScriptDir "mcp-server\bundle.js"
    if (Test-Path $bundlePath) {
        Write-Host "[PASS] (a) Bundle exists: $bundlePath"
    } else {
        Write-Host "[FAIL] (a) Bundle not found: $bundlePath"
        $checksFailed = $true
    }

    # (b) server starts
    if (Test-Path $bundlePath) {
        try {
            $null = & node $bundlePath --version 2>$null
            Write-Host "[PASS] (b) Server starts"
        } catch {
            Write-Host "[FAIL] (b) Server failed to start"
            $checksFailed = $true
        }
    }

    # (c) vault path set
    $vaultVal = $env:VAULT_MIND_VAULT_PATH
    if (-not $vaultVal) { $vaultVal = $env:VAULT_PATH }
    if ($vaultVal) {
        Write-Host "[PASS] (c) Vault path set: $vaultVal"
    } else {
        Write-Host "[FAIL] (c) VAULT_MIND_VAULT_PATH or VAULT_PATH is not set"
        $checksFailed = $true
    }

    # (d) first vault operation via llmwiki_doctor.py
    $doctorScript = Join-Path $ScriptDir "scripts\llmwiki_doctor.py"
    if (Test-Path $doctorScript) {
        if ($vaultVal) {
            try {
                $result = & python $doctorScript --vault $vaultVal --json 2>$null | ConvertFrom-Json
                if ($result.ok -eq $true) {
                    Write-Host "[PASS] (d) Vault operation succeeds"
                } else {
                    Write-Host "[FAIL] (d) llmwiki_doctor.py reported non-ok result"
                    $checksFailed = $true
                }
            } catch {
                Write-Host "[FAIL] (d) llmwiki_doctor.py failed"
                $checksFailed = $true
            }
        }
    } else {
        Write-Host "[WARN] (d) llmwiki_doctor.py not found -- skipping"
    }

    Write-Host ""
    if ($checksFailed) {
        Write-Host "Some checks failed."
        exit 1
    } else {
        Write-Host "All checks passed."
        exit 0
    }
}

# -List: print supported hosts and exit
if ($List) {
    Write-Host "Supported hosts: $($SupportedHosts -join ' ')"
    exit 0
}

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

# Register every vault skill at the host skill root so hosts that expose
# skill/slash-command discovery do not need to know about vault-wiki/skills.
$InstalledSkills = 0
$SkillRoot = Join-Path $ScriptDir "skills"
if (Test-Path $SkillRoot) {
  foreach ($skillDir in Get-ChildItem -Path $SkillRoot -Directory) {
    $skillMd = Join-Path $skillDir.FullName "SKILL.md"
    if (-not (Test-Path $skillMd)) { continue }
    $destDir = Join-Path $ParentDir $skillDir.Name
    if ($DryRun) {
      Write-Host "[dry-run] mkdir $destDir"
      Write-Host "[dry-run] copy $($skillDir.FullName)\* -> $destDir"
    } else {
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
      Copy-Item -Path (Join-Path $skillDir.FullName "*") -Destination $destDir -Recurse -Force
    }
    $InstalledSkills++
  }

  foreach ($skillFile in Get-ChildItem -Path $SkillRoot -Filter "*.md" -File) {
    $skill = [System.IO.Path]::GetFileNameWithoutExtension($skillFile.Name)
    $destDir = Join-Path $ParentDir $skill
    if ($DryRun) {
      Write-Host "[dry-run] mkdir $destDir"
      Write-Host "[dry-run] copy $($skillFile.FullName) -> $destDir\SKILL.md"
    } else {
      New-Item -ItemType Directory -Force -Path $destDir | Out-Null
      Copy-Item -Path $skillFile.FullName -Destination (Join-Path $destDir "SKILL.md") -Force
    }
    $InstalledSkills++
  }
}
$InstallPath = (Join-Path $SkillsDir "mcp-server\bundle.js") -replace '\\', '/'

if (-not $DryRun) {
  Write-Host "Installed to: $SkillsDir" -ForegroundColor Green
  Write-Host "Top-level skills registered: $InstalledSkills to $ParentDir" -ForegroundColor Green
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "1. Add vault-mind to your .mcp.json (snippet below)"
Write-Host "2. Add the Vault Roles block below to your host instructions (CLAUDE.md, AGENTS.md, or equivalent)"
Write-Host "3. Restart $VaultHost"
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
      "env": { "VAULT_MIND_VAULT_PATH": "YOUR_VAULT_PATH" }
    }
  }
}
"@
Write-Host ""
Write-Host "Vault Roles block:"
Write-Host @"
## Vault Roles

Your markdown vault is managed by host-neutral LLM Wiki roles:

| Role | Skill | What it does |
|---|---|---|
| Librarian | `/vault-librarian` | Search + read with citations |
| Architect | `/vault-architect` | Run concept graph and summarize changes |
| Curator | `/vault-curator` | Detect orphans, stale notes, duplicates |
| Teacher | `/vault-teacher` | Explain concepts in graph context |
| Historian | `/vault-historian` | Time-window search by mtime |
| Janitor | `/vault-janitor` | Propose cleanup fixes |
| Chubby Ingest | `/chubbyskills` | Install and route multi-platform capture into LLM Wiki |
| X Capture | `/x-to-obsidian` | Save high-signal X posts through Obsidian Web Clipper |
| Closeout | `/vault-agent-closeout` | File agent work into AI-Output draft quarantine |
"@
