# lmvk-incremental-compile.ps1 -- LMVK L2 compile leg.
#
# Flow: pull vault -> early exit if HEAD unchanged (zero LLM spend) -> $/day
# cost guardrail (compiler/cost_guard.py) -> incremental haiku compile per
# topic (compiler/compile.py, git-diff dirty detection) -> html export ->
# push generated pages to the VAULT's own `pages` branch (not this repo's).
#
# Deliberately bypasses compiler/scheduler.py's AgentScheduler day/night
# machinery (that's vault-mind Phase5's own agent scheduling, unrelated to
# per-source/per-topic compile cadence) -- schtasks pulls this script
# directly, which shells out straight to compile.py. Topic discovery below
# re-implements compiler/evaluate.py::_iter_topics()'s rule inline rather
# than importing evaluate.py, for the same reason.
#
# Dual compile mode: if the vault has topic dirs (*/raw or */wiki -- the
# compiler's LLM-extraction convention), each topic is compiled incrementally
# via compile.py (haiku tier, real $ spend, subject to the cost guardrail
# below). If NO topic dirs are found -- true for the real production vault
# (VAULT_MIND_VAULT_PATH normally points at an organic PARA-method Obsidian
# vault with no raw/wiki anywhere; see compiler/html_export/exporter.py's
# export_vault_direct docstring, which names that exact vault) -- the whole
# vault is instead rendered straight to HTML via `python -m
# html_export.exporter --direct` (zero LLM calls, pure Pandoc rendering, so
# it never touches the cost guardrail or the $/day cap). Without this
# fallback the script would silently find zero topics against the real vault
# and no-op forever while cron still reports success -- see the L2 issue
# report for this finding.
#
# See docs/adr/lmvk-0001-distribution-topology.md ("编译腿") and
# docs/specs/lmvk-execution-and-release.md ("L2 编译腿上机") for the design.
#
# ---------------------------------------------------------------------------
# Registration (NOT executed by this script -- run manually after review):
#
# 5090 (primary), 15-min incremental:
#   schtasks /Create /TN lmvk-incremental-compile /SC MINUTE /MO 15 ^
#     /TR "pwsh -NoProfile -File D:\projects\vault-mind\scripts\lmvk-incremental-compile.ps1" ^
#     /ST 00:00
#
# 5090 (primary), weekly full pass (Sunday 04:00, ahead of weekly-review.ps1's 03:00 slot):
#   schtasks /Create /TN lmvk-weekly-full-compile /SC WEEKLY /D SUN /ST 04:00 ^
#     /TR "pwsh -NoProfile -File D:\projects\vault-mind\scripts\lmvk-incremental-compile.ps1 -Full"
#
# 5080 (backup/standby leg -- SAME script+schedule as 5090's incremental task,
# registered DISABLED by default so it never double-runs against the same
# vault; see ADR: "5090 主、5080 备（备侧任务默认禁用，不双跑）"):
#   schtasks /Create /TN lmvk-incremental-compile /SC MINUTE /MO 15 ^
#     /TR "pwsh -NoProfile -File D:\projects\vault-mind\scripts\lmvk-incremental-compile.ps1" ^
#     /ST 00:00 /DISABLE
#   # If 5090 ever goes down, promote 5080 to active with:
#   #   schtasks /Change /TN lmvk-incremental-compile /ENABLE
# ---------------------------------------------------------------------------

param(
    [string]$VaultPath = $env:VAULT_MIND_VAULT_PATH,
    [double]$Cap = 5.0,
    [string]$Tier = "haiku",
    [string]$Theme = "reading",
    [switch]$Full,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$Root      = Split-Path -Parent $PSScriptRoot
$Compiler  = Join-Path $Root 'compiler'
$CompilePy = Join-Path $Compiler 'compile.py'
$CostGuard = Join-Path $Compiler 'cost_guard.py'
$CostState = Join-Path $Root '.vault-mind-cost-guard.json'
$stamp     = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# Rough, deliberately conservative per-topic-run debit recorded against the
# $/day cap after a real (non-dry-run) compile.py LLM call. compile.py /
# extractor.py do not currently do per-call token/cost accounting, so this is
# a flat placeholder, not a measured cost -- see the L2 issue report for the
# follow-up needed to replace it with real accounting. The whole-vault direct
# export fallback below makes zero LLM calls and never debits this at all.
$EstimatedCostPerRun = 0.02

function Write-Log($msg) {
    Write-Output "[$stamp] $msg"
}

if (-not $VaultPath) {
    Write-Error "VaultPath not set. Pass -VaultPath or set VAULT_MIND_VAULT_PATH."
    exit 1
}
if (-not (Test-Path $VaultPath)) {
    Write-Error "VaultPath does not exist: $VaultPath"
    exit 1
}

# ---------------------------------------------------------------------------
# 1. pull vault, early exit if HEAD unchanged (spec: "HEAD 无变更即早退，零 LLM 消耗")
#    Skipped for -Full: a weekly full pass runs regardless of whether the
#    vault moved, it's a drift-correction sweep.
# ---------------------------------------------------------------------------
$beforeHead = (git -C $VaultPath rev-parse HEAD 2>$null)
git -C $VaultPath pull --ff-only
if ($LASTEXITCODE -ne 0) {
    Write-Error "git pull --ff-only failed for $VaultPath (exit $LASTEXITCODE)"
    exit 1
}
$afterHead = (git -C $VaultPath rev-parse HEAD 2>$null)

if (-not $Full -and $beforeHead -and ($beforeHead -eq $afterHead)) {
    Write-Log "HEAD unchanged ($afterHead) -- early exit, nothing pulled, zero LLM spend."
    exit 0
}
Write-Log "vault HEAD: $beforeHead -> $afterHead"

# ---------------------------------------------------------------------------
# 2. topic discovery -- re-implements compiler/evaluate.py::_iter_topics()'s
#    rule directly (non-hidden immediate subdir of vault root containing a
#    raw/ or wiki/ subdir), instead of importing evaluate.py. The $/day cost
#    guardrail is checked further below, INSIDE the topic branch only -- it
#    guards compile.py's real LLM spend and must never block the whole-vault
#    direct-export fallback, which is zero-cost by construction and (against
#    the real production vault) is the freshness path the spec's "footer
#    timestamp <=30min" SLA actually depends on.
# ---------------------------------------------------------------------------
$topics = Get-ChildItem -LiteralPath $VaultPath -Directory |
    Where-Object { -not $_.Name.StartsWith('.') } |
    Where-Object {
        (Test-Path (Join-Path $_.FullName 'raw')) -or (Test-Path (Join-Path $_.FullName 'wiki'))
    }

# Stage HTML output in a scratch temp dir, never inside the vault's own git
# working tree (avoids polluting/dirtying the vault repo) and never inside
# this repo's tree either. One combined pages-branch push happens at the end
# so multiple topics don't force-clobber each other's pages branch content.
$PagesStage = Join-Path ([System.IO.Path]::GetTempPath()) "lmvk-pages-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $PagesStage | Out-Null

$anyLLMCompiled = $false
$pushReady = $false

try {
    if ($topics) {
        # -------------------------------------------------------------------
        # 3a. topic-structured vault: incremental (or -Full) haiku compile
        #     per topic via compile.py, one html output dir per topic.
        # -------------------------------------------------------------------
        $passLabel = if ($Full) { "FULL" } else { "incremental" }
        Write-Log "found $($topics.Count) topic(s): $($topics.Name -join ', ') -- tier=$Tier pass=$passLabel"

        # $/day cost guardrail -- gates ONLY this LLM branch (compile.py's real
        # spend). Checked here, not before topic discovery, so a tripped cap
        # never blocks the zero-cost organic-vault fallback in 3b.
        python $CostGuard check --state $CostState --cap $Cap | Write-Output
        $guardExit = $LASTEXITCODE
        $compiledTopics = @()
        if ($guardExit -eq 2) {
            Write-Log "cost guardrail: at/over `$$Cap/day cap -- skipping topic compile this run."
        } elseif ($guardExit -ne 0) {
            Write-Error "cost_guard.py check failed unexpectedly (exit $guardExit)"
            exit 1
        } else {
        foreach ($topic in $topics) {
            Write-Log "compiling topic: $($topic.Name)"
            $htmlOut = Join-Path $PagesStage $topic.Name

            $compileArgs = @(
                $CompilePy,
                $topic.FullName,
                '--tier', $Tier,
                '--export-html',
                '--theme', $Theme,
                '--html-output-dir', $htmlOut
            )
            if ($Full) { $compileArgs += '--full' }
            if ($DryRun) { $compileArgs += '--dry-run' }

            python @compileArgs
            if ($LASTEXITCODE -ne 0) {
                Write-Error "compile.py failed for topic $($topic.Name) (exit $LASTEXITCODE)"
                exit 1
            }
            $anyLLMCompiled = $true
            if (Test-Path $htmlOut) {
                $compiledTopics += $topic.Name
            }
        }

        if ($compiledTopics.Count -eq 0) {
            Write-Log "no html output produced for any topic -- nothing to publish this run."
        } else {
            # Root landing page linking each topic's own index.html.
            $links = ($compiledTopics | ForEach-Object { "<li><a href=`"$_/index.html`">$_</a></li>" }) -join "`n"
            $indexHtml = @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>LMVK wiki</title></head>
<body>
<h1>LMVK compiled wiki</h1>
<p>Compiled: $stamp</p>
<ul>
$links
</ul>
</body></html>
"@
            Set-Content -LiteralPath (Join-Path $PagesStage 'index.html') -Value $indexHtml -Encoding UTF8
            $pushReady = $true
        }
        }
    } else {
        # -------------------------------------------------------------------
        # 3b. organic (non-topic) vault -- e.g. the real production vault,
        #     a PARA-method Obsidian vault with no raw/wiki dirs anywhere.
        #     Zero LLM calls: whole vault rendered straight to HTML via
        #     html_export.exporter.export_vault_direct (00-Inbox excluded by
        #     default -- wayfinder #20 review-gate boundary). Never debits
        #     the cost guardrail.
        # -------------------------------------------------------------------
        Write-Log "no topic dirs (*/raw or */wiki) found under $VaultPath -- whole-vault direct export (organic vault, zero LLM cost)."

        $directArgs = @('-m', 'html_export.exporter', $VaultPath, '--direct', '--output', $PagesStage, '--theme', $Theme)
        $prevPythonPath = $env:PYTHONPATH
        $env:PYTHONPATH = $Compiler
        try {
            python @directArgs
            $directExit = $LASTEXITCODE
        } finally {
            $env:PYTHONPATH = $prevPythonPath
        }
        if ($directExit -ne 0) {
            Write-Error "html_export.exporter --direct failed for $VaultPath (exit $directExit)"
            exit 1
        }
        $pushReady = Test-Path (Join-Path $PagesStage 'index.html')
        if (-not $pushReady) {
            Write-Log "direct export produced no index.html -- nothing to publish this run."
        }
    }

    # -------------------------------------------------------------------
    # 4. push staged pages to the VAULT's own `pages` branch (its own
    #    remote, entirely separate from this vault-mind repo and from
    #    .gitea/workflows/publish-wiki.yml, which only ever publishes the
    #    in-repo demo vault under examples/collab-vault/).
    # -------------------------------------------------------------------
    if ($DryRun) {
        Write-Log "dry run -- skipping pages push."
    } elseif (-not $pushReady) {
        Write-Log "nothing to publish -- skipping pages push."
    } else {
        $remoteUrl = (git -C $VaultPath remote get-url origin 2>$null)
        if (-not $remoteUrl) {
            Write-Log "[warn] vault has no 'origin' remote -- skipping pages push."
        } else {
            Push-Location $PagesStage
            try {
                git init -q -b pages
                git config user.name "lmvk-l2-compile"
                git config user.email "lmvk@localhost"
                git add -A
                git commit -q -m "LMVK L2: publish pages ($stamp)"
                git push -f $remoteUrl "HEAD:pages"
                if ($LASTEXITCODE -ne 0) {
                    Write-Error "push to pages branch failed (exit $LASTEXITCODE)"
                    exit 1
                }
                Write-Log "pushed pages branch."
            } finally {
                Pop-Location
            }
        }
    }
} finally {
    Remove-Item -LiteralPath $PagesStage -Recurse -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# 5. record an estimated spend against today's cap (see $EstimatedCostPerRun
#    comment above -- placeholder until compile.py does real cost
#    accounting). Only debited when compile.py actually made an LLM call
#    (topic-structured branch); the whole-vault direct-export fallback is
#    zero-cost by construction and never debits this.
# ---------------------------------------------------------------------------
if ($anyLLMCompiled -and -not $DryRun) {
    python $CostGuard record --state $CostState --cost $EstimatedCostPerRun | Write-Output
}

Write-Log "done."
