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

# The selected distribution must also take ownership of an existing managed checkout.
$tempRepo = Join-Path ([System.IO.Path]::GetTempPath()) ("hermes-origin-test-" + [Guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Path $tempRepo -Force | Out-Null
    & git -C $tempRepo init | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git init failed" }
    & git -C $tempRepo remote add origin "https://github.com/NousResearch/hermes-agent.git"
    if ($LASTEXITCODE -ne 0) { throw "git remote add failed" }

    . $installScript -RepoUrl $customRepo
    Set-ManagedRepositoryOrigin -Repo $tempRepo -Url $customRepo
    $origin = (& git -C $tempRepo remote get-url origin).Trim()
    if ($origin -ne $customRepo) { throw "managed checkout origin was not switched: $origin" }
} finally {
    Remove-Item -LiteralPath $tempRepo -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "OK: existing managed checkout adopts selected distribution origin" -ForegroundColor Green
