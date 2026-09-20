# Hermes OS Windows bootstrap installer.
#
# Production user surface:
#   iex (irm https://raw.githubusercontent.com/Secret38/hermes-agent/main/scripts/install-hermes-os.ps1)
#
# The bootstrap is intentionally tiny. It downloads this distribution's real
# installer and pins the repository URL so a fresh install cannot silently fall
# back to NousResearch/main.

param(
    [string]$Branch = $(if ($env:HERMES_OS_BRANCH) { $env:HERMES_OS_BRANCH } else { "main" }),
    [string]$Commit = "",
    [string]$HermesHome = $(if ($env:HERMES_HOME) { $env:HERMES_HOME } else { "$env:LOCALAPPDATA\hermes" }),
    [switch]$NonInteractive,
    [switch]$ShowPlan
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoUrl = "https://github.com/Secret38/hermes-agent.git"
$rawRef = if ($Commit) { $Commit } else { $Branch }
$installerUrl = "https://raw.githubusercontent.com/Secret38/hermes-agent/$rawRef/scripts/install.ps1"

$plan = @{
    repo_url = $RepoUrl
    branch = $Branch
    commit = $Commit
    installer_url = $installerUrl
    hermes_home = $HermesHome
    include_desktop = $true
}

if ($ShowPlan) {
    $plan | ConvertTo-Json -Compress
    exit 0
}

$tempRoot = if ($env:TEMP) { $env:TEMP } else { [System.IO.Path]::GetTempPath() }
$tempScript = Join-Path $tempRoot ("hermes-os-install-" + [Guid]::NewGuid().ToString("N") + ".ps1")

try {
    Write-Host "Hermes OS V1 installer" -ForegroundColor Cyan
    Write-Host "Repository: $RepoUrl"
    Write-Host "Ref:        $rawRef"
    Write-Host ""

    Invoke-WebRequest -Uri $installerUrl -OutFile $tempScript -UseBasicParsing

    $invokeArgs = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $tempScript,
        "-RepoUrl", $RepoUrl,
        "-Branch", $Branch,
        "-HermesHome", $HermesHome,
        "-IncludeDesktop"
    )
    if ($Commit) {
        $invokeArgs += @("-Commit", $Commit)
    }
    if ($NonInteractive) {
        $invokeArgs += "-NonInteractive"
    }

    & powershell.exe @invokeArgs
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "Hermes OS installer failed with exit code $code"
    }
} finally {
    Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
}
