# Usage Dashboard
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
# Source: https://github.com/ItanBlackwell/usage-dashboard
# Read-only accessibility probe, with an optional graceful close of exactly
# one dedicated browser window. Never inject input, attach a debugger, read
# passwords/cookies, or terminate a browser process.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateRange(1,2147483647)][int]$BrowserProcessId,
    [Parameter(Mandatory)][string]$BrowserExecutable,
    [Parameter(Mandatory)][string]$ProfileDirectory,
    [Parameter(Mandatory)][ValidateSet('codex','opencode')][string]$Provider,
    [Parameter(Mandatory)][long]$StartedAt,
    [string]$ExpectedUrl = '',
    [int]$ExpectedWindow = 0
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

function Write-Result {
    param([string]$State,[string]$Url = '',[int]$Window = 0)
    # Fixed status, canonical billing URL and HWND only; never raw UIA output.
    @{state=$State;url=$Url;window=$Window} | ConvertTo-Json -Compress
}

function Get-CanonicalBillingUrl {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw) -or $Raw.Length -gt 512) { return $null }
    $uri = $null
    if (-not [Uri]::TryCreate($Raw,[UriKind]::Absolute,[ref]$uri)) { return $null }
    if ($uri.Scheme -cne 'https' -or -not $uri.IsDefaultPort -or $uri.UserInfo) { return $null }
    if ($Provider -eq 'codex' -and $uri.Host -ceq 'platform.openai.com' -and
        $uri.AbsolutePath -cmatch '^/settings/organization/billing/overview/?$') {
        $base = 'https://platform.openai.com/settings/organization/billing/overview'
        $org = $null; $short = $null
        foreach ($part in $uri.Query.TrimStart('?').Split('&')) {
            $pair = $part.Split([char[]]'=',2,[StringSplitOptions]::None)
            if ($pair.Length -ne 2) { continue }
            $key = [Uri]::UnescapeDataString($pair[0])
            $value = [Uri]::UnescapeDataString($pair[1])
            if ($key -ceq 'organization' -and $null -eq $org) { $org=$value }
            if ($key -ceq 'org' -and $null -eq $short) { $short=$value }
        }
        if (-not $org) { $org=$short }
        if ($org -cmatch '^org[-_][A-Za-z0-9_-]{1,120}$') { return "${base}?organization=$org" }
        return $base
    }
    if ($Provider -eq 'opencode' -and $uri.Host -ceq 'opencode.ai' -and
        $uri.AbsolutePath -cmatch '^/(?:workspace/[A-Za-z0-9_-]+/billing|(?:console/)?[A-Za-z0-9_-]+/settings/billing)/?$') {
        return 'https://opencode.ai'+$uri.AbsolutePath.TrimEnd('/')
    }
    return $null
}

function Test-OwnedProcess {
    # Query only the spawned PID. PID, executable, start time and the exact
    # dedicated profile argument must all match. Registry commands and
    # arbitrary arguments are never executed.
    $p = Get-Process -Id $BrowserProcessId -ErrorAction Stop
    if (-not $p.Path -or -not [string]::Equals([IO.Path]::GetFullPath($p.Path),
            [IO.Path]::GetFullPath($BrowserExecutable),[StringComparison]::OrdinalIgnoreCase)) { return $false }
    $epoch = [DateTime]::SpecifyKind([DateTime]'1970-01-01',[DateTimeKind]::Utc)
    $born = [long]($p.StartTime.ToUniversalTime()-$epoch).TotalMilliseconds
    if ($born -lt ($StartedAt-2000) -or $born -gt ($StartedAt+30000)) { return $false }
    $processInfo = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $BrowserProcessId" -ErrorAction Stop
    if (-not $processInfo -or -not $processInfo.CommandLine) { return $false }
    $argv = [UsageDashboard.NativeArguments]::Split([string]$processInfo.CommandLine)
    $profileArgs = @($argv | Where-Object { $_ -like '--user-data-dir=*' })
    if ($profileArgs.Count -ne 1) { return $false }
    $actual = $profileArgs[0].Substring('--user-data-dir='.Length)
    if (-not [IO.Path]::IsPathRooted($actual)) { return $false }
    return [string]::Equals([IO.Path]::GetFullPath($actual),
        [IO.Path]::GetFullPath($ProfileDirectory),[StringComparison]::OrdinalIgnoreCase)
}

function Get-DocumentUrl {
    param($Document)
    $pattern = $null
    if (-not $Document.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { return $null }
    # The loaded document's value, not the editable address bar, is the URL.
    return Get-CanonicalBillingUrl ([string]$pattern.Current.Value)
}

function Get-UsdAmount {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 48) { return $null }
    $value = ($Text -replace [char]0x2212,'-' -replace '\s+',' ').Trim()
    if ($value -notmatch '^(?<sign>-?)\s*(?:US\s*\$|\$|USD)\s*(?<number>-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)$') { return $null }
    if ($Matches.sign -and $Matches.number.StartsWith('-')) { return $null }
    $number = $Matches.sign+$Matches.number.Replace(',','')
    $amount = [decimal]0
    if (-not [decimal]::TryParse($number,[Globalization.NumberStyles]::Number,
            [Globalization.CultureInfo]::InvariantCulture,[ref]$amount)) { return $null }
    if ($amount -gt 100000000 -or $amount -lt -1000000 -or ($Provider -eq 'opencode' -and $amount -lt 0)) { return $null }
    return $amount
}

function Test-BillingBalance {
    param($Document)
    $labels = '^(?:credit balance|prepaid balance|available credits?|current balance|available balance)'
    if ($Provider -eq 'opencode') { $labels = '^(?:credit balance|prepaid balance|available credits?|current balance|available balance|balance|credits)' }
    $textCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Text)
    $items = $Document.FindAll([System.Windows.Automation.TreeScope]::Descendants,$textCondition)
    if ($items.Count -gt 1500) { return $false }
    $values = New-Object 'System.Collections.Generic.HashSet[decimal]'
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    foreach ($item in $items) {
        if ($item.Current.IsOffscreen -or $item.Current.IsPassword) { continue }
        $name = ([string]$item.Current.Name).Trim()
        if ($name.Length -gt 120 -or $name -notmatch $labels) { continue }
        $match = [regex]::Match($name,$labels,[Text.RegularExpressions.RegexOptions]::IgnoreCase)
        $tail = $name.Substring($match.Length).Trim().TrimStart(':').Trim()
        if ($tail) {
            $amount = Get-UsdAmount $tail
            if ($null -ne $amount) { [void]$values.Add($amount) }
            continue
        }
        # Only adjacent accessible text, never a full document dump.
        $parent = $walker.GetParent($item)
        $candidates = @($walker.GetNextSibling($item))
        if ($parent -and -not $parent.Equals($Document)) { $candidates += $walker.GetNextSibling($parent) }
        foreach ($candidate in $candidates) {
            if (-not $candidate -or $candidate.Current.IsOffscreen -or $candidate.Current.IsPassword) { continue }
            if ($candidate.Current.ControlType -ne [System.Windows.Automation.ControlType]::Text) { continue }
            $amount = Get-UsdAmount ([string]$candidate.Current.Name)
            if ($null -ne $amount) { [void]$values.Add($amount); break }
        }
    }
    return ($values.Count -eq 1)
}

function Get-BillingWindow {
    $pidCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,$BrowserProcessId)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children,$pidCondition)
    $browserWindows = @($windows | Where-Object {
        $_.Current.ClassName -ceq 'Chrome_WidgetWin_1'
    })
    if ($browserWindows.Count -ne 1) { return $null }
    $window = $browserWindows[0]
    if ($window.Current.IsOffscreen) { return $null }
    $visibleWindows = @($windows | Where-Object {
        $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window -and -not $_.Current.IsOffscreen
    })
    if ($visibleWindows.Count -ne 1 -or -not $visibleWindows[0].Equals($window)) { return $null }
    if (-not $window.Current.NativeWindowHandle) { return $null }
    $docCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Document)
    $docs = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$docCondition) |
        Where-Object { -not $_.Current.IsOffscreen })
    # Multiple visible documents/frames are intentionally ambiguous.
    if ($docs.Count -ne 1) { return $null }
    $document = $docs[0]
    $url = Get-DocumentUrl $document
    if (-not $url) { return $null }
    $tabCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$tabCondition)
    $browserTabs = @()
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    foreach ($tab in $tabs) {
        # Ignore tab controls inside the Billing document, but include hidden
        # browser tabs so that we never close a window containing other tabs.
        $ancestor = $walker.GetParent($tab); $inside=$false; $reachedWindow=$false
        for ($i=0;$i -lt 50 -and $ancestor;$i++) {
            if ($ancestor.Equals($document)) { $inside=$true; break }
            if ($ancestor.Equals($window)) { $reachedWindow=$true; break }
            $ancestor = $walker.GetParent($ancestor)
        }
        if ($inside) { continue }
        if (-not $reachedWindow) { return $null }
        $browserTabs += $tab
    }
    if ($browserTabs.Count -ne 1) { return $null }
    $selected = $null
    if (-not $browserTabs[0].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$selected) -or
        -not $selected.Current.IsSelected) { return $null }
    if (-not (Test-BillingBalance $document)) { return $null }
    return [pscustomobject]@{Element=$window;Url=$url;Handle=[int]$window.Current.NativeWindowHandle}
}

try {
    if (-not [IO.Path]::IsPathRooted($BrowserExecutable) -or -not [IO.Path]::IsPathRooted($ProfileDirectory) -or
        $BrowserExecutable.StartsWith('\\') -or $ProfileDirectory.StartsWith('\\') -or $StartedAt -le 0) {
        Write-Result 'unavailable'; exit 0
    }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace UsageDashboard {
    public static class NativeArguments {
        [DllImport("shell32.dll", SetLastError=true)]
        private static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string value, out int count);
        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr value);
        public static string[] Split(string value) {
            int count;
            IntPtr argv=CommandLineToArgvW(value,out count);
            if(argv==IntPtr.Zero) return new string[0];
            try {
                var result=new string[count];
                for(int i=0;i<count;i++) result[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv,i*IntPtr.Size));
                return result;
            } finally { LocalFree(argv); }
        }
    }
}
'@
    if (-not (Test-OwnedProcess)) { Write-Result 'unavailable'; exit 0 }
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
    $result = Get-BillingWindow
    if (-not $result) { Write-Result 'not_ready'; exit 0 }
    if ($ExpectedUrl -and $ExpectedWindow -ne 0 -and
        $result.Url -ceq (Get-CanonicalBillingUrl $ExpectedUrl) -and $result.Handle -eq $ExpectedWindow) {
        # Recheck ownership and freshly sampled document/handle before asking
        # the window manager to close. Never send keys or kill a process.
        if (-not (Test-OwnedProcess)) { Write-Result 'unavailable'; exit 0 }
        $fresh = Get-BillingWindow
        if (-not $fresh -or $fresh.Handle -ne $result.Handle -or $fresh.Url -cne $result.Url -or
            $fresh.Element.Current.ProcessId -ne $BrowserProcessId) {
            Write-Result 'not_ready'; exit 0
        }
        $close = $null
        if (-not $fresh.Element.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern,[ref]$close)) {
            Write-Result 'unavailable'; exit 0
        }
        if ($close.Current.WindowInteractionState -ne [System.Windows.Automation.WindowInteractionState]::ReadyForUserInteraction) {
            Write-Result 'not_ready'; exit 0
        }
        $close.Close()
        Write-Result 'close_requested' $fresh.Url $fresh.Handle
    } else {
        Write-Result 'ready' $result.Url $result.Handle
    }
} catch {
    # UIA providers may fail or disappear. Manual closure remains supported.
    Write-Result 'unavailable'
}
