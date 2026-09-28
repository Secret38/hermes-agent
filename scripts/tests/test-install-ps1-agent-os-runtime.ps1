# Drive the real installer dispatcher and installed-command bridge against
# a temporary CLI fixture. This tests wiring/failure propagation, not CUA itself.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$installer = Join-Path $repoRoot 'scripts\install.ps1'
$shellPath = (Get-Process -Id $PID).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('hermes-agent-os-stage-' + [Guid]::NewGuid().ToString('N'))
$checkout = Join-Path $testRoot 'checkout'
$helperDir = Join-Path $checkout 'scripts\desktop-update'
$probeVars = @('HERMES_STAGE_PROBE_SHELL', 'HERMES_STAGE_PROBE_CLI', 'HERMES_STAGE_PROBE_CASE', 'HERMES_STAGE_PROBE_CALLS')
$previous = @{}
foreach ($name in $probeVars) { $previous[$name] = [Environment]::GetEnvironmentVariable($name) }

try {
    New-Item -ItemType Directory -Force -Path $helperDir | Out-Null
    $env:HERMES_STAGE_PROBE_SHELL = $shellPath
    $env:HERMES_STAGE_PROBE_CLI = Join-Path $testRoot 'cli.ps1'
    $env:HERMES_STAGE_PROBE_CALLS = Join-Path $testRoot 'calls.txt'
    @'
function Get-HermesRuntimeCommand {
    param([string]$InstallRoot)
    @($env:HERMES_STAGE_PROBE_SHELL, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $env:HERMES_STAGE_PROBE_CLI)
}
'@ | Set-Content -Encoding utf8 (Join-Path $helperDir 'runtime.ps1')
    @'
ConvertTo-Json -InputObject @($args) -Compress | Add-Content $env:HERMES_STAGE_PROBE_CALLS
if ($args[1] -eq 'provision') {
    Write-Output 'fixture provision diagnostic'
    if ($env:HERMES_STAGE_PROBE_CASE -eq 'provision-failure') { exit 7 }
    exit 0
}
switch ($env:HERMES_STAGE_PROBE_CASE) {
    'invalid-json' { Write-Output 'not a health report'; exit 0 }
    'degraded' { Write-Output '{"full_ready":false,"production_security_ready":true}'; exit 0 }
    'skip-browser' { Write-Output '{"full_ready":false,"production_security_ready":true}'; exit 0 }
    'unsafe' { Write-Output '{"full_ready":true,"production_security_ready":false}'; exit 0 }
    'status-failure' { Write-Output '{"full_ready":true,"production_security_ready":true}'; exit 8 }
    default { Write-Output '{"full_ready":true,"production_security_ready":true}'; exit 0 }
}
'@ | Set-Content -Encoding utf8 $env:HERMES_STAGE_PROBE_CLI

    foreach ($case in @('ready', 'provision-failure', 'status-failure', 'invalid-json', 'degraded', 'unsafe', 'skip-browser')) {
        $env:HERMES_STAGE_PROBE_CASE = $case
        if (Test-Path $env:HERMES_STAGE_PROBE_CALLS) { Remove-Item $env:HERMES_STAGE_PROBE_CALLS }
        $extraArgs = @()
        if ($case -eq 'skip-browser') { $extraArgs += '-SkipBrowser' }
        $output = & $shellPath -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer `
            -IncludeDesktop -Stage agent-os-runtime -NonInteractive -Json `
            -HermesHome (Join-Path $testRoot 'home') -InstallDir $checkout @extraArgs
        $code = $LASTEXITCODE
        $frames = @($output | Where-Object { $_ -match '^\{' } | ForEach-Object { $_ | ConvertFrom-Json })
        $expected = $case -eq 'ready'
        if ($frames.Count -ne 1 -or $frames[0].stage -ne 'agent-os-runtime' -or
            $frames[0].ok -ne $expected -or $frames[0].skipped -ne $false -or
            (($code -eq 0) -ne $expected)) {
            throw "Wrong stage outcome for $case (exit=$code): $($output -join ' | ')"
        }
        if (-not $expected -and -not $frames[0].reason) { throw "Missing error detail for $case" }
        $calls = @(Get-Content $env:HERMES_STAGE_PROBE_CALLS)
        $expectedProvision = 'agent-os provision --production-security'
        if ($case -eq 'skip-browser') { $expectedProvision += ' --skip-browser' }
        if ((($calls[0] | ConvertFrom-Json) -join ' ') -ne $expectedProvision) {
            throw 'Provisioning must explicitly request the production security profile'
        }
        if ($case -eq 'provision-failure') {
            if ($calls.Count -ne 1) { throw 'Readiness must not run after failed provisioning' }
        } elseif ($calls.Count -ne 2 -or
            (($calls[1] | ConvertFrom-Json) -join ' ') -ne 'agent-os status --require-full --require-production-security --json') {
            throw 'Readiness must verify automation and security through the installed CLI'
        }
        Write-Host "PASS: Agent OS stage $case"
    }
} finally {
    foreach ($name in $probeVars) { [Environment]::SetEnvironmentVariable($name, $previous[$name]) }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}
