# Usage Dashboard
# SPDX-License-Identifier: MPL-2.0
. (Join-Path $PSScriptRoot 'Common.ps1')
$queue=Join-Path (Get-OpenCodeRoot) '.usage-dashboard-pending'
$worker=Join-Path $queue 'Deferred.ps1'
Assert-NoReparsePath -Path $worker
if(!(Test-Path -LiteralPath $worker -PathType Leaf)){Write-Host 'No pending worker';exit 0}
& $worker -Once
exit $LASTEXITCODE
