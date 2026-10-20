[CmdletBinding()]
param(
    [ValidateSet('Prepare', 'Check', 'Repair', 'Continue')][string]$Mode = 'Prepare',
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


function Set-TestEnvironment([string]$TestHome) {
    $env:HERMES_HOME = $TestHome
    $env:HERMES_DESKTOP_USER_DATA_DIR = Join-Path $TestHome 'desktop-data'
    $env:HERMES_RUNTIME_DIR = Join-Path $TestHome 'runtime'
}

function Resolve-TestHome([string]$Directory, [string]$Fallback) {
    $recordPath = Join-Path $Directory 'Testinstallation.json'
    if (-not (Test-Path -LiteralPath $recordPath)) { return $Fallback }
    $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
    $candidate = Get-TestCandidate $Directory
    if ($record.commit -ne $candidate.commit -or -not [IO.Path]::IsPathRooted($record.home)) {
        throw 'Die gespeicherte Installation passt nicht zu diesem Paket.'
    }
    $instance = Get-Content -LiteralPath (Join-Path $record.home 'agent-os-instance.json') -Raw | ConvertFrom-Json
    if ($record.instance_id -notmatch '^[a-f0-9]{32}$' -or $instance.id -ne $record.instance_id) {
        throw 'Der gespeicherte Installationsordner konnte nicht bestaetigt werden.'
    }
    return $record.home
}

function Assert-EmptyTestHome([string]$Target, [string[]]$ProtectedHomes) {
    if (-not [IO.Path]::IsPathRooted($Target) -or $Target.StartsWith('\\')) {
        throw 'Bitte einen absoluten lokalen Ordner waehlen.'
    }
    $full = [IO.Path]::GetFullPath($Target).TrimEnd('\')
    if ($full -eq [IO.Path]::GetPathRoot($full).TrimEnd('\') -or (Split-Path (Split-Path $full -Parent) -Leaf) -eq 'profiles') {
        throw 'Bitte einen eigenen Unterordner ausserhalb bestehender Hermes-Profile waehlen.'
    }
    $ancestor = $full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw 'Der Pfad darf keine Dateien, Verknuepfungen oder Junctions enthalten.'
            }
        }
        $ancestor = Split-Path $ancestor -Parent
    }
    foreach ($home in $ProtectedHomes) {
        if (-not $home) { continue }
        $protected = [IO.Path]::GetFullPath($home).TrimEnd('\')
        if ($full.Equals($protected, [StringComparison]::OrdinalIgnoreCase) -or
            $full.StartsWith($protected + '\', [StringComparison]::OrdinalIgnoreCase) -or
            $protected.StartsWith($full + '\', [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Der Ordner muss getrennt von deiner bestehenden Hermes-Installation liegen.'
        }
    }
    if ((Test-Path -LiteralPath $full) -and @(Get-ChildItem -LiteralPath $full -Force).Count -gt 0) {
        throw 'Dieser Ordner ist belegt. Bitte einen neuen, leeren zweiten Ordner waehlen.'
    }
    return $full
}

function Select-TestHome([string]$DefaultHome) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Agent OS separat installieren: neuen, leeren Ordner waehlen (z.B. hermes-agent-os-test).'
    $dialog.SelectedPath = Split-Path $DefaultHome -Parent
    $dialog.ShowNewFolderButton = $true
    try {
        if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { throw 'Installation abgebrochen.' }
        return $dialog.SelectedPath
    } finally { $dialog.Dispose() }
}

function Prepare-TestWorkspace([string]$Directory, [string]$TestHome, [switch]$Launch) {
    $candidate = Get-TestCandidate $Directory
    $recordPath = Join-Path $Directory 'Testinstallation.json'
    if (Test-Path -LiteralPath $recordPath) {
        throw 'Dieses Paket ist bereits zugeordnet. INSTALLATION-FORTSETZEN.cmd, STATUS.cmd oder REPARIEREN.cmd verwenden. Fuer eine weitere Installation das ZIP neu entpacken.'
    }
    $protected = @((Join-Path $env:LOCALAPPDATA 'hermes'), (Join-Path $env:USERPROFILE '.hermes'))
    if ($Launch) {
        $protected += $TestHome
        $TestHome = Select-TestHome $TestHome
    }
    $TestHome = Assert-EmptyTestHome $TestHome $protected
    New-Item -ItemType Directory -Path $TestHome -Force | Out-Null
    $instanceId = [guid]::NewGuid().ToString('N')
    @{id=$instanceId; home=$TestHome; commit=$candidate.commit} | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $TestHome 'agent-os-instance.json') -Encoding UTF8
    @{home=$TestHome; commit=$candidate.commit; instance_id=$instanceId} | ConvertTo-Json |
        Set-Content -LiteralPath $recordPath -Encoding UTF8
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
        Set-TestEnvironment $TestHome
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
    Set-TestEnvironment $TestHome
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
        installation_home = $TestHome
        desktop_data = (Join-Path $TestHome 'desktop-data')
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
    Set-TestEnvironment $TestHome
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Repository $candidate.repository -Branch $candidate.branch -Commit $candidate.commit -HermesHome $TestHome -InstallDir $root -IncludeDesktop -NonInteractive -Json
    if ($LASTEXITCODE -ne 0) { throw 'Reparatur fehlgeschlagen. Im Installer Open logs verwenden.' }
    Get-TestDiagnostic $Directory $TestHome
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($Mode -ne 'Prepare') { $HermesHome = Resolve-TestHome $PackageDir $HermesHome }
        switch ($Mode) {
            'Prepare' { Prepare-TestWorkspace $PackageDir $HermesHome -Launch:$StartInstaller }
            'Continue' {
                if (-not (Test-Path -LiteralPath (Join-Path $PackageDir 'Testinstallation.json'))) { throw 'Zuerst START-TEST.cmd ausfuehren.' }
                $null = Get-TestCandidate $PackageDir
                Set-TestEnvironment $HermesHome
                Start-Process -FilePath (Join-Path $PackageDir 'Hermes-Setup.exe')
            }
            'Check' { Get-TestDiagnostic $PackageDir $HermesHome }
            'Repair' { Repair-TestInstallation $PackageDir $HermesHome }
        }
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}
