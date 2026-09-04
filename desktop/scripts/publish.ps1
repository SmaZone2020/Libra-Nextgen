# Publish the desktop shell as a zero-dependency single executable.
# Production artifact: one exe (self-contained, WebView2 runtime still required on Win10 targets).
param(
    [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\LibraDesktop\LibraDesktop.csproj"
$out = Join-Path $PSScriptRoot "..\dist\shell-$Runtime"

dotnet publish $project -c Release -r $Runtime --self-contained `
    -p:PublishSingleFile=true -p:DebugType=None -p:DebugSymbols=false `
    -p:EnableCompressionInSingleFile=true `
    -o $out

if ($LASTEXITCODE -ne 0) { throw "publish failed" }
Write-Host ""
Write-Host "Shell published to: $out"
Write-Host "Note: a single-file self-contained exe needs no .NET runtime on the target."
