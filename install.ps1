#requires -Version 5.1
<#
    Install (or replace) KitFX in EffectCraft from a cloned repository.
    No administrator rights required.

    Usage:
      powershell -ExecutionPolicy Bypass -File install.ps1
      powershell -ExecutionPolicy Bypass -File install.ps1 -Target "D:\Scripts\ScriptUI Panels"
#>
param(
    [string]$Target = (Join-Path $env:APPDATA 'EffectCraft\Scripts\ScriptUI Panels'),
    [switch]$NoBackup
)

$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'dist\KitFX.jsx'
if (-not (Test-Path $source)) {
    throw "dist\KitFX.jsx not found. Build it first: powershell -ExecutionPolicy Bypass -File tools\build.ps1 -SkipInstaller"
}

if (Get-Process effectcraft -ErrorAction SilentlyContinue) {
    Write-Host 'EffectCraft is running. Close it and run this again, or restart it after installing.' -ForegroundColor Yellow
}

New-Item -ItemType Directory -Path $Target -Force | Out-Null
$dest = Join-Path $Target 'KitFX.jsx'

if ((Test-Path $dest) -and -not $NoBackup) {
    Copy-Item $dest "$dest.bak" -Force
    Write-Host "Previous panel backed up to $dest.bak"
}

Copy-Item $source $dest -Force

$version = 'unknown'
$match = Select-String -Path $dest -Pattern 'KitFX for EffectCraft ([0-9.]+)' | Select-Object -First 1
if ($match) { $version = $match.Matches[0].Groups[1].Value }

Write-Host ''
Write-Host "KitFX $version installed:" -ForegroundColor Green
Write-Host "  $dest"
Write-Host ''
Write-Host 'Restart EffectCraft, then open Window > KitFX.jsx.'
