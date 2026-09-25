$ErrorActionPreference = "Stop"

$files = @(
    "scripts/agent_os_release_setup.ps1",
    "scripts/agent_os_release_publish.ps1"
)

$failed = $false

foreach ($file in $files) {
    $resolved = (Resolve-Path -LiteralPath $file).Path
    $tokens = $null
    $errors = $null

    [System.Management.Automation.Language.Parser]::ParseFile(
        $resolved,
        [ref]$tokens,
        [ref]$errors
    ) | Out-Null

    if ($errors.Count -gt 0) {
        $failed = $true
        Write-Host ""
        Write-Host ("PowerShell parse errors in " + $file + ":") -ForegroundColor Red
        foreach ($parseError in $errors) {
            Write-Host (
                "  line " + $parseError.Extent.StartLineNumber +
                ", column " + $parseError.Extent.StartColumnNumber +
                ": " + $parseError.Message
            ) -ForegroundColor Red
        }
    }
}

if ($failed) {
    exit 1
}

Write-Host "Agent OS release operator scripts parse successfully."
