$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$configurationPath = Join-Path $projectRoot 'output/video/mvp-20261029/capture-env.json'
$configuration = Get-Content -LiteralPath $configurationPath -Raw | ConvertFrom-Json
if ($configuration.baseUrl -ne 'http://127.0.0.1:5199' -or $configuration.database -notmatch '^formplatform_capture_[a-f0-9]{32}$') { throw 'Capture cleanup guard failed' }
if (Get-NetTCPConnection -LocalPort 5199 -State Listen -ErrorAction SilentlyContinue) { throw 'Close the capture-only API process before cleanup.' }
Push-Location $projectRoot
try {
    docker compose -f compose.platform.yml exec -T postgres dropdb -U formplatform --if-exists $configuration.database
    if ($LASTEXITCODE -ne 0) { throw 'Could not remove capture-only database' }
    $query = "SELECT count(*) FROM pg_database WHERE datname = '$($configuration.database)';"
    $remaining = $query | docker compose -f compose.platform.yml exec -T postgres psql -U formplatform -d formplatform -At
    if ($LASTEXITCODE -ne 0 -or [int]$remaining -ne 0) { throw 'Capture database removal not verified' }
    $configuration | Add-Member -NotePropertyName cleanedAt -NotePropertyValue ([DateTimeOffset]::UtcNow.ToString('o')) -Force
    $configuration | Add-Member -NotePropertyName databaseRemoved -NotePropertyValue $true -Force
    $configuration | ConvertTo-Json | Set-Content -LiteralPath $configurationPath -Encoding UTF8
    Write-Output 'Capture-only database removed; original MVP database unchanged.'
} finally { Pop-Location }
