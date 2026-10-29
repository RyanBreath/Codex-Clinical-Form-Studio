param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
$suffix = [Guid]::NewGuid().ToString('N')
$testDatabase = "formplatform_restore_$suffix"
$containerFile = "/tmp/formplatform-$suffix.dump"
$composeArgs = @('compose','-f','compose.platform.yml','exec','-T','postgres')
function Run-DatabaseTool([string[]]$Arguments) {
    & docker @composeArgs @Arguments
    if ($LASTEXITCODE -ne 0) { throw "資料庫演練工具失敗：$($Arguments[0])" }
}
try {
    $directory = Join-Path $projectRoot '.platform-data/backups'
    $null = New-Item -ItemType Directory -Path $directory -Force
    $dump = Join-Path $directory "$suffix.dump"
    Run-DatabaseTool -Arguments @('pg_dump','-U','formplatform','-d','formplatform','-Fc','-f',$containerFile)
    & docker compose -f compose.platform.yml cp "postgres:$containerFile" $dump
    if ($LASTEXITCODE -ne 0) { throw '無法取出本機備份。' }
    Run-DatabaseTool -Arguments @('createdb','-U','formplatform',$testDatabase)
    Run-DatabaseTool -Arguments @('pg_restore','-U','formplatform','-d',$testDatabase,'--exit-on-error','--no-owner',$containerFile)
    $probe = 'SELECT json_build_object(''responses'',(SELECT count(*) FROM "Responses"),''versions'',(SELECT count(*) FROM "Versions"),''icfs'',(SELECT count(*) FROM "Icfs"),''audit'',(SELECT count(*) FROM "Audit"),''migrations'',(SELECT count(*) FROM "__EFMigrationsHistory"));'
    $counts = $probe | & docker @composeArgs psql -U formplatform -d $testDatabase -At -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw '還原資料驗證失敗。' }
    @{ restoredAt = [DateTimeOffset]::UtcNow; database = $testDatabase; backupSha256 = (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash; restoredCounts = ($counts | ConvertFrom-Json); status = 'restored-and-queried-local-copy'; scope = 'database-only-no-attachment-or-identity-backup' } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $directory "$suffix.report.json") -Encoding utf8
    Write-Output "本機備份與還原查核完成：$directory/$suffix.report.json"
} finally {
    if ($testDatabase -match '^formplatform_restore_[a-f0-9]{32}$') { & docker @composeArgs dropdb -U formplatform --if-exists $testDatabase }
    if ($containerFile -match '^/tmp/formplatform-[a-f0-9]{32}\.dump$') { & docker @composeArgs rm -- $containerFile }
    Pop-Location
}
