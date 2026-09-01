# LLM Wiki setup (PowerShell)
# Usage: .\setup.ps1 [-VaultHost <name>] [-Vault <path>] [-DryRun] [-Doctor] [-List] [-Json]

param(
  [string]$VaultHost = "claude",
  [string]$Vault,
  [switch]$DryRun,
  [switch]$Doctor,
  [switch]$List,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
$McpDir = Join-Path $PSScriptRoot "mcp-server"
$Cli = Join-Path $McpDir "setup-cli.js"
if (-not (Test-Path $Cli)) {
  Write-Warning "Setup bundle not found; bootstrapping MCP dependencies and rebuilding now."
  if (-not (Test-Path (Join-Path $McpDir "node_modules"))) {
    & npm --prefix $McpDir ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  & npm --prefix $McpDir run rebuild
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Path $Cli)) {
  Write-Error "Setup bundle could not be built at $Cli"
  exit 1
}

$Forwarded = @("--host", $VaultHost)
if ($Vault) { $Forwarded += @("--vault", $Vault) }
if ($DryRun) { $Forwarded += "--dry-run" }
if ($Doctor) { $Forwarded += "--doctor" }
if ($List) { $Forwarded += "--list" }
if ($Json) { $Forwarded += "--json" }

& node $Cli @Forwarded
exit $LASTEXITCODE
