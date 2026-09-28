# Exercise the same child-process protocol consumed by Hermes-Setup.exe.
# Run under both Windows PowerShell 5.1 and PowerShell 7 before packaging.
[CmdletBinding()]
param(
    [string]$InstallerPath = (Join-Path $PSScriptRoot '..\install.ps1')
)

$ErrorActionPreference = 'Stop'
$shellPath = (Get-Process -Id $PID).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('hermes-protocol-' + [Guid]::NewGuid().ToString('N'))
$homePath = Join-Path $testRoot 'home'
$checkoutPath = Join-Path $testRoot 'checkout'
$commonArgs = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', $InstallerPath, '-HermesHome', $homePath, '-InstallDir', $checkoutPath,
    '-Repository', 'Secret38/hermes-agent')

try {
    $version = & $shellPath @commonArgs -ProtocolVersion
    if ($LASTEXITCODE -ne 0 -or "$version".Trim() -ne '1') {
        throw "Installer protocol probe failed: exit=$LASTEXITCODE output=$version"
    }

    foreach ($desktop in @($false, $true)) {
        $manifestArgs = @('-Manifest')
        if ($desktop) { $manifestArgs += '-IncludeDesktop' }
        $output = & $shellPath @commonArgs @manifestArgs
        if ($LASTEXITCODE -ne 0) { throw "Installer manifest failed: exit=$LASTEXITCODE" }
        $manifest = ($output -join "`n") | ConvertFrom-Json
        if ($manifest.protocol_version -ne [int]"$version".Trim()) {
            throw 'Manifest and protocol version disagree'
        }
        $names = @($manifest.stages | ForEach-Object { $_.name })
        if ($names.Count -eq 0 -or $names[-1] -ne 'complete' -or
            $names -notcontains 'repository' -or $names -notcontains 'products' -or
            @($names | Select-Object -Unique).Count -ne $names.Count) {
            throw "Invalid installer stage sequence: $($names -join ', ')"
        }
        if (@($manifest.stages | Where-Object { $_.needs_user_input -isnot [bool] }).Count -gt 0) {
            throw 'Every stage must declare whether user input is required'
        }
        Write-Host "PASS: protocol and manifest (desktop=$desktop): $($names -join ' -> ')"
    }
    if (Test-Path -LiteralPath $testRoot) {
        throw 'Protocol queries must not create an installation or user state'
    }
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
