# Libra-Nextgen Deployment Script (Windows PowerShell)
# Builds Agent, Service, and Webapp into dist/

param(
    [string]$OutDir = "dist",
    [switch]$SkipWebapp,
    [switch]$SkipService,
    [switch]$SkipAgent,
    [ValidateSet("linux-x64", "win-x64", "win-x86")]
    [string]$AgentTarget = "win-x64"
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SrcDir = Join-Path $ScriptDir "src"
$DistDir = Join-Path $ScriptDir $OutDir

Write-Host "=== Libra-Nextgen Deployment ===" -ForegroundColor Cyan
Write-Host "Output: $DistDir"
Write-Host "Agent Target: $AgentTarget"
Write-Host ""

# Clean output
if (Test-Path $DistDir) {
    Write-Host "[Clean] Removing previous dist/" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $DistDir
}
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# ── Pre-flight checks ────────────────────────────────────────────────────────

Write-Host "[Check] Verifying prerequisites..." -ForegroundColor Cyan

$dotnetVersion = dotnet --version 2>$null
if (-not $dotnetVersion) {
    Write-Error ".NET SDK not found. Install from https://dotnet.microsoft.com"
    exit 1
}
Write-Host "  dotnet: v$dotnetVersion"

$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Error "Node.js not found. Install from https://nodejs.org"
    exit 1
}
Write-Host "  node: $nodeVersion"

# ── Webapp ───────────────────────────────────────────────────────────────────

if (-not $SkipWebapp) {
    Write-Host ""
    Write-Host "=== Building Webapp ===" -ForegroundColor Cyan

    Push-Location (Join-Path $SrcDir "webapp")

    if (-not (Test-Path "node_modules")) {
        Write-Host "[Webapp] Installing dependencies..."
        npm ci
    }

    Write-Host "[Webapp] Building..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Webapp build failed"
        Pop-Location
        exit 1
    }

    $webappOut = Join-Path $DistDir "webapp"
    Copy-Item -Recurse "dist" $webappOut
    Write-Host "[Webapp] Done -> $webappOut" -ForegroundColor Green

    Pop-Location
}

# ── Service ──────────────────────────────────────────────────────────────────

if (-not $SkipService) {
    Write-Host ""
    Write-Host "=== Building Service ===" -ForegroundColor Cyan

    Push-Location $SrcDir

    $serviceProj = "service\service.csproj"
    $serviceOut = Join-Path $DistDir "service"

    Write-Host "[Service] Publishing (Release)..."
    dotnet publish $serviceProj -c Release -o $serviceOut --no-self-contained
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Service build failed"
        Pop-Location
        exit 1
    }

    Write-Host "[Service] Done -> $serviceOut" -ForegroundColor Green
    Pop-Location
}

# ── Agent ────────────────────────────────────────────────────────────────────

if (-not $SkipAgent) {
    Write-Host ""
    Write-Host "=== Building Agent (NativeAOT) ===" -ForegroundColor Cyan

    Push-Location $SrcDir

    $agentProj = "agent\agent.csproj"
    $agentOut = Join-Path $DistDir "agent"

    Write-Host "[Agent] Publishing Release/$AgentTarget (NativeAOT)..."
    dotnet publish $agentProj -c Release -r $AgentTarget -o $agentOut --self-contained
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Agent build failed"
        Pop-Location
        exit 1
    }

    Write-Host "[Agent] Done -> $agentOut" -ForegroundColor Green
    Pop-Location
}

# ── Summary ──────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=== Deployment Complete ===" -ForegroundColor Green
Write-Host ""

$totalSize = 0
Get-ChildItem -Recurse -File $DistDir | ForEach-Object { $totalSize += $_.Length }

function Format-Size($bytes) {
    if ($bytes -gt 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    if ($bytes -gt 1KB) { return "{0:N1} KB" -f ($bytes / 1KB) }
    return "$bytes B"
}

Write-Host "Output: $DistDir ($(Format-Size $totalSize))"
Write-Host ""
Write-Host "  webapp/   Static frontend files"
Write-Host "  service/  ASP.NET Core backend (dotnet service.dll)"
Write-Host "  agent/     NativeAOT agent binary"
Write-Host ""
Write-Host "Run the service:" -ForegroundColor Yellow
Write-Host "  cd $DistDir\service && dotnet service.dll"
Write-Host ""
Write-Host "Serve the webapp (dev):" -ForegroundColor Yellow
Write-Host "  cd $SrcDir\webapp && npm run preview"
