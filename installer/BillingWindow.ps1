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
$script:ProbeReason = 'helper'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version Latest

function Write-Result {
    param([string]$State,[string]$Url = '',[int]$Window = 0,[string]$Reason = 'helper')
    # Fixed status, canonical billing URL and HWND only; never raw UIA output.
    @{state=$State;url=$Url;window=$Window;reason=$Reason} | ConvertTo-Json -Compress
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
    if ($Document.Current.IsPassword) { return $null }
    if ($Document.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
        $url = Get-CanonicalBillingUrl ([string]$pattern.Current.Value)
        if ($url) { return $url }
    }
    # Some Chromium providers expose the document value property without
    # advertising the entire ValuePattern. Never use the editable address bar.
    $value = $Document.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty,$true)
    if ($value -is [string]) { return Get-CanonicalBillingUrl $value }
    return $null
}

function Get-UsdAmount {
    param([string]$Text)
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 48) { return $null }
    $value = ($Text -replace [char]0x2212,'-' -replace '\s+',' ').Trim()
    if ($value -match '^(?<sign>-?)\s*(?:US\s*\$|\$|USD)\s*(?<number>.+)$') {
        $value = $Matches.sign+$Matches.number
    } elseif ($value -match '^(?<number>.+?)\s*(?:USD|US\s*\$|\$)$') {
        $value = $Matches.number.Trim()
    } else { return $null }
    if ($value -match '^-?\d{1,3}(?: \d{3})+(?:[.,]\d{1,6})?$') {
        $value = $value.Replace(' ','').Replace(',','.')
    } elseif ($value -match '^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?$') {
        $value = $value.Replace(',','')
    } elseif ($value -match '^-?\d{1,3}(?:\.\d{3})+,\d{1,6}$') {
        $value = $value.Replace('.','').Replace(',','.')
    } elseif ($value -match '^-?\d+,\d{1,2}$') {
        $value = $value.Replace(',','.')
    }
    if ($value -notmatch '^-?\d+(?:\.\d{1,6})?$') { return $null }
    $amount = [decimal]0
    if (-not [decimal]::TryParse($value,[Globalization.NumberStyles]::Number,
            [Globalization.CultureInfo]::InvariantCulture,[ref]$amount)) { return $null }
    if ($amount -gt 100000000 -or $amount -lt -1000000 -or ($Provider -eq 'opencode' -and $amount -lt 0)) { return $null }
    return $amount
}

function Test-BillingBalance {
    param($Document)
    # Localized labels are Unicode escapes to keep the helper compatible with
    # Windows PowerShell 5.1's default script encoding.
    $specific = '^(?:(?:current |available |remaining )?credit balance|prepaid (?:credit )?balance|available credits?|remaining credits?|credits? remaining|prepaid credits?|current balance|available balance|credit remaining|\u0431\u0430\u043b\u0430\u043d\u0441 \u043a\u0440\u0435\u0434\u0438\u0442\u043e\u0432|\u043e\u0441\u0442\u0430\u0442\u043e\u043a \u043a\u0440\u0435\u0434\u0438\u0442\u043e\u0432|\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u043a\u0440\u0435\u0434\u0438\u0442\u044b|\u043a\u0440\u0435\u0434\u0438\u0442\u043d\u044b\u0439 \u0431\u0430\u043b\u0430\u043d\u0441|\u0442\u0435\u043a\u0443\u0449\u0438\u0439 \u0431\u0430\u043b\u0430\u043d\u0441|\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0439 \u0431\u0430\u043b\u0430\u043d\u0441)(?:\s*\(USD\))?(?=$|\s|[:\uFF1A])'
    $generic = '^(?:credits|balance|\u043a\u0440\u0435\u0434\u0438\u0442\u044b|\u0431\u0430\u043b\u0430\u043d\u0441)(?:\s*\(USD\))?(?=$|\s|[:\uFF1A])'
    $textCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Text)
    $items = $Document.FindAll([System.Windows.Automation.TreeScope]::Descendants,$textCondition)
    if ($items.Count -gt 1500) { return $false }
    $specificValues = New-Object 'System.Collections.Generic.HashSet[decimal]'
    $genericValues = New-Object 'System.Collections.Generic.HashSet[decimal]'
    $seenSpecific = $false
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    foreach ($item in $items) {
        if ($item.Current.IsOffscreen -or $item.Current.IsPassword) { continue }
        $name = (([string]$item.Current.Name) -replace '\s+',' ').Trim()
        if (-not $name -or $name.Length -gt 160) { continue }
        $match = [regex]::Match($name,$specific,[Text.RegularExpressions.RegexOptions]::IgnoreCase)
        $isSpecific = $match.Success
        if (-not $isSpecific -and $Provider -eq 'opencode') {
            $match = [regex]::Match($name,$generic,[Text.RegularExpressions.RegexOptions]::IgnoreCase)
        }
        if (-not $match.Success) { continue }
        $tail = $name.Substring($match.Length).Trim().TrimStart([char[]]@(':',[char]0xFF1A)).Trim()
        # A longer unrelated phrase such as "Balance top-up" isn't a label.
        if ($tail -and $tail -notmatch '^(?:-?\s*(?:US\s*\$|\$|USD)|-?\s*\d)') { continue }
        $values = if ($isSpecific) { ,$specificValues } else { ,$genericValues }
        if ($isSpecific) { $seenSpecific=$true }
        if ($tail) {
            $amount = Get-UsdAmount $tail
            if ($null -ne $amount) { [void]$values.Add($amount) }
            continue
        }
        # Only adjacent text or a small adjacent accessible wrapper, never
        # all text on the document or a password field.
        $node = $item
        for ($depth=0;$depth -lt 4 -and $node -and -not $node.Equals($Document);$depth++) {
            $candidate = $walker.GetNextSibling($node)
            if ($candidate -and -not $candidate.Current.IsOffscreen -and -not $candidate.Current.IsPassword) {
                $candidateText = ([string]$candidate.Current.Name).Trim()
                if ($candidateText) {
                    $amount = Get-UsdAmount $candidateText
                    if ($null -ne $amount) { [void]$values.Add($amount) }
                } elseif ($candidate.Current.ControlType -in @([System.Windows.Automation.ControlType]::Group,[System.Windows.Automation.ControlType]::Pane)) {
                    $children = $candidate.FindAll([System.Windows.Automation.TreeScope]::Children,$textCondition)
                    if ($children.Count -le 3) {
                        $parts = @($children | Where-Object { -not $_.Current.IsOffscreen -and -not $_.Current.IsPassword } | ForEach-Object { [string]$_.Current.Name })
                        $amount = Get-UsdAmount ($parts -join ' ')
                        if ($null -ne $amount) { [void]$values.Add($amount) }
                    }
                }
            }
            $parent = $walker.GetParent($node)
            if (-not $parent -or $parent.Equals($Document) -or $parent.Current.IsPassword) { break }
            # Do not walk out of a label wrapper containing unrelated text.
            $parentName = (([string]$parent.Current.Name) -replace '\s+',' ').Trim()
            if ($parentName -and $parentName -ne $name) { break }
            $node=$parent
        }
    }
    if ($seenSpecific) { return ($specificValues.Count -eq 1) }
    return ($genericValues.Count -eq 1)
}

function Get-BillingWindow {
    $script:ProbeReason = 'window'
    $pidCondition = [System.Windows.Automation.PropertyCondition]::new(
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
    $script:ProbeReason = 'document'
    $docCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Document)
    $docs = @($window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$docCondition) |
        Where-Object { -not $_.Current.IsOffscreen })
    # Ignore nested frame documents. Multiple independent top-level web
    # documents are still ambiguous and must not trigger a close.
    $rawWalker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $topDocs = @()
    foreach ($doc in $docs) {
        $ancestor = $rawWalker.GetParent($doc); $nested=$false; $reached=$false
        for ($i=0;$i -lt 80 -and $ancestor;$i++) {
            if ($ancestor.Equals($window)) { $reached=$true; break }
            if ($ancestor.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document) { $nested=$true; break }
            $ancestor=$rawWalker.GetParent($ancestor)
        }
        if (-not $nested -and $reached) { $topDocs += $doc }
    }
    if ($topDocs.Count -ne 1) { return $null }
    $document = $topDocs[0]
    $url = Get-DocumentUrl $document
    if (-not $url) { return $null }
    $script:ProbeReason = 'tabs'
    $tabCondition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,$tabCondition)
    $browserTabs = @()
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
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
    $script:ProbeReason = 'balance'
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
    if (-not (Test-OwnedProcess)) { Write-Result 'unavailable' -Reason 'window'; exit 0 }
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
    $result = Get-BillingWindow
    if (-not $result) { Write-Result 'not_ready' -Reason $script:ProbeReason; exit 0 }
    if ($ExpectedUrl -and $ExpectedWindow -ne 0 -and
        $result.Url -ceq (Get-CanonicalBillingUrl $ExpectedUrl) -and $result.Handle -eq $ExpectedWindow) {
        # Recheck ownership and freshly sampled document/handle before asking
        # the window manager to close. Never send keys or kill a process.
        if (-not (Test-OwnedProcess)) { Write-Result 'unavailable'; exit 0 }
        $fresh = Get-BillingWindow
        if (-not $fresh -or $fresh.Handle -ne $result.Handle -or $fresh.Url -cne $result.Url -or
            $fresh.Element.Current.ProcessId -ne $BrowserProcessId) {
            Write-Result 'not_ready' -Reason $script:ProbeReason; exit 0
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
