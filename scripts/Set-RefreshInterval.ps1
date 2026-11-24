# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
# Change the shared refresh interval for provider APIs and Billing Sessions.
# Requires a restart of OpenCode Desktop.
[CmdletBinding()]
param(
    [Alias('LimitsMinutes')][ValidateRange(1,120)][int]$RefreshMinutes = 5
)
$ErrorActionPreference = 'Stop'
$root = if ($env:OPENCODE_CONFIG_DIR -and [IO.Path]::IsPathRooted($env:OPENCODE_CONFIG_DIR)) {
    $env:OPENCODE_CONFIG_DIR
} else { Join-Path $HOME '.config\opencode' }
$plugin = Join-Path $root 'plugins\usage-dashboard'
if (-not (Test-Path -LiteralPath (Join-Path $plugin 'package.json'))) {
    throw "Usage Dashboard is not installed at $plugin"
}
$settings = Join-Path $plugin 'settings.json'
$format = New-Object System.Text.UTF8Encoding($false)
$data = [pscustomobject]@{}
if (Test-Path -LiteralPath $settings -PathType Leaf) {
    $data = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
    if ($null -eq $data -or $data -isnot [pscustomobject]) { throw 'Invalid Usage Dashboard settings' }
}
$data | Add-Member -NotePropertyName refreshMinutes -NotePropertyValue $RefreshMinutes -Force
[IO.File]::WriteAllText($settings, ($data | ConvertTo-Json -Depth 20 -Compress), $format)
Write-Host "Provider APIs and Billing Sessions: every $RefreshMinutes minute(s)." -ForegroundColor Green
Write-Host 'Restart OpenCode Desktop.'
