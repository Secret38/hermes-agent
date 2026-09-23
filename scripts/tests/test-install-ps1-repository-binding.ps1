# Behavioral tests for release repository binding in scripts/install.ps1.
#
# Hermes-Setup.exe bakes both a commit and a repository. A fork-built release
# must never silently fetch NousResearch/hermes-agent just because an older
# checkout or an installer constant still points there.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$installScript = Join-Path $repoRoot 'scripts\install.ps1'
$testRoot = Join-Path $env:TEMP ("hermes-repository-binding-" + [Guid]::NewGuid().ToString('N'))
$HermesHome = Join-Path $testRoot 'home'
$InstallDir = Join-Path $testRoot 'checkout'

$script:Failures = 0
function Assert-Equal {
    param($Expected, $Actual, [string]$Label)
    if ($Expected -ceq $Actual) {
        Write-Host "PASS: $Label"
    } else {
        Write-Host "FAIL: $Label"
        Write-Host "  expected: [$Expected]"
        Write-Host "  actual:   [$Actual]"
        $script:Failures++
    }
}

Write-Host '-- explicit release repository --'
. $installScript -HermesHome $HermesHome -InstallDir $InstallDir -Repository 'Secret38/hermes-agent'
Assert-Equal 'https://github.com/Secret38/hermes-agent.git' $RepoUrlHttps 'HTTPS origin follows -Repository'
Assert-Equal 'git@github.com:Secret38/hermes-agent.git' $RepoUrlSsh 'SSH origin follows -Repository'

Write-Host ''
Write-Host '-- upstream default remains stable --'
. $installScript -HermesHome $HermesHome -InstallDir $InstallDir
Assert-Equal 'https://github.com/NousResearch/hermes-agent.git' $RepoUrlHttps 'default HTTPS origin remains upstream'
Assert-Equal 'git@github.com:NousResearch/hermes-agent.git' $RepoUrlSsh 'default SSH origin remains upstream'

Write-Host ''
Write-Host '-- malformed repository fails closed --'
$threw = $false
try {
    . $installScript -HermesHome $HermesHome -InstallDir $InstallDir -Repository 'https://github.com/evil/repo'
} catch {
    $threw = $true
}
Assert-Equal $true $threw 'URL-shaped repository input is rejected'

$threw = $false
try {
    . $installScript -HermesHome $HermesHome -InstallDir $InstallDir -Repository '../evil'
} catch {
    $threw = $true
}
Assert-Equal $true $threw 'path traversal repository input is rejected'

if (Test-Path $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($script:Failures -gt 0) {
    Write-Host ''
    Write-Host "$script:Failures assertion(s) failed"
    exit 1
}

Write-Host ''
Write-Host 'all repository binding assertions passed'
