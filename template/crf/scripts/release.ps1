[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$CliArguments
)

$ErrorActionPreference = 'Stop'
$rendererRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$stateRoot = Join-Path $rendererRoot 'output\release-state'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$statePath = Join-Path $stateRoot (([guid]::NewGuid().ToString('N')) + '.json')
$evidencePath = $statePath + '.smoke.json'
$state = $null
$exitCode = 0

$environmentNames = @(
    'AIRWAYAI_CRF_SCHEMA_PATH',
    'AIRWAYAI_OUT_DIR',
    'AIRWAYAI_PREVIEW_PORT',
    'AIRWAYAI_RELEASE_SMOKE'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    & node (Join-Path $PSScriptRoot 'build-release.mjs') @CliArguments '--state' $statePath
    if ($LASTEXITCODE -ne 0) { throw "Release prepare failed with exit code $LASTEXITCODE." }

    $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $env:AIRWAYAI_CRF_SCHEMA_PATH = $state.schemaPath
    $env:AIRWAYAI_OUT_DIR = $state.siteRoot
    $env:AIRWAYAI_PREVIEW_PORT = [string]$state.smokePort
    $env:AIRWAYAI_RELEASE_SMOKE = '1'

    $playwrightCli = Join-Path $rendererRoot 'node_modules\@playwright\test\cli.js'
    & node $playwrightCli test 'e2e/release.spec.ts' '--workers=1' '--reporter=line'
    if ($LASTEXITCODE -ne 0) { throw "Release browser smoke failed with exit code $LASTEXITCODE." }

    $evidence = [ordered]@{
        nonce = $state.nonce
        passed = $true
        testedAt = (Get-Date).ToUniversalTime().ToString('o')
        browsers = @('chromium', 'firefox', 'webkit')
    }
    $evidenceJson = ($evidence | ConvertTo-Json -Depth 4) + [Environment]::NewLine
    [System.IO.File]::WriteAllText($evidencePath, $evidenceJson, (New-Object System.Text.UTF8Encoding($false)))

    & node (Join-Path $PSScriptRoot 'finalize-release.mjs') '--state' $statePath
    if ($LASTEXITCODE -ne 0) { throw "Release finalize failed with exit code $LASTEXITCODE." }
} catch {
    Write-Error $_
    $exitCode = 1
} finally {
    foreach ($name in $environmentNames) {
        $value = $previousEnvironment[$name]
        if ($null -eq $value) {
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        } else {
            [Environment]::SetEnvironmentVariable($name, $value, 'Process')
        }
    }

    if ($null -ne $state) {
        $stagingBase = [System.IO.Path]::GetFullPath((Join-Path $rendererRoot 'output\release-staging'))
        $stagingPath = [System.IO.Path]::GetFullPath([string]$state.stagingRoot)
        if ($stagingPath.StartsWith($stagingBase, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $evidencePath -Force -ErrorAction SilentlyContinue
}

exit $exitCode
