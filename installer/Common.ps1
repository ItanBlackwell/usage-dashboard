# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
# Internal helper for installation and uninstallation. No third-party dependencies.
Set-StrictMode -Version Latest
function Get-OpenCodeRoot {
    if ($env:OPENCODE_CONFIG_DIR -and [System.IO.Path]::IsPathRooted($env:OPENCODE_CONFIG_DIR)) {
        return [System.IO.Path]::GetFullPath($env:OPENCODE_CONFIG_DIR)
    }
    return (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.config\opencode')
}
function Remove-DuplicatePluginReferences {
    param([string]$ConfigRoot)
    $targets = @(
        ((Join-Path $ConfigRoot 'plugins\pv-usage-dashboard').Replace('\','/')).TrimEnd('/'),
        ((Join-Path $ConfigRoot 'plugins\usage-dashboard').Replace('\','/')).TrimEnd('/')
    )
    foreach ($name in @('opencode.jsonc','opencode.json')) {
        $file = Join-Path $ConfigRoot $name
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        Assert-NoReparsePath -Path $file
        $raw = [System.IO.File]::ReadAllText($file)
        $match = [regex]::Match($raw, '(?s)"plugins"\s*:\s*\[(?<items>[^\[\]]*)\]')
        if (-not $match.Success) { continue }
        $items = $match.Groups['items']
        $tokens = [regex]::Matches($items.Value, '"(?:\\.|[^"\\])*"')
        $remainder = [regex]::Replace($items.Value, '"(?:\\.|[^"\\])*"', '')
        # A complex plugin list may contain comments or objects. Never rewrite it blindly.
        if ($remainder -notmatch '^[\s,]*$') {
            Write-Warning "Skipped automatic cleanup of complex plugin array: $file"
            continue
        }
        $kept = [System.Collections.Generic.List[string]]::new()
        $removed = 0
        foreach ($token in $tokens) {
            try { $value = ConvertFrom-Json -InputObject $token.Value -ErrorAction Stop }
            catch { $kept.Add($token.Value); continue }
            $normalized = ([string]$value).Replace('\','/').TrimEnd('/')
            if ($normalized -match '^file:///' ) { $normalized = $normalized.Substring(8) }
            $legacyName = $normalized -ieq 'pv-usage-dashboard'
            $ours = @($targets | Where-Object { $normalized -ieq $_ })
            if ($legacyName -or $ours.Count -gt 0) { $removed += 1 }
            else { $kept.Add($token.Value) }
        }
        if ($removed -eq 0) { continue }
        $updated = $raw.Substring(0,$items.Index) + ($kept -join ', ') + $raw.Substring($items.Index+$items.Length)
        $backup = "$file.before-usage-dashboard.$(Get-Date -Format yyyyMMddHHmmss).bak"
        Assert-NoReparsePath -Path $backup
        Copy-Item -LiteralPath $file -Destination $backup -ErrorAction Stop
        [System.IO.File]::WriteAllText($file, $updated, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Removed $removed old/duplicate plugin reference(s) from $name. Backup: $backup"
    }
}
function Confirm-PluginIdentity {
    param([string]$Directory,[string]$Expected)
    $manifest = Join-Path $Directory 'package.json'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
    try { $p = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json; return $p.name -eq $Expected }
    catch { return $false }
}

# Migration only: remove the retired extension's known files. Never edit
# browser profiles or registrations, follow a reparse point, or remove
# unrecognized user files from the old directory.
function Remove-LegacyBillingCompanion {
    param([Parameter(Mandatory)][string]$Directory)
    $folder = Join-Path $Directory 'browser-extension'
    if (-not (Test-Path -LiteralPath $folder -PathType Container)) { return }
    try {
        $item = Get-Item -LiteralPath $folder -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Write-Warning "Skipped legacy Billing folder because it is a reparse point: $folder"
            return
        }
        foreach ($name in @('manifest.json','background.js','content.js','pairing.json','pairing.example.json','NOTICE.txt')) {
            $file = Join-Path $folder $name
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
            $entry = Get-Item -LiteralPath $file -Force
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
            Remove-Item -LiteralPath $file -Force -ErrorAction Stop
        }
        if (@(Get-ChildItem -LiteralPath $folder -Force).Count -eq 0) {
            Remove-Item -LiteralPath $folder -Force -ErrorAction Stop
        }
        Write-Host 'Removed obsolete Billing companion files.'
    } catch {
        Write-Warning "Could not fully clean obsolete Billing companion files. Remove them manually after closing its browser: $folder"
    }
}

# Migration only: remove the installed runtime from the former Billing
# implementation. A receipt and matching package identity are required.
# Leave unknown dependencies and private user data untouched.
function Remove-RetiredBillingRuntime {
    param([Parameter(Mandatory)][string]$Directory)
    if (-not (Confirm-PluginIdentity -Directory $Directory -Expected 'usage-dashboard')) { return }
    try {
        $root = Get-Item -LiteralPath $Directory -Force
        if (($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return }
        $helperDir = Join-Path $Directory 'installer'
        if (Test-Path -LiteralPath $helperDir -PathType Container) {
            $item = Get-Item -LiteralPath $helperDir -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
                $helper = Join-Path $helperDir 'BillingWindow.ps1'
                if (Test-Path -LiteralPath $helper -PathType Leaf) {
                    $file = Get-Item -LiteralPath $helper -Force
                    if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
                        Remove-Item -LiteralPath $helper -Force
                    }
                }
                if (@(Get-ChildItem -LiteralPath $helperDir -Force).Count -eq 0) {
                    Remove-Item -LiteralPath $helperDir -Force
                }
            }
        }
        $modules = Join-Path $Directory 'node_modules'
        if (-not (Test-Path -LiteralPath $modules -PathType Container)) { return }
        if (((Get-Item -LiteralPath $modules -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return }
        $runtime = Join-Path $modules 'playwright-core'
        if (-not (Test-Path -LiteralPath $runtime -PathType Container)) { return }
        if (((Get-Item -LiteralPath $runtime -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return }
        $receipt = Join-Path $runtime '.usage-dashboard-integrity'
        $manifest = Join-Path $runtime 'package.json'
        if (-not (Test-Path -LiteralPath $receipt -PathType Leaf) -or -not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return }
        foreach ($file in @($receipt,$manifest)) {
            if (((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return }
        }
        if ((Get-Content -LiteralPath $receipt -Raw).Trim() -notmatch '^sha512-[A-Za-z0-9+/]+={0,2}$' -or
            -not (Confirm-PluginIdentity -Directory $runtime -Expected 'playwright-core')) { return }
        $pending = New-Object 'System.Collections.Generic.Stack[string]'
        $pending.Push($runtime)
        while ($pending.Count -gt 0) {
            foreach ($entry in Get-ChildItem -LiteralPath ($pending.Pop()) -Force) {
                if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                    Write-Warning 'Skipped retired runtime cleanup: reparse point found.'
                    return
                }
                if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
            }
        }
        Remove-Item -LiteralPath $runtime -Recurse -Force
        if (@(Get-ChildItem -LiteralPath $modules -Force).Count -eq 0) { Remove-Item -LiteralPath $modules -Force }
        Write-Host 'Removed retired Billing runtime.'
    } catch {
        Write-Warning 'Could not completely remove the retired Billing runtime. Close OpenCode and retry installation.'
    }
}

# Refuse redirected filesystem paths before modifying user or plugin data.
function Assert-NoReparsePath {
    param([Parameter(Mandatory)][string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $entry = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing to modify a reparse point: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
}
function Assert-NoReparseTree {
    param([Parameter(Mandatory)][string]$Path)
    Assert-NoReparsePath -Path $Path
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        foreach ($entry in Get-ChildItem -LiteralPath ($pending.Pop()) -Force -ErrorAction Stop) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing to remove a tree containing a reparse point: $($entry.FullName)" }
            if ($entry.PSIsContainer) { $pending.Push($entry.FullName) }
        }
    }
}

function Test-UsageOpenCodeRunning {
    return [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.ProcessName -match 'opencode'} | Select-Object -First 1)
}
function Queue-UsageOperation {
    param([string]$Action,[string]$PackageRoot,[bool]$Purge=$false)
    $root=Get-OpenCodeRoot
    $queue=Join-Path $root '.usage-dashboard-pending'
    Assert-NoReparsePath -Path $queue
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    New-Item -ItemType Directory -Path $queue -ErrorAction Stop | Out-Null
    try{
        foreach($file in @('Common.ps1','Deferred.ps1','Install-UsageDashboard.ps1','Uninstall-UsageDashboard.ps1')){
            $src=Join-Path $PSScriptRoot $file
            Assert-NoReparsePath -Path $src
            Copy-Item -LiteralPath $src -Destination (Join-Path $queue $file)
        }
        if($Action -eq 'install'){
            $payload=Join-Path $queue 'payload'
            foreach($file in @('package.json','dist\gui-experimental.cjs','installer\Common.ps1','installer\Deferred.ps1')){
                $src=Join-Path $PackageRoot $file
                Assert-NoReparsePath -Path $src
                $dest=Join-Path $payload $file
                New-Item -ItemType Directory -Force -Path (Split-Path $dest)|Out-Null
                Copy-Item -LiteralPath $src -Destination $dest
            }
        }
        [IO.File]::WriteAllText((Join-Path $queue 'operation.json'),(@{action=$Action;purge=$Purge}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
        Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' +(Join-Path $queue 'Deferred.ps1')+ '"')) -WindowStyle Hidden
        Write-Host 'Operation queued; OpenCode will not be stopped.'
    }catch{Write-Warning "Pending operation retained at $queue; inspect before retrying.";throw}
}
