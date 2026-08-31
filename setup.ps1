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
$Cli = Join-Path $PSScriptRoot "mcp-server\setup-cli.js"
if (-not (Test-Path $Cli)) {
  Write-Error "TypeScript setup bundle not found at $Cli. Build it with: cd mcp-server; npm run rebuild"
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
