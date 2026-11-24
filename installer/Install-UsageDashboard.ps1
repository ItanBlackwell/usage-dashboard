# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
[CmdletBinding()]
param([string]$PackageRoot,[switch]$SkipBillingRuntime)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
try {
    if ([string]::IsNullOrWhiteSpace($PackageRoot)) { $PackageRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path }
    $PackageRoot=[System.IO.Path]::GetFullPath($PackageRoot)
    $manifest=Join-Path $PackageRoot 'package.json'
    $bundle=Join-Path $PackageRoot 'dist\gui-experimental.cjs'
    if (-not (Test-Path -LiteralPath $bundle -PathType Leaf) -or -not (Test-Path -LiteralPath $manifest -PathType Leaf)) {
        throw 'Distribution is incomplete: package.json or dist/gui-experimental.cjs is missing.'
    }
    $package=Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
    if ($package.name -ne 'usage-dashboard') { throw 'Wrong plugin package: expected usage-dashboard.' }
    $root=Get-OpenCodeRoot
    $plugins=Join-Path $root 'plugins'
    $target=Join-Path $plugins 'usage-dashboard'
    $old=Join-Path $plugins 'pv-usage-dashboard'
    New-Item -ItemType Directory -Force -Path (Join-Path $target 'dist') | Out-Null
    $copySafe = {
        param([string]$source,[string]$destination)
        if ((Test-Path -LiteralPath $source -PathType Leaf) -and -not (Test-Path -LiteralPath $destination)) {
            Copy-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
        }
    }
    # Keep local configuration when upgrading the old plugin.
    if (Confirm-PluginIdentity -Directory $old -Expected 'pv-usage-dashboard') {
        & $copySafe (Join-Path $old 'settings.json') (Join-Path $target 'settings.json')
        Remove-LegacyBillingCompanion -Directory $old
    }
    # Restore settings from a prior clean uninstall when no current settings exist.
    $saved=Join-Path $root '.usage-dashboard-userdata'
    & $copySafe (Join-Path $saved 'settings.json') (Join-Path $target 'settings.json')
    Copy-Item -LiteralPath $manifest -Destination (Join-Path $target 'package.json') -Force
    Copy-Item -LiteralPath $bundle -Destination (Join-Path $target 'dist\gui-experimental.cjs') -Force
    $windowHelper=Join-Path $PackageRoot 'installer\BillingWindow.ps1'
    if (-not (Test-Path -LiteralPath $windowHelper -PathType Leaf)) { throw 'Missing Billing window helper.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $target 'installer') | Out-Null
    Copy-Item -LiteralPath $windowHelper -Destination (Join-Path $target 'installer\BillingWindow.ps1') -Force
    Remove-LegacyBillingCompanion -Directory $target
    Remove-LegacyBillingCompanion -Directory $saved
    if (-not $SkipBillingRuntime) {
        try {
            # npm lockfile v3 includes an empty root key, which Windows
            # PowerShell 5.1 cannot deserialize. Use the validated flat pin.
            $pin = Get-Content -LiteralPath (Join-Path $PackageRoot 'billing-runtime.json') -Raw | ConvertFrom-Json
            if ($pin.name -cne 'playwright-core' -or $pin.version -cne $package.optionalDependencies.'playwright-core') { throw 'Billing runtime pin does not match the package' }
            if ($pin.version -notmatch '^\d+\.\d+\.\d+$' -or
                $pin.resolved -cne "https://registry.npmjs.org/playwright-core/-/playwright-core-$($pin.version).tgz" -or
                $pin.integrity -notmatch '^sha512-[A-Za-z0-9+/]+={0,2}$') { throw 'Invalid Billing runtime lock' }
            $modules = Join-Path $target 'node_modules'
            $runtime = Join-Path $modules 'playwright-core'
            $receipt = Join-Path $runtime '.usage-dashboard-integrity'
            $runtimeManifest = Join-Path $runtime 'package.json'
            $installed = $false
            if ((Test-Path -LiteralPath $receipt -PathType Leaf) -and (Test-Path -LiteralPath $runtimeManifest -PathType Leaf)) {
                try {
                    $installed = ((Get-Content -LiteralPath $receipt -Raw).Trim() -ceq $pin.integrity) -and
                        ((Get-Content -LiteralPath $runtimeManifest -Raw | ConvertFrom-Json).version -ceq $pin.version) -and
                        (Test-Path -LiteralPath (Join-Path $runtime 'index.js') -PathType Leaf)
                } catch {}
            }
            if (-not $installed) {
                $stage = Join-Path $target ('.billing-runtime-' + [Guid]::NewGuid().ToString('N'))
                New-Item -ItemType Directory -Path $stage -Force | Out-Null
                try {
                    $archive = Join-Path $stage 'playwright-core.tgz'
                    $packaged = Join-Path $PackageRoot 'vendor\playwright-core.tgz'
                    if (Test-Path -LiteralPath $packaged -PathType Leaf) {
                        Copy-Item -LiteralPath $packaged -Destination $archive
                    } else {
                        Write-Host 'Downloading the locked Billing runtime from npm...'
                        Invoke-WebRequest -UseBasicParsing -Uri $pin.resolved -OutFile $archive -TimeoutSec 90 -ErrorAction Stop
                    }
                    $sha = [Security.Cryptography.SHA512]::Create()
                    $stream = [IO.File]::OpenRead($archive)
                    try { $actual = 'sha512-' + [Convert]::ToBase64String($sha.ComputeHash($stream)) }
                    finally { $stream.Dispose(); $sha.Dispose() }
                    if ($actual -cne $pin.integrity) { throw 'Billing runtime integrity check failed' }
                    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
                    if (-not (Test-Path -LiteralPath $tar -PathType Leaf)) { throw 'Windows tar.exe is required for Billing runtime setup' }
                    & $tar -xzf $archive -C $stage
                    if ($LASTEXITCODE -ne 0) { throw 'Billing runtime extraction failed' }
                    $extracted = Join-Path $stage 'package'
                    $meta = Get-Content -LiteralPath (Join-Path $extracted 'package.json') -Raw | ConvertFrom-Json
                    if ($meta.name -cne 'playwright-core' -or $meta.version -cne $pin.version) { throw 'Unexpected Billing runtime package' }
                    [IO.File]::WriteAllText((Join-Path $extracted '.usage-dashboard-integrity'),$pin.integrity)
                    New-Item -ItemType Directory -Path $modules -Force | Out-Null
                    $backup = Join-Path $stage 'previous'
                    if (Test-Path -LiteralPath $runtime) { Move-Item -LiteralPath $runtime -Destination $backup }
                    try { Move-Item -LiteralPath $extracted -Destination $runtime }
                    catch {
                        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $runtime }
                        throw
                    }
                } finally { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
            }
            Write-Host "Billing runtime $($pin.version) installed and ready for browser launch." -ForegroundColor Green
        } catch {
            Write-Warning "Billing runtime unavailable: $($_.Exception.Message). Direct API monitoring remains installed. Re-run Install.cmd to retry."
        }
    }
    $settings=Join-Path $target 'settings.json'
    if (-not (Test-Path -LiteralPath $settings)) {
        [IO.File]::WriteAllText($settings,'{"refreshMinutes":5}', [Text.UTF8Encoding]::new($false))
    }
    $cacheBase = if($env:LOCALAPPDATA){$env:LOCALAPPDATA}else{Join-Path $HOME '.cache'}
    $oldCache=Join-Path $cacheBase 'pv-usage-dashboard\snapshot.json'
    $newCacheDir=Join-Path $cacheBase 'usage-dashboard'
    $newCache=Join-Path $newCacheDir 'snapshot.json'
    if ((Test-Path -LiteralPath $oldCache -PathType Leaf) -and -not (Test-Path -LiteralPath $newCache)) {
        New-Item -ItemType Directory -Force -Path $newCacheDir | Out-Null
        Copy-Item -LiteralPath $oldCache -Destination $newCache
    }
    # Move the old installation OUTSIDE the auto-discovery plugins directory.
    # The backup is retained for rollback. No user accounts are changed.
    if (Confirm-PluginIdentity -Directory $old -Expected 'pv-usage-dashboard') {
        $backups=Join-Path $root '.usage-dashboard-legacy-backups'
        New-Item -ItemType Directory -Force -Path $backups | Out-Null
        $backup=Join-Path $backups "pv-usage-dashboard-$(Get-Date -Format yyyyMMddHHmmss)-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
        Move-Item -LiteralPath $old -Destination $backup
        Write-Host "Previous version archived (not deleted): $backup"
    }
    # Auto-discovered plugin directories must NOT also be listed explicitly.
    Remove-DuplicatePluginReferences -ConfigRoot $root
    Write-Host "Usage Dashboard $($package.version) installed: $target" -ForegroundColor Green
    Write-Host 'Restart OpenCode Desktop. One plugin entry should appear in Settings > Extensions > Plugins.'
    Write-Host 'For OpenAI or Zen API balances, use Connect Billing in the Usage Dashboard popup.'
    Write-Host 'If previously loaded, remove the retired Usage Dashboard Billing extension from Edge or Chrome manually.'
} catch {
    Write-Error "Usage Dashboard installation failed: $($_.Exception.Message)"
    exit 1
}
