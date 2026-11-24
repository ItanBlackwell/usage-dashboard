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

# Discover installed browser executables without changing browser settings or
# relying on PATH, the default browser, or profile contents.
function Find-BillingBrowserExecutable {
    param([string]$Name,[string]$RelativePath,[string[]]$InstallRoots,[switch]$SkipRegistry)
    foreach ($root in $InstallRoots) {
        if ([string]::IsNullOrWhiteSpace($root) -or -not [IO.Path]::IsPathRooted($root)) { continue }
        $candidate = Join-Path $root $RelativePath
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    if (-not $SkipRegistry) {
        foreach ($key in @(
            "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$Name",
            "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$Name",
            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\$Name"
        )) {
            try {
                $entry = Get-Item -LiteralPath $key -ErrorAction Stop
                $value = $entry.GetValue('')
                if ($value -isnot [string]) { continue }
                $candidate = [Environment]::ExpandEnvironmentVariables($value.Trim().Trim('"'))
                if ([IO.Path]::IsPathRooted($candidate) -and
                    [IO.Path]::GetFileName($candidate) -ieq $Name -and
                    (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
            } catch { # Missing/inaccessible App Paths must not prevent fallback.
            }
        }
    }
    return $null
}
function Get-BillingBrowser {
    param(
        [string[]]$InstallRoots = @(
            [Environment]::GetEnvironmentVariable('ProgramFiles(x86)'),
            [Environment]::GetEnvironmentVariable('ProgramW6432'),
            [Environment]::GetEnvironmentVariable('ProgramFiles'),
            [Environment]::GetEnvironmentVariable('LOCALAPPDATA')
        ),
        [switch]$SkipRegistry
    )
    $edge = Find-BillingBrowserExecutable -Name 'msedge.exe' -RelativePath 'Microsoft\Edge\Application\msedge.exe' -InstallRoots $InstallRoots -SkipRegistry:$SkipRegistry
    if ($edge) {
        return [pscustomobject]@{ Name='Microsoft Edge'; Executable=$edge; ExtensionsUrl='edge://extensions' }
    }
    $chrome = Find-BillingBrowserExecutable -Name 'chrome.exe' -RelativePath 'Google\Chrome\Application\chrome.exe' -InstallRoots $InstallRoots -SkipRegistry:$SkipRegistry
    if ($chrome) {
        return [pscustomobject]@{ Name='Google Chrome'; Executable=$chrome; ExtensionsUrl='chrome://extensions' }
    }
    return $null
}
function Start-BillingCompanionSetup {
    param([Parameter(Mandatory)][string]$ExtensionDirectory)
    # Optional interactive setup. Never alter browser profiles, policies,
    # developer mode, extension registrations, or provider authentication.
    Write-Host ''
    Write-Host 'Optional Billing companion (required for OpenAI and OpenCode Zen API balances)' -ForegroundColor Cyan
    Write-Host "Installed extension folder: $ExtensionDirectory"
    $browser = Get-BillingBrowser
    if ($null -eq $browser) {
        Write-Warning 'Neither Microsoft Edge nor Google Chrome was found. The plugin is installed; see docs/BROWSER_EXTENSION.md for manual setup.'
        return
    }
    Write-Host "Selected browser: $($browser.Name)"
    Write-Host "Extensions page: $($browser.ExtensionsUrl)"
    try {
        Set-Clipboard -Value $ExtensionDirectory -ErrorAction Stop
        Write-Host 'The extension folder path has been copied to the clipboard.'
    } catch {
        Write-Warning 'Could not copy the folder path. Use the displayed path instead.'
    }
    Write-Host 'Complete these steps manually in the selected browser profile:'
    Write-Host '  1. Turn on Developer mode.'
    Write-Host '  2. If Usage Dashboard Billing is already loaded from this folder, click Reload.'
    Write-Host '     Otherwise click Load unpacked, paste or select the folder above, and confirm.'
    Write-Host '  3. Make sure the extension is enabled; approve any required site permissions.'
    Write-Host '  4. Pin the extension (recommended). Sign in to the correct provider account.'
    Write-Host '     Open the Billing pages, keeping one billing tab per provider.'
    try {
        Start-Process -FilePath $browser.Executable -ArgumentList $browser.ExtensionsUrl -ErrorAction Stop
    } catch {
        Write-Warning 'Could not open the browser automatically. Open the extensions page shown above manually.'
        return
    }
    # Launch public provider entry points only on explicit confirmation.
    $answer = Read-Host 'After loading/reloading the extension, type O to open both provider pages, or press Enter to skip'
    if ($answer -ieq 'O') {
        try {
            Start-Process -FilePath $browser.Executable -ArgumentList @(
                'https://platform.openai.com/settings/organization/billing/overview',
                'https://opencode.ai/console'
            ) -ErrorAction Stop
            Write-Host 'In OpenCode Console, select your workspace and open Settings > Billing.'
            Write-Host 'Refresh any billing tabs that were open before loading the extension.'
        } catch {
            Write-Warning 'Could not open provider pages automatically. Use the links in docs/BROWSER_EXTENSION.md.'
        }
    }
    Write-Host 'Browser setup requires your confirmation; installation of the extension itself is not verified.'
    Write-Host 'Restart OpenCode Desktop and check the extension badge on each billing page.'
}
