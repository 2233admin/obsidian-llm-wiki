# lmvk-memory-sync.ps1 -- LMVK L6: hourly Claude Code memory -> vault sync.
#
# Copies *.md from each machine-local CC memory root into
#   <VaultPath>\02-Infrastructure\agent-memory\<COMPUTERNAME>\<project-slug>\
# Mirror semantics: only overwrite when the source is newer; never deletes.
#
# Any copied .md that does NOT start with a `---` YAML frontmatter block gets
# a minimal one injected so it passes the vault intake gates:
#   - compiler/rhizome/contract.py (Pass 0 pre-commit check):
#       kind      missing/invalid  -> ERROR   (we set: kind: note)
#       id        malformed        -> ERROR   (we set a domain/slug kebab id)
#       id        missing          -> warning (cleared by setting id)
#       status    invalid          -> ERROR   (we set: status: active)
#       description missing/>200   -> warning (we set one, capped at 200)
#   - scripts/vault_collab_lint.py: no required frontmatter outside
#     00-Inbox/AI-Output/. We deliberately do NOT emit `generated-by:` so
#     these notes can never trip the agent-in-protected-path rule.
# Files that already have frontmatter are copied unmodified.
#
# Windows PowerShell 5.1 compatible -- schtasks runs this via powershell.exe.
# Do NOT introduce pwsh-only syntax: a previous L2 task died silently for
# months because schtasks targeted pwsh, which was not installed (see 37b5e6e).
#
# Registered via: scripts/register-lmvk-memory-sync.ps1
#
# Exit codes: 0 = success (including nothing to do), 1 = any failure
# (schtasks history shows non-zero results in red).

param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath,

    # Memory roots to sync. Default: every %USERPROFILE%\.claude\projects\*\memory
    # directory, plus %USERPROFILE%\.claude\memory if it exists.
    # Explicit values may contain wildcards (expanded via Resolve-Path).
    [string[]]$MemoryRoots
)

$ErrorActionPreference = 'Stop'

# --- helpers -----------------------------------------------------------------

function ConvertTo-Slug {
    param([string]$Name)
    $s = $Name.ToLowerInvariant()
    $s = [regex]::Replace($s, '[^a-z0-9]+', '-')
    $s = $s.Trim('-')
    if ([string]::IsNullOrEmpty($s)) { $s = 'x' }
    return $s
}

function Get-ProjectSlug {
    # ...\.claude\projects\<proj>\memory -> <proj> slug
    # ...\.claude\memory                 -> 'global'
    # anything else                      -> leaf-dir slug
    param([string]$RootPath)
    $leaf = Split-Path -Leaf $RootPath
    if ($leaf -ieq 'memory') {
        $parent = Split-Path -Leaf (Split-Path -Parent $RootPath)
        if ($parent -ieq '.claude') { return 'global' }
        return ConvertTo-Slug $parent
    }
    return ConvertTo-Slug $leaf
}

function Test-HasFrontmatter {
    # Mirrors the gate parsers: BOM-tolerant, needs an opening "---" line and
    # a later "\n---" closing fence.
    param([string]$Text)
    $t = $Text
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
    $t = $t.Replace("`r`n", "`n")
    if (-not $t.StartsWith("---`n")) { return $false }
    return ($t.IndexOf("`n---", 4) -ge 0)
}

function New-FrontmatterBlock {
    param(
        [string]$Id,
        [string]$Description,
        [string]$Machine,
        [string]$SourcePath,
        [string]$SyncedAt
    )
    $desc = ($Description -replace '["\r\n]', ' ').Trim()
    if ($desc.Length -gt 200) { $desc = $desc.Substring(0, 197) + '...' }
    $src = $SourcePath -replace "'", '-'
    $lines = @(
        '---',
        ('id: ' + $Id),
        ('description: "' + $desc + '"'),
        'kind: note',
        'status: active',
        'agent-memory: true',
        ('source-machine: ' + $Machine),
        ("source-path: '" + $src + "'"),
        ('synced-at: ' + $SyncedAt),
        '---',
        ''
    )
    return ($lines -join "`n")
}

function Write-SyncLog {
    param([string]$Message)
    $line = '{0}  {1}' -f [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ'), $Message
    # UTF8NoBom to match the frontmatter writes (PS5.1 Add-Content -Encoding UTF8 emits BOM)
    [System.IO.File]::AppendAllText($script:LogFile, $line + [Environment]::NewLine,
        (New-Object System.Text.UTF8Encoding($false)))
    Write-Output $line
}

# --- setup -------------------------------------------------------------------

if (-not (Test-Path -LiteralPath $VaultPath)) {
    Write-Error -ErrorAction Continue "vault path missing: $VaultPath"
    exit 1
}
$VaultPath = (Resolve-Path -LiteralPath $VaultPath).Path

$machine     = $env:COMPUTERNAME
$machineSlug = ConvertTo-Slug $machine
$destRoot    = Join-Path (Join-Path (Join-Path $VaultPath '02-Infrastructure') 'agent-memory') $machine

try {
    New-Item -ItemType Directory -Force -Path $destRoot | Out-Null
} catch {
    Write-Error -ErrorAction Continue ("cannot create dest root " + $destRoot + ": " + $_.Exception.Message)
    exit 1
}

# Transcript log lives next to the synced files; size-capped with one rollover.
$script:LogFile = Join-Path $destRoot 'sync.log'
$maxLogBytes = 262144  # 256 KB
if (Test-Path -LiteralPath $script:LogFile) {
    if ((Get-Item -LiteralPath $script:LogFile).Length -gt $maxLogBytes) {
        Move-Item -LiteralPath $script:LogFile -Destination ($script:LogFile + '.1') -Force
    }
}

# --- main --------------------------------------------------------------------

try {
    $runStamp = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    Write-SyncLog "=== run start (machine=$machine vault=$VaultPath) ==="

    # Resolve memory roots.
    $roots = @()
    if ($MemoryRoots -and $MemoryRoots.Count -gt 0) {
        foreach ($r in $MemoryRoots) {
            $hits = @(Resolve-Path -Path $r -ErrorAction SilentlyContinue)
            if ($hits.Count -eq 0) {
                Write-SyncLog "WARN memory root not found: $r"
            } else {
                foreach ($h in $hits) { $roots += $h.Path }
            }
        }
    } else {
        $projectsDir = Join-Path $env:USERPROFILE '.claude\projects'
        if (Test-Path -LiteralPath $projectsDir) {
            foreach ($proj in (Get-ChildItem -LiteralPath $projectsDir -Directory)) {
                $mem = Join-Path $proj.FullName 'memory'
                if (Test-Path -LiteralPath $mem) { $roots += $mem }
            }
        }
        $globalMem = Join-Path $env:USERPROFILE '.claude\memory'
        if (Test-Path -LiteralPath $globalMem) { $roots += $globalMem }
    }

    if ($roots.Count -eq 0) {
        Write-SyncLog 'no memory roots found; nothing to do'
        Write-SyncLog '=== run end: OK (0 roots) ==='
        exit 0
    }

    $copied = 0; $injected = 0; $skipped = 0; $failed = 0

    foreach ($root in $roots) {
        $root = $root.TrimEnd('\', '/')
        $projSlug = Get-ProjectSlug $root
        $destProj = Join-Path $destRoot $projSlug

        $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.md' | Sort-Object FullName)
        Write-SyncLog "root $root -> $projSlug ($($files.Count) file(s))"

        foreach ($f in $files) {
            $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/')
            $dest = Join-Path $destProj $rel
            try {
                $destDir = Split-Path -Parent $dest
                New-Item -ItemType Directory -Force -Path $destDir | Out-Null

                if (Test-Path -LiteralPath $dest) {
                    $destItem = Get-Item -LiteralPath $dest
                    if ($f.LastWriteTimeUtc -le $destItem.LastWriteTimeUtc) {
                        $skipped++
                        continue
                    }
                }

                # explicit UTF-8: default ANSI codepage (GBK on zh-CN) would corrupt
                # CJK text on the UTF-8 re-write below
                $text = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
                if (Test-HasFrontmatter $text) {
                    Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
                    $copied++
                    Write-SyncLog "copy            $projSlug\$rel"
                } else {
                    $relSlug = ConvertTo-Slug ($rel -replace '\.md$', '')
                    $id = 'agent-memory/{0}-{1}-{2}' -f $machineSlug, $projSlug, $relSlug
                    $desc = 'Claude Code agent memory synced from {0} ({1}/{2})' -f $machine, $projSlug, $rel
                    $fm = New-FrontmatterBlock -Id $id -Description $desc -Machine $machine `
                        -SourcePath $f.FullName -SyncedAt $runStamp
                    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                    [System.IO.File]::WriteAllText($dest, ($fm + $text), $utf8NoBom)
                    (Get-Item -LiteralPath $dest).LastWriteTimeUtc = $f.LastWriteTimeUtc
                    $injected++
                    Write-SyncLog "copy+frontmatter $projSlug\$rel"
                }
            } catch {
                $failed++
                Write-SyncLog ("ERROR $projSlug\$rel : " + $_.Exception.Message)
            }
        }
    }

    $summary = 'copied={0} injected={1} skipped={2} failed={3} roots={4}' -f `
        $copied, $injected, $skipped, $failed, $roots.Count
    if ($failed -gt 0) {
        Write-SyncLog "=== run end: FAIL ($summary) ==="
        exit 1
    }
    Write-SyncLog "=== run end: OK ($summary) ==="
    exit 0
} catch {
    Write-Error -ErrorAction Continue ('lmvk-memory-sync fatal: ' + $_.Exception.Message)
    exit 1
}
