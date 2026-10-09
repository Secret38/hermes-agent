[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'Check', 'Repair')][string]$Mode = 'Prepare',
    [string]$PackageDir = $PSScriptRoot,
    [string]$HermesHome = $(if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }),
    [switch]$StartInstaller
)

$ErrorActionPreference = 'Stop'

function Get-TestCandidate([string]$Directory) {
    $metadata = Get-Content -LiteralPath (Join-Path $Directory 'build-metadata.json') -Raw | ConvertFrom-Json
    if ($metadata.repository -ne 'Secret38/hermes-agent' -or $metadata.commit -notmatch '^[a-f0-9]{40}$' -or $metadata.sha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Das Paket hat keine gueltige Kandidatenidentitaet.'
    }
    $exe = Join-Path $Directory 'Hermes-Setup.exe'
    if ((Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.sha256) {
        throw 'Die Installer-Pruefsumme stimmt nicht. Paket erneut herunterladen; Installer nicht starten.'
    }
    return $metadata
}

function Prepare-TestWorkspace([string]$Directory, [string]$TestHome, [switch]$Launch) {
    $candidate = Get-TestCandidate $Directory
    $root = Join-Path $TestHome 'hermes-agent'
    if (Test-Path -LiteralPath $root) {
        throw 'Eine Hermes-Installation besteht bereits. Nutze einen neuen Windows-Testbenutzer oder eine VM. STATUS.cmd kann die bestehende Installation pruefen.'
    }
    $workspace = Join-Path $Directory 'Arbeitsordner'
    New-Item -ItemType Directory -Path $workspace -Force | Out-Null
    @"
TEST 1 - Datei
Erstelle ausschliesslich im Ordner "$workspace" eine Datei test-ergebnis.txt mit dem Inhalt "Mein erster Agent-OS-Test". Lies die Datei anschliessend erneut und pruefe den genauen Inhalt.

TEST 2 - Plan aendern
Erstelle im Ordner "$workspace" eine Datei plan-test.txt mit dem Inhalt "Version A" und pruefe den Inhalt. Vor der Freigabe im Planeditor den Inhalt der Schreibaktion UND die erwartete Inhaltspruefung auf "Version B" aendern.

TEST 3 - Browser
Oeffne https://example.com im Browser, lies die sichtbare Ueberschrift und ueberpruefe sie. Keine Formulare absenden und keine Konten verwenden.

TEST 4 - Windows
Oeffne Windows Notepad und schreibe "Agent OS Computer-Test" in ein neues Dokument. Pruefe den sichtbaren Text. Noch nicht speichern und keine vorhandenen Dokumente schliessen.

TEST 5 - Ablehnung
Plane im Ordner "$workspace" die Datei abgelehnt.txt mit dem Inhalt "Darf nicht geschrieben werden". Den gesamten Plan verwerfen. Die Datei darf danach nicht existieren.
"@ | Set-Content -LiteralPath (Join-Path $workspace 'Testaufgaben.txt') -Encoding UTF8
    Write-Host "Pruefsumme bestaetigt. Testordner: $workspace"
    Write-Host "Kandidat: $($candidate.commit)"
    if ($Launch) {
        $env:HERMES_HOME = $TestHome
        Start-Process -FilePath (Join-Path $Directory 'Hermes-Setup.exe')
    }
}

function Get-TestDiagnostic([string]$Directory, [string]$TestHome) {
    $reportPath = Join-Path $Directory 'Testdiagnose.json'
    if (Test-Path -LiteralPath $reportPath) { Remove-Item -LiteralPath $reportPath -Force }
    $candidate = Get-TestCandidate $Directory
    $root = Join-Path $TestHome 'hermes-agent'
    $marker = Get-Content -LiteralPath (Join-Path $root '.hermes-bootstrap-complete') -Raw | ConvertFrom-Json
    if ($marker.pinnedCommit -ne $candidate.commit) {
        throw 'Die installierte Version passt nicht zu diesem Testpaket. Keine Testfreigabe fuer diesen Stand.'
    }
    $env:HERMES_HOME = $TestHome
    . (Join-Path $root 'scripts/desktop-update/runtime.ps1')
    $command = @(Get-HermesRuntimeCommand -InstallRoot $root)
    $prefix = @()
    if ($command.Count -gt 1) { $prefix = @($command[1..($command.Count - 1)]) }
    Push-Location $root
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $command[0] @prefix agent-os status --require-full --require-production-security --json 2>$null
        $statusExit = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        $health = ($output -join "`n") | ConvertFrom-Json
    } finally { Pop-Location }
    # Export readiness only. Do not collect .env, config, chats or raw logs.
    $report = [ordered]@{
        checked_at = (Get-Date).ToUniversalTime().ToString('o')
        expected_commit = $candidate.commit
        installed_commit = $marker.pinnedCommit
        status_exit = $statusExit
        full_ready = ($health.full_ready -eq $true)
        production_security_ready = ($health.production_security_ready -eq $true)
        checks = @($health.checks | ForEach-Object { [ordered]@{ name = $_.name; status = $_.status } })
        user_end_to_end_passed = $null
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $Directory 'Testdiagnose.json') -Encoding UTF8
    if ($statusExit -ne 0 -or -not $report.full_ready -or -not $report.production_security_ready) {
        throw 'Laufzeit noch nicht bereit. Testdiagnose.json ansehen; bei Bedarf REPARIEREN.cmd starten.'
    }
    Write-Host 'Laufzeit und Sicherheitskonfiguration sind bereit. Die Nutzertests bleiben separat zu pruefen.'
}

function Repair-TestInstallation([string]$Directory, [string]$TestHome) {
    $candidate = Get-TestCandidate $Directory
    $root = Join-Path $TestHome 'hermes-agent'
    $markerPath = Join-Path $root '.hermes-bootstrap-complete'
    if (Test-Path -LiteralPath $markerPath) {
        $marker = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
        if ($marker.pinnedCommit -ne $candidate.commit) { throw 'Eine andere Hermes-Version ist installiert. Reparatur mit diesem Testpaket wird verweigert.' }
    }
    $script = Join-Path $root 'scripts/install.ps1'
    if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw 'Installationsskript fehlt. Installer erneut starten.' }
    $env:HERMES_HOME = $TestHome
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Repository $candidate.repository -Branch $candidate.branch -Commit $candidate.commit -HermesHome $TestHome -InstallDir $root -IncludeDesktop -NonInteractive -Json
    if ($LASTEXITCODE -ne 0) { throw 'Reparatur fehlgeschlagen. Im Installer Open logs verwenden.' }
    Get-TestDiagnostic $Directory $TestHome
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        switch ($Mode) {
            'Prepare' { Prepare-TestWorkspace $PackageDir $HermesHome -Launch:$StartInstaller }
            'Check' { Get-TestDiagnostic $PackageDir $HermesHome }
            'Repair' { Repair-TestInstallation $PackageDir $HermesHome }
        }
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}
