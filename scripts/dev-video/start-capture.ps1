$ErrorActionPreference = 'Stop'
if (Get-NetTCPConnection -LocalPort 5199 -State Listen -ErrorAction SilentlyContinue) { throw 'Capture port 5199 is already in use; no database was created.' }
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Push-Location $projectRoot
$database = 'formplatform_capture_' + [Guid]::NewGuid().ToString('N')
$release = Get-ChildItem -LiteralPath (Join-Path $projectRoot '.platform-data/releases') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'release-manifest.json') } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $release) { throw 'MVP package missing' }
docker compose -f compose.platform.yml exec -T postgres createdb -U formplatform $database
if ($LASTEXITCODE -ne 0) { throw 'Capture database creation failed' }
$out = Join-Path $projectRoot 'output/video/dev-20261029'
@{ database = $database; release = $release.Name; baseUrl = 'http://127.0.0.1:5199'; createdAt = [DateTimeOffset]::UtcNow } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'capture-env.json') -Encoding UTF8
$previousEnvironment = $env:ASPNETCORE_ENVIRONMENT
$previousIdentity = $env:Platform__DevelopmentIdentity
$previousConnection = $env:ConnectionStrings__Platform
try {
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:Platform__DevelopmentIdentity = 'true'
    $env:ConnectionStrings__Platform = "Host=127.0.0.1;Port=25432;Database=$database;Username=formplatform;Password=local-development-only"
    Push-Location $release.FullName
    & dotnet ./FormPlatform.Api.dll --urls http://127.0.0.1:5199
} finally {
    Pop-Location
    $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment
    $env:Platform__DevelopmentIdentity = $previousIdentity
    $env:ConnectionStrings__Platform = $previousConnection
    Pop-Location
}
