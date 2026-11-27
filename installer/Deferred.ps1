# Usage Dashboard - deferred local activation
# Copyright (c) 2026 ItanBlackwell.
# SPDX-License-Identifier: MPL-2.0
param([switch]$Once)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
$queue=Join-Path (Get-OpenCodeRoot) '.usage-dashboard-pending'
if([IO.Path]::GetFullPath($PSScriptRoot) -ine [IO.Path]::GetFullPath($queue)){throw 'Run the staged worker from its queue only.'}
Assert-NoReparseTree -Path $queue
$lock=Join-Path $queue 'worker.lock'
try{$handle=[IO.File]::Open($lock,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)}catch{exit 0}
try{
  while(Test-UsageOpenCodeRunning){
    if($Once){Write-Host 'Still queued';exit 0}
    Start-Sleep -Milliseconds 500
  }
  $state=Get-Content -LiteralPath (Join-Path $queue 'operation.json') -Raw|ConvertFrom-Json
  if(Test-UsageOpenCodeRunning){throw 'OpenCode restarted before activation; retry the worker.'}
  switch($state.action){
    'install' {
      & (Join-Path $queue 'Install-UsageDashboard.ps1') -PackageRoot (Join-Path $queue 'payload') -ApplyQueued
      if(!$? -or $LASTEXITCODE){throw 'Installation failed'}
    }
    'uninstall' {
      & (Join-Path $queue 'Uninstall-UsageDashboard.ps1') -PurgeCachedData:([bool]$state.purge) -ApplyQueued
      if(!$? -or $LASTEXITCODE){throw 'Removal failed'}
    }
    'update' {
      $target=Join-Path (Get-OpenCodeRoot) 'plugins\usage-dashboard'
      Assert-NoReparseTree -Path $target
      $manifest=Join-Path $target 'package.json'
      $current=Get-Content -LiteralPath $manifest -Raw|ConvertFrom-Json
      $next=Get-Content -LiteralPath (Join-Path $queue 'payload\package.json') -Raw|ConvertFrom-Json
      if($current.name -ne 'usage-dashboard' -or $next.name -ne 'usage-dashboard' -or $current.version -ne $state.current -or $next.version -ne $state.next -or [version]$next.version -le [version]$current.version){throw 'Version changed or invalid'}
      $backup=Join-Path (Get-OpenCodeRoot) ('.usage-dashboard-backup-'+[Guid]::NewGuid().ToString('N'))
      New-Item -ItemType Directory -Path (Join-Path $backup 'dist')|Out-Null
      $files=@('package.json','dist\gui-experimental.cjs')
      foreach($name in $files){Copy-Item -LiteralPath (Join-Path $target $name) -Destination (Join-Path $backup $name)}
      try{
        foreach($name in $files){
          if(Test-UsageOpenCodeRunning){throw 'OpenCode restarted during activation'}
          $dest=Join-Path $target $name
          $temp=$dest+'.pending-'+[Guid]::NewGuid().ToString('N')
          Copy-Item -LiteralPath (Join-Path $queue "payload\$name") -Destination $temp
          [IO.File]::Replace($temp,$dest,$null)
        }
      }catch{
        foreach($name in $files){Copy-Item -LiteralPath (Join-Path $backup $name) -Destination (Join-Path $target $name) -Force}
        throw
      }
    }
    default{throw 'Unknown queued operation'}
  }
  $completed=$true
}catch{
  Add-Content -LiteralPath (Join-Path $queue 'activation.log') -Value $_.Exception.Message
  Write-Error $_
}finally{
  $handle.Dispose()
  if((Get-Variable completed -ErrorAction SilentlyContinue) -and $completed){
    $archive=Join-Path (Get-OpenCodeRoot) ('.usage-dashboard-applied-'+[Guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $queue -Destination $archive
  }
}
