$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'install.ps1')
$temp = Join-Path ([IO.Path]::GetTempPath()) ('agent-os-isolated-' + [guid]::NewGuid().ToString('N'))
$originalUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
try {
    $HermesHome = Join-Path $temp 'Hermes second home'
    $shortcuts = Join-Path $temp 'shortcuts'
    New-Item -ItemType Directory -Path $HermesHome,$shortcuts -Force | Out-Null
    @{id=('a' * 32)} | ConvertTo-Json | Set-Content (Join-Path $HermesHome 'agent-os-instance.json') -Encoding UTF8
    Set-LauncherUserPath (Join-Path $HermesHome 'bin')
    if ([Environment]::GetEnvironmentVariable('Path', 'User') -ne $originalUserPath) { throw 'Existing user PATH was modified' }
    $probe = Join-Path $HermesHome 'probe.cmd'
    "@echo off`r`nset HERMES_ > `"%~dp0observed.txt`"`r`n" | Set-Content $probe -Encoding ASCII
    $originalShortcut = Join-Path $shortcuts 'Hermes.lnk'
    'existing-shortcut' | Set-Content $originalShortcut
    New-DesktopShortcuts -TargetExe $probe -ShortcutFolders @($shortcuts)
    if ((Get-Content $originalShortcut -Raw).Trim() -ne 'existing-shortcut') { throw 'Existing shortcut was overwritten' }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $shortcuts 'Hermes Agent OS (aaaaaaaa).lnk'))
    $env:HERMES_HOME = Join-Path $temp 'unrelated-home'
    $env:HERMES_DESKTOP_USER_DATA_DIR = Join-Path $temp 'unrelated-desktop'
    $env:HERMES_RUNTIME_DIR = Join-Path $temp 'unrelated-runtime'
    Start-Process -FilePath $shortcut.TargetPath -ArgumentList $shortcut.Arguments -Wait
    $observedPath = Join-Path $HermesHome 'observed.txt'
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path $observedPath) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 100 }
    $observed = Get-Content $observedPath -Raw
    foreach ($entry in @("HERMES_HOME=$HermesHome", "HERMES_DESKTOP_USER_DATA_DIR=$(Join-Path $HermesHome 'desktop-data')", "HERMES_RUNTIME_DIR=$(Join-Path $HermesHome 'runtime')")) {
        if (-not $observed.Contains($entry)) { throw "Launcher did not bind $entry" }
    }
    Write-Host 'Isolated launcher: real child environment, existing shortcut and user PATH verified.'
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
