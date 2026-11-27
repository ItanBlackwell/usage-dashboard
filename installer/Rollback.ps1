# Usage Dashboard
# SPDX-License-Identifier: MPL-2.0
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
try {
  $root=Get-OpenCodeRoot
  $target=Join-Path $root 'plugins\usage-dashboard'
  $backup=Get-ChildItem -LiteralPath $root -Directory -Filter '.usage-dashboard-backup-*'|Sort-Object LastWriteTime -Descending|Select-Object -First 1
  if(!$backup){throw 'No backup available'}
  Assert-NoReparseTree -Path $backup.FullName
  Assert-NoReparsePath -Path $target
  $current=Get-Content -LiteralPath (Join-Path $target 'package.json') -Raw|ConvertFrom-Json
  $next=Get-Content -LiteralPath (Join-Path $backup.FullName 'package.json') -Raw|ConvertFrom-Json
  if($current.name -ne 'usage-dashboard' -or $next.name -ne 'usage-dashboard'){throw 'Invalid backup'}
  $queue=Join-Path $root '.usage-dashboard-pending'
  Assert-NoReparsePath -Path $queue
  New-Item -ItemType Directory -Path $queue|Out-Null
  foreach($file in @('Common.ps1','Deferred.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $queue $file)}
  foreach($file in @('package.json','dist\gui-experimental.cjs')){
    $dest=Join-Path $queue "payload\$file"
    New-Item -ItemType Directory -Force -Path (Split-Path $dest)|Out-Null
    Copy-Item -LiteralPath (Join-Path $backup.FullName $file) -Destination $dest
  }
  [IO.File]::WriteAllText((Join-Path $queue 'operation.json'),(@{action='rollback';current=$current.version;next=$next.version}|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
  Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $queue 'Deferred.ps1')+'"')) -WindowStyle Hidden
  Write-Host 'Rollback queued. OpenCode will not be stopped.'
}catch{Write-Host $_ -ForegroundColor Red;exit 1}
