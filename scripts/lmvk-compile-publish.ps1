<#
.SYNOPSIS
    LMVK L2 -- compile leg on 5090/5080. Pulls the vault, runs the (currently
    inert-until-topics-exist) LLM incremental compile under a $/day cost
    guard, renders the whole vault to static HTML (zero LLM, 00-Inbox
    excluded), and publishes the result to the `pages` branch of the same
    gitea repo the vault itself lives in.

.DESCRIPTION
    Spec: D:\projects\vault-mind\docs\specs\lmvk-execution-and-release.md (L2)
    ADR:  D:\projects\vault-mind\docs\adr\lmvk-0001-distribution-topology.md

    Pipeline per run:
      1. git pull D:\knowledge. If HEAD unchanged and -Full not passed,
         exit immediately (zero cost -- this is the 15-min-cron fast path).
      2. Cost-guard check (compiler/cost_guard.py). Under the $5/day cap,
         run compiler/scheduler.py --once against D:\knowledge (LMVK L1's
         AgentScheduler; it discovers dirty *topics* -- i.e. <dir>/raw +
         <dir>/wiki -- and shells out to compile.py per topic). D:\knowledge
         has zero such topics today, so this step is a safe no-op until a
         future vault.init 'topic' scaffold creates one; it activates
         automatically then, no script change needed. compile.py reports no
         $ cost, so spend is ESTIMATED from sources-compiled count and
         explicitly logged/recorded as an estimate.
      3. compiler/html_export/exporter.py --direct: pure-render, whole-vault,
         zero LLM, excludes 00-Inbox (wayfinder #20) -- always runs
         regardless of the cost guard.
      4. Build-timestamp footer is stamped by exporter.py itself (defaults
         to "now" UTC) -- no separate injection step needed.
      5. Publish output/ to the `pages` branch of the vault's own gitea repo
         (claudeQWQ/obsidian-knowledge) as a normal (non-force) commit+push;
         the branch is bootstrapped as an orphan on the very first run.

.PARAMETER Full
    Weekly full-pass mode (schtasks: lmvk-compile-full, Sundays 03:00).
    Bypasses the HEAD-unchanged early exit and renders/publishes
    unconditionally. (The LLM side's full-recompile flag on compile.py
    exists but isn't wired through scheduler.py yet -- moot today since
    D:\knowledge has zero topics; noted honestly rather than silently
    pretended-done.)
#>

param(
    [switch]$Full
)

# NOTE: intentionally "Continue", not "Stop". Native tools (python
# DeprecationWarnings etc.) write routine chatter to stderr; with 2>&1
# merging and ErrorActionPreference=Stop, PowerShell 7 promotes that stderr
# text to a terminating error even on exit code 0. Real command failures are
# still caught via explicit $LASTEXITCODE checks in Invoke-Checked (below).
$ErrorActionPreference = "Continue"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
$VaultPath      = "D:\knowledge"
$VaultMindRepo  = "D:\projects\vault-mind"
$CompilerDir    = Join-Path $VaultMindRepo "compiler"
$StateDir       = "C:\Users\Administrator\.claude\state"
$LogDir         = "C:\Users\Administrator\.claude\logs"
$OutputDir      = Join-Path $StateDir "lmvk-html-output"
$PagesWorkDir   = Join-Path $StateDir "lmvk-pages-workdir"
$SpendState     = Join-Path $StateDir "lmvk-compile-spend.json"
$LogFile        = Join-Path $LogDir "lmvk-compile.log"

$PagesRepoUrl   = "https://Curry:$env:GITEA_TOKEN@git.xart.top:8418/claudeQWQ/obsidian-knowledge.git"
$PagesBranch    = "pages"
$DailyCapUsd    = 5.0
# compile.py reports no actual $ cost -- this is a deliberately explicit,
# logged ESTIMATE, not a measurement. Tune once real haiku-tier invoices
# are observed.
$CostPerSourceEstimateUsd = 0.02

$MaxLogBytes = 5MB

New-Item -ItemType Directory -Force -Path $StateDir, $LogDir | Out-Null

# ---------------------------------------------------------------------------
# Logging (simple 1-generation rotation so this never grows unbounded)
# ---------------------------------------------------------------------------
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt $MaxLogBytes)) {
    Move-Item -Force $LogFile "$LogFile.old"
}

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[{0}] [{1}] {2}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"), $Level, $Message
    Add-Content -Path $LogFile -Value $line -Encoding utf8
    Write-Host $line
}

function Invoke-Checked {
    # Runs an external command, logs its output, throws on non-zero exit
    # UNLESS -AllowExit is given (cost_guard's "check" subcommand uses its
    # exit code as a signal, not an error).
    param(
        [string]$Exe,
        [string[]]$Arguments,
        [switch]$AllowNonZero
    )
    Write-Log "RUN: $Exe $($Arguments -join ' ')"
    $out = & $Exe @Arguments 2>&1 | Out-String
    $code = $LASTEXITCODE
    if ($out.Trim()) { Write-Log $out.Trim() }
    if (-not $AllowNonZero -and $code -ne 0) {
        throw "Command failed (exit $code): $Exe $($Arguments -join ' ')"
    }
    return @{ Output = $out; ExitCode = $code }
}

Write-Log "===== lmvk-compile-publish start (Full=$Full) ====="

try {
    # -----------------------------------------------------------------
    # Step 1: pull vault, early-exit on no change (zero cost fast path)
    # -----------------------------------------------------------------
    $headBefore = (& git -C $VaultPath rev-parse HEAD).Trim()
    $pullOut = & git -C $VaultPath pull 2>&1 | Out-String
    Write-Log "git pull ($VaultPath): $($pullOut.Trim())"
    $headAfter = (& git -C $VaultPath rev-parse HEAD).Trim()

    if (($headBefore -eq $headAfter) -and (-not $Full)) {
        Write-Log "HEAD unchanged ($headAfter) and not -Full -> early exit, zero LLM/render cost."
        Write-Log "===== lmvk-compile-publish end (early-exit) ====="
        exit 0
    }
    Write-Log "Proceeding: HEAD $headBefore -> $headAfter (Full=$Full)"

    # -----------------------------------------------------------------
    # Step 2: LLM incremental compile, gated by the $/day cost guard
    # -----------------------------------------------------------------
    $guardResult = Invoke-Checked -Exe "python" -Arguments @(
        (Join-Path $CompilerDir "cost_guard.py"), "check",
        "--state", $SpendState, "--cap", $DailyCapUsd
    ) -AllowNonZero

    if ($guardResult.ExitCode -eq 2) {
        Write-Log "Cost guard: daily cap `$$DailyCapUsd reached -> skipping LLM compile step (render-only this run)." "WARN"
    } else {
        $schedResult = Invoke-Checked -Exe "python" -Arguments @(
            (Join-Path $CompilerDir "scheduler.py"),
            "--vault", $VaultPath, "--mode", "auto", "--once"
        ) -AllowNonZero

        $sourcesCompiled = 0
        try {
            $report = $schedResult.Output | ConvertFrom-Json
            foreach ($result in $report.results) {
                if ($result.action -eq "compile" -and $result.data.sources_compiled) {
                    $sourcesCompiled += [int]$result.data.sources_compiled
                }
            }
        } catch {
            Write-Log "Could not parse scheduler.py JSON output (non-fatal): $_" "WARN"
        }

        if ($sourcesCompiled -gt 0) {
            $estCost = [math]::Round($sourcesCompiled * $CostPerSourceEstimateUsd, 4)
            Invoke-Checked -Exe "python" -Arguments @(
                (Join-Path $CompilerDir "cost_guard.py"), "record",
                "--state", $SpendState, "--cost", $estCost
            ) | Out-Null
            Write-Log "[ESTIMATE] $sourcesCompiled source(s) compiled -> est. `$$estCost recorded (compile.py reports no actual `$ cost; coefficient=`$$CostPerSourceEstimateUsd/source, NOT a measurement)." "WARN"
        } else {
            Write-Log "0 sources compiled this run (D:\knowledge currently has no compile.py 'topics' -- raw/+wiki/ dirs -- so this step is presently a no-op; it activates automatically once one exists)."
        }
    }

    # -----------------------------------------------------------------
    # Step 3: html_export whole-vault direct render (zero LLM, always runs)
    # -----------------------------------------------------------------
    Push-Location $CompilerDir
    try {
        Invoke-Checked -Exe "python" -Arguments @(
            "-m", "html_export.exporter", $VaultPath,
            "--direct", "--output", $OutputDir, "--exclude", "00-Inbox"
        ) | Out-Null
    } finally {
        Pop-Location
    }
    Write-Log "html_export --direct complete -> $OutputDir"

    # -----------------------------------------------------------------
    # Step 4: publish output/ to the `pages` branch (orphan-bootstrap once,
    # plain commit+push thereafter -- no force push needed since this
    # script is the branch's sole writer).
    # -----------------------------------------------------------------
    if (-not (Test-Path (Join-Path $PagesWorkDir ".git"))) {
        Write-Log "No local pages workdir -- checking whether 'pages' branch already exists on gitea."
        $remoteHeads = & git ls-remote --heads $PagesRepoUrl $PagesBranch 2>&1 | Out-String
        Remove-Item -Recurse -Force $PagesWorkDir -ErrorAction SilentlyContinue

        if ($remoteHeads.Trim()) {
            Write-Log "Remote 'pages' branch exists -> cloning it."
            Invoke-Checked -Exe "git" -Arguments @("clone", "-b", $PagesBranch, $PagesRepoUrl, $PagesWorkDir) | Out-Null
        } else {
            Write-Log "Remote 'pages' branch absent -> bootstrapping as an orphan branch."
            Invoke-Checked -Exe "git" -Arguments @("clone", $PagesRepoUrl, $PagesWorkDir) | Out-Null
            Push-Location $PagesWorkDir
            try {
                Invoke-Checked -Exe "git" -Arguments @("checkout", "--orphan", $PagesBranch) | Out-Null
                & git rm -rf . 2>&1 | Out-Null
            } finally {
                Pop-Location
            }
        }
    } else {
        Push-Location $PagesWorkDir
        try {
            Invoke-Checked -Exe "git" -Arguments @("fetch", "origin", $PagesBranch) -AllowNonZero | Out-Null
            Invoke-Checked -Exe "git" -Arguments @("checkout", $PagesBranch) -AllowNonZero | Out-Null
            & git reset --hard "origin/$PagesBranch" 2>&1 | Out-Null
        } finally {
            Pop-Location
        }
    }

    Push-Location $PagesWorkDir
    try {
        # Clear everything except .git, then repopulate from the fresh render.
        Get-ChildItem -Force | Where-Object { $_.Name -ne ".git" } | Remove-Item -Recurse -Force
        Copy-Item -Path (Join-Path $OutputDir "*") -Destination $PagesWorkDir -Recurse -Force

        & git add -A
        $diffStat = & git status --porcelain
        if (-not $diffStat) {
            Write-Log "Pages branch: no content changes since last publish (footer timestamp identical down to the second) -- skipping empty commit."
        } else {
            $commitMsg = "lmvk: publish $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') (vault HEAD $headAfter)"
            & git commit -m $commitMsg --quiet
            Invoke-Checked -Exe "git" -Arguments @("push", "origin", $PagesBranch) | Out-Null
            Write-Log "Published to gitea pages branch: $commitMsg"
        }
    } finally {
        Pop-Location
    }

    Write-Log "===== lmvk-compile-publish end (ok) ====="
} catch {
    Write-Log "FAILED: $_" "ERROR"
    Write-Log "===== lmvk-compile-publish end (error) ====="
    exit 1
}
