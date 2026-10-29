$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$out = Join-Path $projectRoot 'output/video/mvp-20261029'
$composition = Get-Content -LiteralPath (Join-Path $out 'composition.json') -Raw | ConvertFrom-Json
Push-Location $out
try {
    # Each render uses a fresh output name; no recursive deletion of shared folders.
    $logFile = Join-Path $out 'render.log'
    & npx --yes hyperframes@0.8.150 render -c MVP1.html --fps 30 --quality standard --video-frame-format png --workers 2 -o $composition.filename *> $logFile
    $log = Get-Content -LiteralPath $logFile -Raw
    if ($log -notmatch 'artifact validated') { throw 'HyperFrames did not validate the video artifact. See render.log.' }
    Write-Output ('Artifact validated: ' + (Join-Path $out $composition.filename))
} finally { Pop-Location }
