[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [Parameter(Mandatory = $true)]
    [string]$NodeExe,

    [Parameter(Mandatory = $true)]
    [string]$NodeModules,

    [string]$PrjId,

    [ValidateRange(1, 500)]
    [int]$MaxCases,

    [string]$OutputRoot = "output/yaml-qa"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-ExistingPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label does not exist: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

$resolvedSource = Resolve-ExistingPath -Path $Source -Label "Source"
$extension = [System.IO.Path]::GetExtension($resolvedSource).ToLowerInvariant()
if ($extension -notin @(".yaml", ".yml")) {
    throw "Source must use the .yaml or .yml extension: $resolvedSource"
}

$resolvedNode = Resolve-ExistingPath -Path $NodeExe -Label "NodeExe"
$resolvedModules = Resolve-ExistingPath -Path $NodeModules -Label "NodeModules"
if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
    $resolvedOutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
}
else {
    $resolvedOutputRoot = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $OutputRoot))
}
$scriptPath = Join-Path $PSScriptRoot "yaml-qa.mjs"

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$workingDirectory = [System.IO.Path]::GetFullPath((Join-Path $tempRoot ("codex-test-yaml-forms-" + [Guid]::NewGuid().ToString("N"))))
if (-not $workingDirectory.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Temporary working directory is outside the system temp directory: $workingDirectory"
}

New-Item -ItemType Directory -Path $workingDirectory | Out-Null
New-Item -ItemType Junction -Path (Join-Path $workingDirectory "node_modules") -Target $resolvedModules | Out-Null

$arguments = @(
    $scriptPath,
    "--source", $resolvedSource,
    "--output-root", $resolvedOutputRoot
)
if ($PrjId) {
    $arguments += @("--prj-id", $PrjId)
}
if ($PSBoundParameters.ContainsKey("MaxCases")) {
    $arguments += @("--max-cases", [string]$MaxCases)
}

$previousLocation = (Get-Location).Path
try {
    Set-Location -LiteralPath $workingDirectory
    & $resolvedNode @arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "YAML form QA runner failed with Node.js exit code: $exitCode"
    }
}
finally {
    Set-Location -LiteralPath $previousLocation
    $resolvedWorking = [System.IO.Path]::GetFullPath($workingDirectory)
    if ($resolvedWorking.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedWorking)) {
        Remove-Item -LiteralPath $resolvedWorking -Recurse -Force
    }
}
