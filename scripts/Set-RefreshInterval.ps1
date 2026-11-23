# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
# Change refresh intervals for a globally installed Usage Dashboard.
# Requires a restart of OpenCode Desktop and browser extension reload.
[CmdletBinding()]
param(
    [ValidateRange(1,120)][int]$LimitsMinutes = 5,
    [ValidateRange(1,120)][int]$BillingMinutes = 15
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
$pairing = Join-Path $plugin 'browser-extension\pairing.json'
$format = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($settings, (@{ refreshMinutes = $LimitsMinutes } | ConvertTo-Json -Compress), $format)
if (Test-Path -LiteralPath $pairing) {
    $data = Get-Content -LiteralPath $pairing -Raw | ConvertFrom-Json
    $data.refreshMinutes = $BillingMinutes
    # Keep the existing pairing token and port unchanged.
    [IO.File]::WriteAllText($pairing, ($data | ConvertTo-Json -Compress), $format)
}
Write-Host "OpenCode limits: every $LimitsMinutes minute(s); OpenAI Billing: every $BillingMinutes minute(s)." -ForegroundColor Green
Write-Host 'Restart OpenCode Desktop. Reload the unpacked browser extension if you use it.'
