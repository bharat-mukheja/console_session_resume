# Profiles run normally before this startup command. PSReadLine has not yet read
# interactive input, so select the terminal's history before its first ReadLine.
try {
    Import-Module PSReadLine -ErrorAction Stop
    if ($env:CSR_INTEGRATION_SCRIPT -and (Test-Path -LiteralPath $env:CSR_INTEGRATION_SCRIPT)) {
        . $env:CSR_INTEGRATION_SCRIPT
    }
    # VS Code can replace PSReadLine for accessibility support. Configure the final
    # loaded instance, after shell integration has performed that replacement.
    Set-PSReadLineOption -HistorySavePath $env:CSR_HISTORY_FILE `
        -HistorySaveStyle SaveIncrementally -MaximumHistoryCount ([int]$env:CSR_HISTORY_SIZE)
    try {
        $csrStarted = if ($env:OS -eq 'Windows_NT') {
            [Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString()
        } else {
            (& /bin/ps -p $PID -o lstart=).Trim()
        }
        [IO.File]::WriteAllText((Join-Path $env:CSR_SESSION_DIR 'process'), "$PID`n$csrStarted")
    } catch { # Process recognition is optional; history does not depend on it.
    }
} catch {
    Write-Error "Session Resume could not initialize PowerShell history: $_"
}
