# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
[CmdletBinding()]
param([switch]$PurgeCachedData,[switch]$ApplyQueued)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
try {
    if (Test-UsageOpenCodeRunning) {
        if ($ApplyQueued) { throw 'OpenCode is running; retry later.' }
        Queue-UsageOperation -Action uninstall -Purge ([bool]$PurgeCachedData)
        return
    }
    $root=Get-OpenCodeRoot
    if (!$ApplyQueued -and (Test-Path -LiteralPath (Join-Path $root '.usage-dashboard-pending'))) { throw 'An operation is already queued. Run Apply.cmd first.' }
    $plugin=Join-Path $root 'plugins\usage-dashboard'
    $saved=Join-Path $root '.usage-dashboard-userdata'
    Assert-NoReparsePath -Path $plugin
    Assert-NoReparsePath -Path $saved
    if (Confirm-PluginIdentity -Directory $plugin -Expected 'usage-dashboard') {
        Assert-NoReparseTree -Path $plugin
        New-Item -ItemType Directory -Force -Path $saved | Out-Null
        foreach($name in @('settings.json')) {
            $src=Join-Path $plugin $name
            if (Test-Path -LiteralPath $src -PathType Leaf) {
                Assert-NoReparsePath -Path (Join-Path $saved $name)
                Copy-Item -LiteralPath $src -Destination (Join-Path $saved $name) -Force
            }
        }
        Remove-Item -LiteralPath $plugin -Recurse -Force
        Write-Host 'Usage Dashboard plugin removed from OpenCode.'
    } else { Write-Host 'Usage Dashboard was not installed in the expected location.' }
    Remove-LegacyBillingCompanion -Directory $saved
    Remove-DuplicatePluginReferences -ConfigRoot $root
    if ($PurgeCachedData) {
        $cacheBase=if($env:LOCALAPPDATA){$env:LOCALAPPDATA}else{Join-Path $HOME '.cache'}
        $cache=Join-Path $cacheBase 'usage-dashboard'
        Assert-NoReparseTree -Path $cache
        Assert-NoReparseTree -Path $saved
        if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Recurse -Force }
        $saved=Join-Path $root '.usage-dashboard-userdata'
        if (Test-Path -LiteralPath $saved) { Remove-Item -LiteralPath $saved -Recurse -Force }
    }
    if (-not $PurgeCachedData) { Write-Host 'Local settings and cache retained. Use -PurgeCachedData to remove them, including any retired private Billing profiles.' }
    Write-Host 'If previously loaded, remove the retired Usage Dashboard Billing extension from Edge or Chrome manually.'
    Write-Host 'Restart OpenCode Desktop. Accounts and other plugins were not changed.'
} catch {
    Write-Error "Usage Dashboard removal failed: $($_.Exception.Message)"
    exit 1
}
