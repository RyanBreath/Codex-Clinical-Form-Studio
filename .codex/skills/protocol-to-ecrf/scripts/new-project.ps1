[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot,

    [Parameter(Mandatory = $true)]
    [string]$ProtocolPath,

    [Parameter(Mandatory = $false)]
    [string]$ProjectId
)

$ErrorActionPreference = 'Stop'

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$protocol = (Resolve-Path -LiteralPath $ProtocolPath).Path

if (-not (Test-Path -LiteralPath $protocol -PathType Leaf)) {
    throw "ProtocolPath must point to a file: $protocol"
}

$supportedExtensions = @('.pdf', '.docx', '.md', '.txt')
$extension = [System.IO.Path]::GetExtension($protocol).ToLowerInvariant()
if ($extension -notin $supportedExtensions) {
    throw "Unsupported protocol format: $extension. Supported: PDF, DOCX, Markdown, TXT."
}

if ([string]::IsNullOrWhiteSpace($ProjectId)) {
    $ProjectId = 'prj_' + (Get-Date -Format 'yyyyMMdd-HHmm')
}
if ($ProjectId -notmatch '^prj_\d{8}-\d{4}$') {
    throw 'ProjectId must match prj_yyyyMMdd-HHmm.'
}

$projectsRoot = Join-Path $repository '2.SA\projects'
$projectRoot = Join-Path $projectsRoot $ProjectId
if (Test-Path -LiteralPath $projectRoot) {
    throw "Project directory already exists; immutable work packages cannot be overwritten: $projectRoot"
}

$sourceDirectory = Join-Path $projectRoot 'source'
$analysisDirectory = Join-Path $projectRoot 'analysis'
$formsDirectory = Join-Path $projectRoot 'forms'
$releasesDirectory = Join-Path $projectRoot 'releases'

@($sourceDirectory, $analysisDirectory, $formsDirectory, $releasesDirectory) |
    ForEach-Object { New-Item -ItemType Directory -Path $_ -Force | Out-Null }

$destination = Join-Path $sourceDirectory ([System.IO.Path]::GetFileName($protocol))
Copy-Item -LiteralPath $protocol -Destination $destination

$sourceFile = Get-Item -LiteralPath $destination
$manifest = [ordered]@{
    projectId = $ProjectId
    sourceFileName = $sourceFile.Name
    extension = $sourceFile.Extension.ToLowerInvariant()
    sizeBytes = $sourceFile.Length
    sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    copiedAt = (Get-Date).ToUniversalTime().ToString('o')
}

$manifestPath = Join-Path $sourceDirectory 'source-manifest.json'
$manifestJson = ($manifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine
[System.IO.File]::WriteAllText(
    $manifestPath,
    $manifestJson,
    (New-Object System.Text.UTF8Encoding($false))
)

[pscustomobject]@{
    projectId = $ProjectId
    projectRoot = $projectRoot
    copiedProtocol = $destination
    manifest = $manifestPath
} | ConvertTo-Json -Depth 4
