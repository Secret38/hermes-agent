param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
    [string]$Version,
    [string]$Repository = "Secret38/hermes-agent",
    [string]$Branch = "agent-os-v1"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Gh {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = @(& gh @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw ("gh " + ($Arguments -join " ") + " failed:" + [Environment]::NewLine + ($output -join [Environment]::NewLine))
    }
    return $output
}

function Invoke-GhJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $raw = (Invoke-Gh -Arguments $Arguments) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return $raw | ConvertFrom-Json
}

if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue)) { throw "GitHub CLI is required." }
if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) { throw "Git is required." }

& gh auth status | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Authenticate GitHub CLI first with gh auth login." }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$tag = "agent-os-v$Version"

Write-Step "Resolving immutable release head"

& git -C $repoRoot fetch origin $Branch --tags
if ($LASTEXITCODE -ne 0) { throw "Could not fetch origin/$Branch." }

$head = (& git -C $repoRoot rev-parse "origin/$Branch").Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($head)) { throw "Could not resolve origin/$Branch." }

$remoteTag = @(& git -C $repoRoot ls-remote --tags origin "refs/tags/$tag" 2>$null)
if ($remoteTag.Count -gt 0) {
    throw "Release tag $tag already exists. Never reuse or move an Agent OS release tag; choose a new version."
}

Write-Step "Verifying protected source and immutable tag policy"

$branchInfo = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/branches/$Branch")
if (-not $branchInfo.protected) { throw "$Branch is not protected. Run agent_os_release_setup.ps1 first." }

$rulesets = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/rulesets")
$tagRuleset = @($rulesets) | Where-Object { $_.name -eq "Agent OS immutable release tags" -and $_.enforcement -eq "active" } | Select-Object -First 1
if (-not $tagRuleset) { throw "Agent OS immutable release-tag ruleset is not active." }

Write-Step "Requiring green CI for $head"

$checks = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/commits/$head/check-runs?per_page=100")
$requiredChecks = @("All required checks pass", "build pinned Hermes-Setup.exe")

foreach ($name in $requiredChecks) {
    $check = @($checks.check_runs) | Where-Object { $_.name -eq $name } | Sort-Object started_at -Descending | Select-Object -First 1
    if (-not $check) { throw "Required check '$name' is missing for $head." }
    if ($check.status -ne "completed" -or $check.conclusion -ne "success") {
        throw "Required check '$name' is not green for $head (status=$($check.status), conclusion=$($check.conclusion))."
    }
}

Write-Step "Verifying signing secrets"

$secrets = Invoke-GhJson -Arguments @("secret", "list", "--repo", $Repository, "--app", "actions", "--json", "name")
$secretNames = @($secrets | ForEach-Object { $_.name })
foreach ($name in @("WINDOWS_CODE_SIGN_PFX_B64", "WINDOWS_CODE_SIGN_PASSWORD")) {
    if ($secretNames -notcontains $name) { throw "Required Actions secret $name is missing." }
}

Write-Step "Verifying interactive Windows GUI runner"

$runners = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/actions/runners?per_page=100")
$runner = @($runners.runners) | Where-Object {
    $_.status -eq "online" -and
    (@($_.labels | ForEach-Object { $_.name }) -contains "agent-os-gui") -and
    (@($_.labels | ForEach-Object { $_.name }) -contains "Windows") -and
    (@($_.labels | ForEach-Object { $_.name }) -contains "X64")
} | Select-Object -First 1

if (-not $runner) { throw "No online Windows x64 runner with label agent-os-gui is available." }
Write-Host "Using runner: $($runner.name)" -ForegroundColor Green

Write-Step "Dispatching release preflight"

$before = Get-Date
Invoke-Gh -Arguments @("workflow", "run", "agent-os-release-preflight.yml", "--ref", $Branch, "--repo", $Repository) | Out-Null

$preflight = $null
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    Start-Sleep -Seconds 2
    $runs = Invoke-GhJson -Arguments @("run", "list", "--repo", $Repository, "--workflow", "agent-os-release-preflight.yml", "--event", "workflow_dispatch", "--limit", "10", "--json", "databaseId,headSha,status,conclusion,createdAt")
    $preflight = @($runs) | Where-Object { $_.headSha -eq $head -and ([DateTime]$_.createdAt) -ge $before.AddMinutes(-1) } | Sort-Object createdAt -Descending | Select-Object -First 1
    if ($preflight) { break }
}

if (-not $preflight) { throw "Could not locate the newly dispatched Agent OS Release Preflight." }

& gh run watch $preflight.databaseId --repo $Repository --exit-status
if ($LASTEXITCODE -ne 0) { throw "Release preflight failed. No release tag was created." }

Write-Step "Creating immutable release tag $tag"

& git -C $repoRoot tag -a $tag $head -m "Agent OS $tag"
if ($LASTEXITCODE -ne 0) { throw "Could not create local tag $tag." }

& git -C $repoRoot push origin "refs/tags/$tag"
if ($LASTEXITCODE -ne 0) { throw "Could not push release tag $tag." }

Write-Step "Waiting for production release workflow"

$releaseRun = $null
for ($attempt = 0; $attempt -lt 45; $attempt += 1) {
    Start-Sleep -Seconds 2
    $runs = Invoke-GhJson -Arguments @("run", "list", "--repo", $Repository, "--workflow", "agent-os-release.yml", "--limit", "20", "--json", "databaseId,headBranch,headSha,status,conclusion,event")
    $releaseRun = @($runs) | Where-Object { $_.event -eq "push" -and $_.headBranch -eq $tag -and $_.headSha -eq $head } | Select-Object -First 1
    if ($releaseRun) { break }
}

if (-not $releaseRun) { throw "Agent OS Release workflow did not appear for $tag." }

& gh run watch $releaseRun.databaseId --repo $Repository --exit-status
if ($LASTEXITCODE -ne 0) {
    throw "Production release failed for immutable tag $tag. Fix the cause and publish a NEW version; never move this tag."
}

Write-Step "Verifying published production release"

$release = Invoke-GhJson -Arguments @("release", "view", $tag, "--repo", $Repository, "--json", "isDraft,isPrerelease,assets,url")
if ($release.isDraft -or $release.isPrerelease) { throw "Release $tag is not a normal production release." }

$assetNames = @($release.assets | ForEach-Object { $_.name })
$expectedAssets = @(
    "Hermes-Setup.exe",
    "SHA256SUMS.txt",
    "build-metadata.json",
    "source-build-metadata.json",
    "agent-os-health.json",
    "agent-os-repair-health.json",
    "agent-os-golden-results.json",
    "qualification-metadata.json"
)

foreach ($asset in $expectedAssets) {
    if ($assetNames -notcontains $asset) { throw "Published release is missing required asset: $asset" }
}

Write-Host ""
Write-Host "Agent OS $tag is published and production-qualified." -ForegroundColor Green
Write-Host $release.url
