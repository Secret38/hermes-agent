$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
. (Join-Path $sourceRoot 'scripts/agent_os_user_test.ps1')
$temp = Join-Path ([IO.Path]::GetTempPath()) ('agent-os-kit-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $package = Join-Path $temp 'package with spaces'
    $testHome = Join-Path $temp 'home'
    New-Item -ItemType Directory -Path $package | Out-Null
    $exe = Join-Path $package 'Hermes-Setup.exe'
    [IO.File]::WriteAllBytes($exe, [byte[]]@(1,2,3,4))
    $commit = 'a' * 40
    @{ repository='Secret38/hermes-agent'; commit=$commit; branch='test'; sha256=(Get-FileHash $exe).Hash.ToLowerInvariant() } |
        ConvertTo-Json | Set-Content (Join-Path $package 'build-metadata.json') -Encoding UTF8

    # Integrity gates actual preparation; a damaged package never creates work.
    [IO.File]::WriteAllBytes($exe, [byte[]]@(4,3,2,1))
    $blocked = $false
    try { Prepare-TestWorkspace $package $testHome } catch { $blocked = $true }
    if (-not $blocked -or (Test-Path (Join-Path $package 'Arbeitsordner'))) { throw 'Corrupt installer was not blocked before preparation' }
    [IO.File]::WriteAllBytes($exe, [byte[]]@(1,2,3,4))
    Prepare-TestWorkspace $package $testHome
    if (-not (Test-Path (Join-Path $package 'Arbeitsordner/Testaufgaben.txt'))) { throw 'Test workspace missing' }

    # Use the canonical resolver and a real child process, not a PATH stub.
    $root = Join-Path $testHome 'hermes-agent'
    $bin = Join-Path $root '.hermes/bin'
    $runtimeDir = Join-Path $root 'scripts/desktop-update'
    New-Item -ItemType Directory -Path $bin,$runtimeDir -Force | Out-Null
    Copy-Item (Join-Path $sourceRoot 'scripts/desktop-update/runtime.ps1') $runtimeDir
    @{pinnedCommit=$commit} | ConvertTo-Json | Set-Content (Join-Path $root '.hermes-bootstrap-complete') -Encoding UTF8
    $healthScript = Join-Path $temp 'health.ps1'
    @'
@{full_ready=$true; production_security_ready=$true; secret='do-not-export'; checks=@(@{name='scanner'; status='PASS'; message='do-not-export'})} | ConvertTo-Json -Depth 4
exit 0
'@ | Set-Content $healthScript -Encoding UTF8
    $commandJson = ConvertTo-Json -InputObject @('powershell.exe','-NoProfile','-File',$healthScript) -Compress
    "@echo off`r`necho $commandJson`r`nexit /b 0" | Set-Content (Join-Path $bin 'hermes.cmd') -Encoding ASCII
    Get-TestDiagnostic $package $testHome
    $reportText = Get-Content (Join-Path $package 'Testdiagnose.json') -Raw
    $report = $reportText | ConvertFrom-Json
    if (-not $report.full_ready -or $reportText.Contains('do-not-export') -or $null -ne $report.user_end_to_end_passed) { throw 'Readiness report leaked data or invented user-test evidence' }
    @{pinnedCommit=('b' * 40)} | ConvertTo-Json | Set-Content (Join-Path $root '.hermes-bootstrap-complete') -Encoding UTF8
    $blocked = $false
    try { Get-TestDiagnostic $package $testHome } catch { $blocked = $true }
    if (-not $blocked) { throw 'Wrong installed candidate was accepted' }
    Write-Host 'User kit: integrity/preparation and runtime identity/privacy cases passed.'
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
