$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
$installScript = Join-Path $repoRoot "scripts\install.ps1"
$bootstrapScript = Join-Path $repoRoot "scripts\install-hermes-os.ps1"

if (-not (Test-Path -LiteralPath $installScript)) { throw "Missing install.ps1" }
if (-not (Test-Path -LiteralPath $bootstrapScript)) { throw "Missing install-hermes-os.ps1" }

function Invoke-JsonScript {
    param([string]$Script, [string[]]$Arguments)

    $psExe = (Get-Process -Id $PID).Path
    $global:LASTEXITCODE = 0
    $raw = & $psExe -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) { throw "$Script exited $code" }
    return ($raw -join [Environment]::NewLine) | ConvertFrom-Json
}

$customRepo = "https://github.com/Secret38/hermes-agent.git"
$paths = Invoke-JsonScript -Script $installScript -Arguments @("-RepoUrl", $customRepo, "-ShowResolvedPaths")
if ($paths.repo_url -ne $customRepo) { throw "install.ps1 did not preserve custom RepoUrl: $($paths.repo_url)" }

$defaultPaths = Invoke-JsonScript -Script $installScript -Arguments @("-ShowResolvedPaths")
if ($defaultPaths.repo_url -ne "https://github.com/NousResearch/hermes-agent.git") {
    throw "install.ps1 default repository changed unexpectedly: $($defaultPaths.repo_url)"
}

$plan = Invoke-JsonScript -Script $bootstrapScript -Arguments @("-Branch", "hermes-os/v1-shell", "-ShowPlan")
if ($plan.repo_url -ne $customRepo) { throw "Hermes OS bootstrap does not pin the fork repository" }
if ($plan.branch -ne "hermes-os/v1-shell") { throw "Hermes OS bootstrap did not preserve requested branch" }
if (-not $plan.include_desktop) { throw "Hermes OS bootstrap must include the Desktop product" }
if ($plan.installer_url -ne "https://raw.githubusercontent.com/Secret38/hermes-agent/hermes-os/v1-shell/scripts/install.ps1") {
    throw "Hermes OS bootstrap resolved the wrong installer URL: $($plan.installer_url)"
}

Write-Host "OK: Hermes OS distribution repository and bootstrap contracts" -ForegroundColor Green
