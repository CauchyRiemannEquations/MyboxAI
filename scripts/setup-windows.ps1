# Portable Node is downloaded into this checkout only. No administrator or PATH change.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$SetupArguments)
$ErrorActionPreference = 'Stop'
$workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$nodeRelease = '24.15.0'
function Test-SupportedNode([string]$Executable) {
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) { return $false }
    try {
        $reportedVersion = & $Executable --version 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        $parsedVersion = [version]($reportedVersion.Trim().TrimStart('v'))
        # Use a runtime with OS trust-store APIs; otherwise use the portable LTS.
        return (($parsedVersion -ge [version]'22.19.0' -and $parsedVersion.Major -eq 22) -or $parsedVersion -ge [version]'24.5.0')
    } catch { return $false }
}
try {
    $nodeExecutable = $null
    $installedNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($installedNode -and (Test-SupportedNode $installedNode.Source)) { $nodeExecutable = $installedNode.Source }
    if (-not $nodeExecutable) {
        $machineArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
        $nodeArchitecture = switch ($machineArchitecture) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw 'Windows x64 or ARM64 is required.' } }
        $runtimeDirectory = Join-Path $workspaceRoot '.mybox-runtime'
        $nodeFolder = "node-v$nodeRelease-win-$nodeArchitecture"
        $nodeExecutable = Join-Path $runtimeDirectory "$nodeFolder\node.exe"
        if (-not (Test-SupportedNode $nodeExecutable)) {
            Write-Host 'Downloading portable Node.js for MyboxAI. No administrator access is needed.'
            New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $archiveName = "$nodeFolder.zip"
            $archivePath = Join-Path $runtimeDirectory $archiveName
            $releaseUrl = "https://nodejs.org/dist/v$nodeRelease"
            Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$archiveName" -OutFile $archivePath
            $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHASUMS256.txt").Content
            $expectedHash = [regex]::Match($checksums, "(?m)^([a-f0-9]{64})\s+$([regex]::Escape($archiveName))\r?$").Groups[1].Value
            if (-not $expectedHash -or (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Node.js download checksum failed. Run the installer again.' }
            Expand-Archive -LiteralPath $archivePath -DestinationPath $runtimeDirectory -Force
            Remove-Item -LiteralPath $archivePath
            if (-not (Test-SupportedNode $nodeExecutable)) { throw 'Portable Node.js could not start.' }
        }
    }
    # npm install scripts also need to resolve node from this portable directory.
    $env:PATH = (Split-Path -Parent $nodeExecutable) + ';' + $env:PATH
    & $nodeExecutable (Join-Path $workspaceRoot 'scripts\setup-mybox.mjs') @SetupArguments
    exit $LASTEXITCODE
} catch {
    Write-Host 'MyboxAI setup failed. Check your network and folder write permission.' -ForegroundColor Red
    # Do not print arbitrary child output or secret-bearing exception details.
    exit 1
}
