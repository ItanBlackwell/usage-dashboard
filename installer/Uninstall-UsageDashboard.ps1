# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
[CmdletBinding()]
param([switch]$PurgeCachedData)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
try {
    $root=Get-OpenCodeRoot
    $plugin=Join-Path $root 'plugins\usage-dashboard'
    if (Confirm-PluginIdentity -Directory $plugin -Expected 'usage-dashboard') {
        $saved=Join-Path $root '.usage-dashboard-userdata'
        New-Item -ItemType Directory -Force -Path (Join-Path $saved 'browser-extension') | Out-Null
        foreach($name in @('settings.json','browser-extension\pairing.json')) {
            $src=Join-Path $plugin $name
            if (Test-Path -LiteralPath $src -PathType Leaf) {
                Copy-Item -LiteralPath $src -Destination (Join-Path $saved $name) -Force
            }
        }
        Remove-Item -LiteralPath $plugin -Recurse -Force
        Write-Host 'Usage Dashboard plugin removed from OpenCode.'
    } else { Write-Host 'Usage Dashboard was not installed in the expected location.' }
    Remove-DuplicatePluginReferences -ConfigRoot $root
    if ($PurgeCachedData) {
        $cacheBase=if($env:LOCALAPPDATA){$env:LOCALAPPDATA}else{Join-Path $HOME '.cache'}
        $cache=Join-Path $cacheBase 'usage-dashboard'
        if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Recurse -Force }
        $saved=Join-Path $root '.usage-dashboard-userdata'
        if (Test-Path -LiteralPath $saved) { Remove-Item -LiteralPath $saved -Recurse -Force }
    }
    if (-not $PurgeCachedData) { Write-Host 'Isolated Billing Session profiles retained for reinstall. Use -PurgeCachedData to remove them after closing the billing browser.' }
    Write-Host 'If you loaded Usage Dashboard Billing in Edge or Chrome, remove it from the browser extensions page manually.'
    Write-Host 'Restart OpenCode Desktop. Accounts and other plugins were not changed.'
} catch {
    Write-Error "Usage Dashboard removal failed: $($_.Exception.Message)"
    exit 1
}
