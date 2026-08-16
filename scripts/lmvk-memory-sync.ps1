# lmvk-memory-sync.ps1 -- LMVK L6: hourly Claude Code memory -> vault sync.
#
# Copies *.md from each machine-local CC memory root into
#   <VaultPath>\02-Infrastructure\agent-memory\<COMPUTERNAME>\<project-slug>\
# Mirror semantics: only overwrite when the source is newer; never deletes.
#
# Every copied .md is made to satisfy the vault intake gates. The test is
# "does the frontmatter carry the required KEYS", not "is there a `---` block
# at all" -- Claude Code memory files have a block (name/description/metadata)
# with none of the required keys, and treating those as already-compliant is
# what wedged the vault on 2026-08-17 (see Test-SatisfiesContract). Three cases:
#   - required keys present    -> copied byte-for-byte
#   - block present, keys missing -> missing keys spliced into the block
#   - no block at all          -> a minimal block is prepended
# The gates being satisfied:
#   - compiler/rhizome/contract.py (Pass 0 pre-commit check):
#       kind      missing/invalid  -> ERROR   (we set: kind: note)
#       id        malformed        -> ERROR   (we set a domain/slug kebab id)
#       id        missing          -> warning (cleared by setting id)
#       status    invalid          -> ERROR   (we set: status: active)
#       description missing/>200   -> warning (we set one, capped at 200)
#   - scripts/vault_collab_lint.py: no required frontmatter outside
#     00-Inbox/AI-Output/. We deliberately do NOT emit `generated-by:` so
#     these notes can never trip the agent-in-protected-path rule.
#
# Mirror semantics: overwrite when the source is newer OR when the existing
# destination does not satisfy the contract (self-heal); never deletes.
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

# Fields rhizome's contract check treats as required (compiler/rhizome/contract.py).
# `kind` missing is a hard ERROR; `id` missing is a warning but trivially fixable;
# `status` we set for completeness. Keep in sync with New-FrontmatterBlock.
$script:RequiredFrontmatterKeys = @('id', 'kind', 'status')

function Get-FrontmatterTopLevelKeys {
    # Top-level (column 0) mapping keys inside the frontmatter block. Nested
    # keys (e.g. Claude Code memory's `metadata:` children) are indented and
    # deliberately excluded -- the gate only reads top-level fields.
    param([string]$Text)
    $t = $Text
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
    $t = $t.Replace("`r`n", "`n")
    if (-not $t.StartsWith("---`n")) { return @() }
    $end = $t.IndexOf("`n---", 4)
    if ($end -lt 0) { return @() }
    $block = $t.Substring(4, $end - 4)
    $keys = @()
    foreach ($line in $block.Split("`n")) {
        $m = [regex]::Match($line, '^([A-Za-z0-9_-]+)\s*:')
        if ($m.Success) { $keys += $m.Groups[1].Value }
    }
    return $keys
}

function Test-SatisfiesContract {
    # TRUE only when the frontmatter carries every required key.
    #
    # This is the predicate the copy loop must branch on -- NOT the mere
    # presence of a `---` block. Claude Code's own memory files ship
    # frontmatter (name / description / metadata) that has none of the
    # required keys, so a has-frontmatter test sends every single one down
    # the copy-unmodified path and the injection below never fires. Observed
    # 2026-08-17: 213 synced notes rejected by the pre-commit gate
    # ("[kind] missing"), left staged-but-uncommitted in D:\knowledge, which
    # blocked `git pull` ("local changes would be overwritten by merge") and
    # took the 15-minute lmvk-compile-publish task down with it.
    param([string]$Text)
    if (-not (Test-HasFrontmatter $Text)) { return $false }
    $keys = Get-FrontmatterTopLevelKeys $Text
    foreach ($req in $script:RequiredFrontmatterKeys) {
        if ($keys -notcontains $req) { return $false }
    }
    return $true
}

function Add-MissingFrontmatterFields {
    # Splice the missing required keys into an EXISTING frontmatter block.
    # Prepending a second `---` block instead would produce two documents and
    # break every YAML parser downstream, so the keys go in right after the
    # opening fence. Existing keys are never touched -- author intent wins.
    param(
        [string]$Text,
        [string]$Id
    )
    $bom = ''
    $t = $Text
    if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $bom = [char]0xFEFF; $t = $t.Substring(1) }
    $nl = if ($t.Contains("`r`n")) { "`r`n" } else { "`n" }

    $existing = Get-FrontmatterTopLevelKeys $t
    $inject = @()
    if ($existing -notcontains 'id')     { $inject += ('id: ' + $Id) }
    if ($existing -notcontains 'kind')   { $inject += 'kind: note' }
    if ($existing -notcontains 'status') { $inject += 'status: active' }
    if ($inject.Count -eq 0) { return $Text }

    # Insert after the opening fence, preserving the file's own line ending.
    $fence = '---' + $nl
    $idx = $t.IndexOf($fence)
    if ($idx -ne 0) { return $Text }   # defensive: not actually frontmatter
    $head = $t.Substring(0, $fence.Length)
    $rest = $t.Substring($fence.Length)
    return $bom + $head + (($inject -join $nl) + $nl) + $rest
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

    $copied = 0; $injected = 0; $repaired = 0; $skipped = 0; $failed = 0

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

                # Mirror semantics with a self-healing clause: a dest that is
                # already up to date is still rewritten when it does not
                # satisfy the intake contract. Without this, files written by
                # an earlier (buggy) run stay broken forever -- they are never
                # "older than source" again, so a pure mtime test skips them
                # and the gate keeps rejecting them every commit.
                if (Test-Path -LiteralPath $dest) {
                    $destItem = Get-Item -LiteralPath $dest
                    if ($f.LastWriteTimeUtc -le $destItem.LastWriteTimeUtc) {
                        $destText = [System.IO.File]::ReadAllText($dest, [System.Text.Encoding]::UTF8)
                        if (Test-SatisfiesContract $destText) {
                            $skipped++
                            continue
                        }
                    }
                }

                # explicit UTF-8: default ANSI codepage (GBK on zh-CN) would corrupt
                # CJK text on the UTF-8 re-write below
                $text = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
                $relSlug = ConvertTo-Slug ($rel -replace '\.md$', '')
                $id = 'agent-memory/{0}-{1}-{2}' -f $machineSlug, $projSlug, $relSlug
                $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

                if (Test-SatisfiesContract $text) {
                    # Already gate-clean at the source -- byte-for-byte copy.
                    Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
                    $copied++
                    Write-SyncLog "copy            $projSlug\$rel"
                } elseif (Test-HasFrontmatter $text) {
                    # Has frontmatter, just not the required keys. This is the
                    # common case for Claude Code memory (name/description/
                    # metadata) -- splice the missing keys in, keep the rest.
                    $merged = Add-MissingFrontmatterFields -Text $text -Id $id
                    [System.IO.File]::WriteAllText($dest, $merged, $utf8NoBom)
                    (Get-Item -LiteralPath $dest).LastWriteTimeUtc = $f.LastWriteTimeUtc
                    $repaired++
                    Write-SyncLog "copy+fields     $projSlug\$rel"
                } else {
                    $desc = 'Claude Code agent memory synced from {0} ({1}/{2})' -f $machine, $projSlug, $rel
                    $fm = New-FrontmatterBlock -Id $id -Description $desc -Machine $machine `
                        -SourcePath $f.FullName -SyncedAt $runStamp
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

    $summary = 'copied={0} injected={1} repaired={2} skipped={3} failed={4} roots={5}' -f `
        $copied, $injected, $repaired, $skipped, $failed, $roots.Count
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
