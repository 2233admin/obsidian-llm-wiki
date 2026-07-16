# register-lmvk-memory-sync.ps1 -- LMVK L6: register the hourly memory sync task.
#
# Registers scripts/lmvk-memory-sync.ps1 as a schtasks task named
# lmvk-memory-sync with an hourly trigger, running under powershell.exe
# (full System32 path -- NEVER pwsh: a previous L2 task died silently for
# months because schtasks targeted pwsh, which was not installed; see 37b5e6e).
#
# Safety defaults:
#   - dry run by default: prints the exact schtasks command(s), registers
#     nothing. Pass -Apply to actually register.
#   - -Disabled registers the task then immediately disables it (the 5080
#     pattern from L2: task created but default-disabled on the secondary
#     machine). schtasks /Create cannot create a disabled task directly, so
#     this is a /Create followed by /Change /DISABLE.
#
# Windows PowerShell 5.1 compatible. Runs as the current user (no /RU), so no
# elevation is required.
#
# Exit codes: 0 = success (or dry run), 1 = failure.

param(
    [Parameter(Mandatory = $true)]
    [string]$VaultPath,

    # Register the task in the disabled state (create, then /Change /DISABLE).
    [switch]$Disabled,

    # Actually run schtasks. Without this the script is a dry run.
    [switch]$Apply,

    # Force a dry run even if -Apply was passed.
    [switch]$DryRun,

    [string]$TaskName = 'lmvk-memory-sync'
)

$ErrorActionPreference = 'Stop'

$syncScript = Join-Path $PSScriptRoot 'lmvk-memory-sync.ps1'
if (-not (Test-Path -LiteralPath $syncScript)) {
    Write-Error -ErrorAction Continue "sync script missing: $syncScript"
    exit 1
}
$syncScript = (Resolve-Path -LiteralPath $syncScript).Path

# Trailing backslash before a closing quote would mangle schtasks quoting.
$VaultPath = $VaultPath.TrimEnd('\', '/')
if (Test-Path -LiteralPath $VaultPath) {
    $VaultPath = (Resolve-Path -LiteralPath $VaultPath).Path.TrimEnd('\', '/')
} else {
    Write-Warning "vault path does not exist yet: $VaultPath (task will exit red until it does)"
}

# Full path so the task never depends on PATH resolution.
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# /TR value; inner quotes are \" so schtasks stores them in the task action.
$tr = '{0} -NoProfile -ExecutionPolicy Bypass -File \"{1}\" -VaultPath \"{2}\"' -f `
    $psExe, $syncScript, $VaultPath

if ($tr.Length -gt 261) {
    Write-Warning "/TR value is $($tr.Length) chars; schtasks caps /TR at 261. Shorten the paths."
}

$createCmd  = 'schtasks.exe /Create /F /TN {0} /SC HOURLY /TR "{1}"' -f $TaskName, $tr
$disableCmd = 'schtasks.exe /Change /TN {0} /DISABLE' -f $TaskName

Write-Output "task    : $TaskName (hourly, current user)"
Write-Output "action  : $tr"
Write-Output "command : $createCmd"
if ($Disabled) {
    Write-Output "then    : $disableCmd"
}

$isDryRun = $DryRun -or (-not $Apply)
if ($isDryRun) {
    Write-Output '[dry-run] nothing registered. Re-run with -Apply to execute the command(s) above.'
    exit 0
}

& schtasks.exe /Create /F /TN $TaskName /SC HOURLY /TR $tr
if ($LASTEXITCODE -ne 0) {
    Write-Error -ErrorAction Continue "schtasks /Create failed with exit code $LASTEXITCODE"
    exit 1
}

if ($Disabled) {
    & schtasks.exe /Change /TN $TaskName /DISABLE
    if ($LASTEXITCODE -ne 0) {
        Write-Error -ErrorAction Continue "schtasks /Change /DISABLE failed with exit code $LASTEXITCODE"
        exit 1
    }
    Write-Output "registered DISABLED. Enable later with: schtasks /Change /TN $TaskName /ENABLE"
} else {
    Write-Output "registered. Verify with: schtasks /Query /TN $TaskName /V /FO LIST"
}
exit 0
