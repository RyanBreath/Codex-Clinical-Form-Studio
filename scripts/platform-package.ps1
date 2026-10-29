param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    npm --prefix template/crf run check
    if ($LASTEXITCODE -ne 0) { throw '前端檢查失敗。' }
    npm --prefix template/crf run platform:build
    if ($LASTEXITCODE -ne 0) { throw '前端建置失敗。' }
    $release = Join-Path $projectRoot ('.platform-data/releases/' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
    dotnet publish backend/FormPlatform.Api -c Release -o $release
    if ($LASTEXITCODE -ne 0) { throw 'API 發行失敗。' }
    $frontend = [IO.Path]::GetFullPath((Join-Path $projectRoot 'template/crf/dist-platform'))
    $manifest = Get-Content (Join-Path $frontend '.vite/manifest.json') -Raw | ConvertFrom-Json -AsHashtable
    $files = @('platform.html')
    foreach ($entry in $manifest.Values) { $files += $entry.file; $files += $entry.css; $files += $entry.assets }
    foreach ($file in ($files | Where-Object { $_ } | Sort-Object -Unique)) {
        $source = [IO.Path]::GetFullPath((Join-Path $frontend $file))
        if (-not $source.StartsWith($frontend + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '發行資產路徑超出建置目錄。' }
        $destination = Join-Path (Join-Path $release 'wwwroot') $file
        $null = New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force
        Copy-Item -LiteralPath $source -Destination $destination
    }
    $hashes = Get-ChildItem -LiteralPath $release -File -Recurse | ForEach-Object {
        @{ file = [IO.Path]::GetRelativePath($release, $_.FullName); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    }
    @{ createdAt = [DateTimeOffset]::UtcNow; files = @($hashes); status = 'local-mvp-package-not-deployed' } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $release 'release-manifest.json') -Encoding utf8
    Write-Output "本機 MVP 發行包：$release"
    Write-Output '尚未部署。正式啟動須設定資料庫、OIDC、HTTPS、金鑰保存及嵌入來源。'
} finally { Pop-Location }
