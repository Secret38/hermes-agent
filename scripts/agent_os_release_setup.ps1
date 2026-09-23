param(
    [string]$Repository = "Secret38/hermes-agent",
    [string]$Branch = "agent-os-v1",
    [string]$RunnerRoot = "C:\actions-runner-agent-os",
    [string]$RunnerName = "",
    [string]$RunnerVersion = "2.337.0",
    [string]$PfxPath = "",
    [System.Security.SecureString]$PfxPassword,
    [switch]$SkipSigningSecrets,
    [switch]$SkipRunnerInstall
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

function Invoke-GhApiJsonInput {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Endpoint,
        [Parameter(Mandatory = $true)]$Body
    )
    $json = $Body | ConvertTo-Json -Depth 20 -Compress
    $args = @("api", "--method", $Method, "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", $Endpoint, "--input", "-")
    $output = @($json | & gh @args 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw ("gh api " + $Method + " " + $Endpoint + " failed:" + [Environment]::NewLine + ($output -join [Environment]::NewLine))
    }
    $raw = $output -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return $raw | ConvertFrom-Json
}

function Ensure-Gh {
    if (Get-Command gh.exe -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI is required. Install it from https://cli.github.com/ and rerun this script."
    }

    Write-Step "Installing GitHub CLI"
    & winget install --id GitHub.cli --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI installation failed." }

    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"

    if (-not (Get-Command gh.exe -ErrorAction SilentlyContinue)) {
        throw "GitHub CLI was installed. Open a new PowerShell window and rerun this script."
    }
}

function Ensure-GhAuthentication {
    & gh auth status | Out-Null
    if ($LASTEXITCODE -eq 0) { return }

    Write-Step "Authenticating GitHub CLI"
    & gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
    if ($LASTEXITCODE -ne 0) { throw "GitHub CLI authentication failed." }
}

function Set-BranchProtection {
    Write-Step "Protecting release branch"

    $body = [ordered]@{
        required_status_checks = [ordered]@{
            strict = $true
            contexts = @("All required checks pass", "build pinned Hermes-Setup.exe")
        }
        enforce_admins = $true
        required_pull_request_reviews = $null
        restrictions = $null
        required_linear_history = $true
        allow_force_pushes = $false
        allow_deletions = $false
        block_creations = $false
        required_conversation_resolution = $false
        lock_branch = $false
        allow_fork_syncing = $true
    }

    Invoke-GhApiJsonInput -Method "PUT" -Endpoint "repos/$Repository/branches/$Branch/protection" -Body $body | Out-Null

    $branchInfo = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/branches/$Branch")
    if (-not $branchInfo.protected) { throw "$Branch still reports protected=false." }

    Write-Host "$Branch is protected." -ForegroundColor Green
}

function Set-ReleaseTagRuleset {
    Write-Step "Protecting release tags"

    $rulesetName = "Agent OS immutable release tags"
    $existing = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/rulesets")
    $ruleset = @($existing) | Where-Object { $_.name -eq $rulesetName } | Select-Object -First 1

    $body = [ordered]@{
        name = $rulesetName
        target = "tag"
        enforcement = "active"
        conditions = [ordered]@{
            ref_name = [ordered]@{
                include = @("refs/tags/agent-os-v*")
                exclude = @()
            }
        }
        rules = @(
            [ordered]@{ type = "update"; parameters = [ordered]@{ update_allows_fetch_and_merge = $false } },
            [ordered]@{ type = "deletion" }
        )
    }

    if ($ruleset) {
        Invoke-GhApiJsonInput -Method "PUT" -Endpoint "repos/$Repository/rulesets/$($ruleset.id)" -Body $body | Out-Null
    } else {
        Invoke-GhApiJsonInput -Method "POST" -Endpoint "repos/$Repository/rulesets" -Body $body | Out-Null
    }

    $after = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/rulesets")
    $active = @($after) | Where-Object { $_.name -eq $rulesetName -and $_.enforcement -eq "active" } | Select-Object -First 1
    if (-not $active) { throw "Release-tag ruleset was not activated." }

    Write-Host "agent-os-v* tags are protected from update and deletion." -ForegroundColor Green
}

function Set-SigningSecrets {
    if ($SkipSigningSecrets) {
        Write-Host "Skipping signing-secret setup." -ForegroundColor Yellow
        return
    }

    if ([string]::IsNullOrWhiteSpace($PfxPath)) {
        throw "Provide -PfxPath with the production Windows code-signing PFX, or pass -SkipSigningSecrets."
    }
    if (-not (Test-Path -LiteralPath $PfxPath -PathType Leaf)) { throw "PFX not found: $PfxPath" }
    if ($null -eq $PfxPassword) { $PfxPassword = Read-Host "PFX password" -AsSecureString }

    Write-Step "Validating signing certificate"

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($PfxPassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    try {
        $flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
        $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path -LiteralPath $PfxPath).Path, $plainPassword, $flags)

        if (-not $cert.HasPrivateKey) { throw "PFX has no private key." }
        $now = Get-Date
        if ($now -lt $cert.NotBefore -or $now -ge $cert.NotAfter) { throw "Signing certificate is outside its validity period." }

        $codeSigningOid = "1.3.6.1.5.5.7.3.3"
        $hasCodeSigning = $false
        foreach ($extension in $cert.Extensions) {
            if ($extension -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]) {
                foreach ($oid in $extension.EnhancedKeyUsages) {
                    if ($oid.Value -eq $codeSigningOid) { $hasCodeSigning = $true }
                }
            }
        }
        if (-not $hasCodeSigning) { throw "Certificate does not contain the Code Signing EKU." }

        Write-Step "Publishing encrypted Actions secrets"

        $pfxB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PfxPath).Path))

        $out = @($pfxB64 | & gh secret set WINDOWS_CODE_SIGN_PFX_B64 --repo $Repository 2>&1)
        if ($LASTEXITCODE -ne 0) { throw ("Could not set WINDOWS_CODE_SIGN_PFX_B64: " + ($out -join [Environment]::NewLine)) }

        $out = @($plainPassword | & gh secret set WINDOWS_CODE_SIGN_PASSWORD --repo $Repository 2>&1)
        if ($LASTEXITCODE -ne 0) { throw ("Could not set WINDOWS_CODE_SIGN_PASSWORD: " + ($out -join [Environment]::NewLine)) }

        Write-Host "Signing secrets configured." -ForegroundColor Green
    }
    finally {
        $plainPassword = $null
        $pfxB64 = $null
    }
}

function Install-InteractiveRunner {
    if ($SkipRunnerInstall) {
        Write-Host "Skipping self-hosted runner setup." -ForegroundColor Yellow
        return
    }
    if ($env:OS -ne "Windows_NT") { throw "The GUI runner must be configured on Windows." }

    $sessionId = (Get-Process -Id $PID).SessionId
    if ($sessionId -le 0) { throw "This process is in Session 0. Log in to the Windows desktop and rerun the script interactively." }

    if ([string]::IsNullOrWhiteSpace($RunnerName)) { $RunnerName = "$env:COMPUTERNAME-agent-os-gui" }

    Write-Step "Downloading verified GitHub Actions Runner"

    $release = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/actions/runner/releases/tags/v$RunnerVersion")
    $assetName = "actions-runner-win-x64-$RunnerVersion.zip"
    $asset = @($release.assets) | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
    if (-not $asset) { throw "Runner asset $assetName not found." }

    $digest = [string]$asset.digest
    if ([string]::IsNullOrWhiteSpace($digest) -or -not $digest.StartsWith("sha256:")) { throw "Runner asset has no published SHA-256 digest." }

    New-Item -ItemType Directory -Force -Path $RunnerRoot | Out-Null
    $zip = Join-Path $env:TEMP $assetName
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip

    $expected = $digest.Substring(7).ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $zip).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Runner package SHA-256 mismatch." }

    if (Test-Path (Join-Path $RunnerRoot ".runner") -PathType Leaf) {
        Write-Step "Removing previous runner registration"
        $removeToken = Invoke-GhJson -Arguments @("api", "--method", "POST", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/actions/runners/remove-token")
        Push-Location $RunnerRoot
        try {
            & .\config.cmd remove --token $removeToken.token
            if ($LASTEXITCODE -ne 0) { throw "Existing runner registration could not be removed." }
        }
        finally { Pop-Location }

        Get-CimInstance Win32_Process -Filter "Name = 'Runner.Listener.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*$RunnerRoot*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 1
    }

    Get-ChildItem -LiteralPath $RunnerRoot -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force
    Expand-Archive -LiteralPath $zip -DestinationPath $RunnerRoot -Force
    Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue

    Write-Step "Registering interactive agent-os-gui runner"

    $registration = Invoke-GhJson -Arguments @("api", "--method", "POST", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/actions/runners/registration-token")

    Push-Location $RunnerRoot
    try {
        & .\config.cmd --url "https://github.com/$Repository" --token $registration.token --name $RunnerName --labels "agent-os-gui" --unattended --replace
        if ($LASTEXITCODE -ne 0) { throw "Runner registration failed." }
    }
    finally { Pop-Location }

    Write-Step "Configuring interactive startup"

    $startup = [Environment]::GetFolderPath("Startup")
    $shortcutPath = Join-Path $startup "Agent OS GUI Runner.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $runCmd = Join-Path $RunnerRoot "run.cmd"
    $shortcut.TargetPath = $env:ComSpec
    $shortcut.Arguments = '/c "' + $runCmd + '"'
    $shortcut.WorkingDirectory = $RunnerRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Interactive GitHub Actions runner for Agent OS Windows GUI qualification"
    $shortcut.Save()

    $runnerProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @('/c', ('"' + $runCmd + '"')) -WorkingDirectory $RunnerRoot -WindowStyle Minimized -PassThru

    Write-Step "Waiting for runner to become online"

    $online = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        Start-Sleep -Seconds 2
        $runners = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository/actions/runners?per_page=100")
        $match = @($runners.runners) | Where-Object { $_.name -eq $RunnerName } | Select-Object -First 1

        if ($match -and $match.status -eq "online") {
            $labels = @($match.labels | ForEach-Object { $_.name })
            if ($labels -contains "self-hosted" -and $labels -contains "Windows" -and $labels -contains "X64" -and $labels -contains "agent-os-gui") {
                $online = $true
                break
            }
        }

        if ($runnerProcess.HasExited) { throw "Runner exited before becoming online." }
    }

    if (-not $online) { throw "Runner did not become online with all required labels." }
    Write-Host "Interactive runner $RunnerName is online in Windows session $sessionId." -ForegroundColor Green
}

Ensure-Gh
Ensure-GhAuthentication

$repoInfo = Invoke-GhJson -Arguments @("api", "-H", "Accept: application/vnd.github+json", "-H", "X-GitHub-Api-Version: 2026-03-10", "repos/$Repository")
if ($repoInfo.full_name -ne $Repository) { throw "Could not verify repository $Repository." }

Set-BranchProtection
Set-ReleaseTagRuleset
Set-SigningSecrets
Install-InteractiveRunner

Write-Step "Release infrastructure ready"
Write-Host "Next command:"
Write-Host ".\scripts\agent_os_release_publish.ps1 -Version 1.0.0" -ForegroundColor Green
