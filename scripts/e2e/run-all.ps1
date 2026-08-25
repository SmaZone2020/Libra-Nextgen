# E2E 回归：起服务端 + agent，跑协议/模块/列表测试，自动清理。
# 前置：Mongo 运行中、src/service 已构建（dotnet build）、agent 已构建（cargo build -p agent -p loader）。
param(
  [int]$Port = 5270,
  [switch]$KeepRunning
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # scripts/
$repo = Split-Path -Parent $root           # 仓库根
$env:E2E_BASE = "http://127.0.0.1:$Port"
$env:E2E_MODULES_DIR = "$repo\src\build-output\modules\x64"

# 0) JWT 私钥（DPAPI 解出，供测试脚本签发管理 API token）
Write-Host "[e2e] extracting JWT signing key..."
$keyTool = "$PSScriptRoot\tools\jwt-keygen"
if (-not (Test-Path "$keyTool\jwt-keygen.csproj")) {
  New-Item -ItemType Directory -Force -Path $keyTool | Out-Null
  dotnet new console -o $keyTool --force | Out-Null
  dotnet add $keyTool package System.Security.Cryptography.ProtectedData --version 8.* | Out-Null
  @'
using System.Security.Cryptography;
using System.Text;
var bytes = File.ReadAllBytes(Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    "Libra-Nextgen", "jwt-rsa-key.bin"));
var xml = Encoding.UTF8.GetString(ProtectedData.Unprotect(bytes, null, DataProtectionScope.CurrentUser));
using var rsa = RSA.Create();
rsa.FromXmlString(xml);
Console.WriteLine(rsa.ExportPkcs8PrivateKeyPem());
'@ | Set-Content "$keyTool\Program.cs" -Encoding UTF8
}
dotnet run --project "$keyTool\jwt-keygen.csproj" --no-restore 2>$null | Out-File "$PSScriptRoot\.jwt-key.pem" -Encoding utf8
if (-not (Test-Path "$PSScriptRoot\.jwt-key.pem")) { Write-Host "[e2e] FAIL: cannot extract JWT key"; exit 1 }

# 1) 起服务端
Write-Host "[e2e] starting server on :$Port ..."
$server = Start-Process -FilePath "dotnet" -ArgumentList @(
  "run", "--project", "$repo\src\service\service.csproj", "--no-build",
  "--urls", "http://127.0.0.1:$Port") -PassThru -WindowStyle Hidden
try {
  $up = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/beacon/register" -Method POST `
        -Body '{"hostname":"probe"}' -ContentType "application/json" -TimeoutSec 2 -UseBasicParsing | Out-Null
      $up = $true; break
    } catch { }
  }
  if (-not $up) { Write-Host "[e2e] FAIL: server did not start"; exit 1 }
  Write-Host "[e2e] server up."

  # 2) 起 agent（debug 构建，测试协议链路）
  Write-Host "[e2e] starting agent..."
  $agent = Start-Process -FilePath "$repo\src\agent-rs\target\debug\agent.exe" -ArgumentList @(
    "--server", "http://127.0.0.1:$Port") -PassThru -WindowStyle Hidden -RedirectStandardError "$PSScriptRoot\agent-e2e.log"
  Start-Sleep -Seconds 8
  # 捕获真实 agent id（agent 日志注册行），供任务执行验证
  $logText = Get-Content "$PSScriptRoot\agent-e2e.log" -Raw -ErrorAction SilentlyContinue
  if ($logText -match 'agent_id=([0-9a-f]{32})') {
    $env:E2E_AGENT_ID = $Matches[1]
    Write-Host "[e2e] agent registered: $($Matches[1])"
  } else {
    Write-Host "[e2e] WARN: agent id not captured; execution test skipped"
  }

  # 3) 顺序跑测试
  $failed = $false
  foreach ($t in @('01-agent-protocol.mjs', '02-module-management.mjs', '03-traffic-lists.mjs', '04-download-formats.mjs')) {
    Write-Host "`n[e2e] === $t ==="
    node "$PSScriptRoot\$t"
    if ($LASTEXITCODE -ne 0) { $failed = $true }
  }

  # 4) 清理
  if (-not $KeepRunning) {
    Stop-Process -Id $agent.Id -Force -ErrorAction SilentlyContinue
  }
  if ($failed) { Write-Host "`n[e2e] RESULT: FAILED"; exit 1 }
  Write-Host "`n[e2e] RESULT: ALL PASS"
  exit 0
} finally {
  if (-not $KeepRunning) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
