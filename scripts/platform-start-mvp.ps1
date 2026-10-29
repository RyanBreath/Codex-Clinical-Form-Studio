param([ValidateRange(1024,65535)][int]$Port = 5198)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$releases = Join-Path $projectRoot '.platform-data/releases'
$release = Get-ChildItem -LiteralPath $releases -Directory | Where-Object { $_.Name -match '^\d{8}-\d{6}-[a-f0-9]{8}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'release-manifest.json')) } | Sort-Object Name -Descending | Select-Object -First 1
if (-not $release) { throw '尚無本機發行包，請先執行 scripts/platform-package.ps1。' }
$previousEnvironment = $env:ASPNETCORE_ENVIRONMENT
$previousIdentity = $env:Platform__DevelopmentIdentity
try {
    $env:ASPNETCORE_ENVIRONMENT = 'Development'
    $env:Platform__DevelopmentIdentity = 'true'
    Push-Location $release.FullName
    Write-Output "本機合成資料 MVP：http://127.0.0.1:$Port/platform.html"
    Write-Output '此啟動方式僅供本機試跑。正式資料須另建部署設定並完成上線驗收。'
    & dotnet ./FormPlatform.Api.dll --urls "http://127.0.0.1:$Port"
    if ($LASTEXITCODE -ne 0) { throw 'MVP 程序已異常結束。' }
} finally {
    Pop-Location
    $env:ASPNETCORE_ENVIRONMENT = $previousEnvironment
    $env:Platform__DevelopmentIdentity = $previousIdentity
}
