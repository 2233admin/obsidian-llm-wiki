#Requires -Version 7
<#
Regression test for Issue #51 P1-1 -- GITEA_TOKEN leak paths in
scripts/lmvk-compile-publish.ps1.

The pre-fix script embedded the token in $PagesRepoUrl, which leaked it into
process argv, the compile log, and the pages workdir's .git/config. The fixed
script must keep every URL credential-free and hand the token to git only via
a GIT_ASKPASS helper that reads it from the environment at call time.

Run:
    pwsh -NoProfile -File scripts/lmvk-compile-publish.token-leak.test.ps1
Prove it fails on an old revision:
    git show <old-sha>:scripts/lmvk-compile-publish.ps1 > old.ps1
    pwsh -NoProfile -File scripts/lmvk-compile-publish.token-leak.test.ps1 -ScriptPath old.ps1

Exit code 0 = pass, 1 = fail.
#>
param(
    [string]$ScriptPath = (Join-Path $PSScriptRoot "lmvk-compile-publish.ps1")
)

$ErrorActionPreference = "Stop"
$failures = [System.Collections.Generic.List[string]]::new()
$text = Get-Content -Raw -Path $ScriptPath

# --- Static: no credential may be interpolated into any URL literal --------
if ($text -match '\$env:GITEA_TOKEN@') {
    $failures.Add("token is used as URL userinfo (leaks into argv, logs, and .git/config)")
}
if ($text -match 'https://[^"''\r\n]*:\$env:[A-Za-z_]+@') {
    $failures.Add("an env secret is interpolated into a URL literal")
}
foreach ($line in (($text -split "`r?`n") | Where-Object { $_ -match '^\s*\$PagesRepoUrl\s*=' })) {
    if ($line -match 'GITEA_TOKEN') { $failures.Add("`$PagesRepoUrl references GITEA_TOKEN: $($line.Trim())") }
}

# --- Static: the replacement auth path must exist ---------------------------
if ($text -notmatch 'GIT_ASKPASS') {
    $failures.Add("no GIT_ASKPASS auth mechanism present")
}
if ($text -notmatch 'credential\.helper=') {
    $failures.Add("credential helpers are not disabled for network git calls")
}
if ($text -notmatch '"remote",\s*"set-url"') {
    $failures.Add("no self-heal of previously persisted token-bearing remote URL")
}

# --- Behavioral: helper must not embed the token; must read it from env ----
# Old revisions have no -LibraryOnly switch and no Initialize-GitAuth, so
# this block fails there -- that is the regression being pinned.
$testToken = "test-token-5090-regression"
$env:GITEA_TOKEN = $testToken
# Pre-fix scripts lack [CmdletBinding()], so an unknown -LibraryOnly switch is
# silently swallowed and dot-sourcing would EXECUTE the real pipeline. Refuse
# to dot-source unless the seam provably exists.
if ($text -notmatch '\$LibraryOnly') {
    $failures.Add("script has no -LibraryOnly test seam; refusing to dot-source (it would execute the pipeline)")
}
elseif ($failures.Count -eq 0) {
try {
    . $ScriptPath -LibraryOnly
    # isolate: keep the helper file out of the real state dir
    $StateDir = Join-Path ([IO.Path]::GetTempPath()) "lmvk-token-test-$PID"
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    try {
        Initialize-GitAuth
        if (-not $env:GIT_ASKPASS -or -not (Test-Path $env:GIT_ASKPASS)) {
            $failures.Add("Initialize-GitAuth did not produce an askpass helper")
        } else {
            $helperText = Get-Content -Raw $env:GIT_ASKPASS
            if ($helperText -match [regex]::Escape($testToken)) {
                $failures.Add("askpass helper embeds the literal token value")
            }
            if ($IsWindows) {
                $answer = (& cmd /c $env:GIT_ASKPASS "Password for 'https://Curry@git.xart.top:8418':" | Out-String).Trim()
                if ($answer -ne $testToken) {
                    $failures.Add("askpass helper did not return the token from the environment (got '$answer')")
                }
            }
        }
        if ($PagesRepoUrl -match [regex]::Escape($testToken) -or $PagesRepoUrl -match 'GITEA_TOKEN') {
            $failures.Add("`$PagesRepoUrl carries credentials at runtime: $PagesRepoUrl")
        }
        if ($env:GIT_TERMINAL_PROMPT -ne "0") {
            $failures.Add("GIT_TERMINAL_PROMPT not disabled; a missing token would hang the scheduled task")
        }
    } finally {
        Remove-Item -Recurse -Force $StateDir -ErrorAction SilentlyContinue
    }
} catch {
    $failures.Add("library-mode dot-source failed (expected on pre-fix revisions): $($_.Exception.Message)")
}
}

# --- Report -----------------------------------------------------------------
if ($failures.Count -gt 0) {
    Write-Host "FAIL: $($failures.Count) token-leak regression(s):" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host "PASS: no GITEA_TOKEN leak paths in $ScriptPath" -ForegroundColor Green
exit 0
