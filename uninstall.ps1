#requires -Version 5.1
<#
    Remove KitFX from EffectCraft.

    Usage:
      powershell -ExecutionPolicy Bypass -File uninstall.ps1
#>
param(
    [string]$Target = (Join-Path $env:APPDATA 'EffectCraft\Scripts\ScriptUI Panels')
)

$ErrorActionPreference = 'Stop'
$dest = Join-Path $Target 'KitFX.jsx'

if (Test-Path $dest) {
    Remove-Item $dest -Force
    Write-Host "Removed $dest" -ForegroundColor Green
} else {
    Write-Host "KitFX.jsx is not installed in $Target"
}

$installerCopy = Join-Path $env:LOCALAPPDATA 'KitFX-EC'
if (Test-Path $installerCopy) {
    Write-Host "Installer logs and a copy of setup.exe remain in $installerCopy (safe to delete)."
}

Write-Host 'Restart EffectCraft to unload the panel.'
