[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Source,

    [string]$Config,
    [string]$PrjId,
    [string]$OutputRoot,
    [int]$MaxCases = 0,
    [switch]$AllowSubmit,
    [switch]$Headed,
    [string]$NodeExe,
    [string]$NodeModules,
    [string]$PythonExe,
    [string]$NpxExe
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

$skillRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$sessionSuffix = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$probeSession = "html-form-probe-$sessionSuffix"
$runSession = "html-form-run-$sessionSuffix"
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) "test-html-forms-$timestamp-$sessionSuffix"
$runtimeDir = Join-Path $tempRoot "artifact-runtime"
$configJsonPath = Join-Path $tempRoot "qa-config.resolved.json"
$caseRunnerPath = Join-Path $tempRoot "execute-current-case.js"
$serverProcess = $null
$runDirectory = $null
$probeOpened = $false
$runOpened = $false

function Resolve-Executable {
    param([string]$Explicit, [string]$FallbackName)
    if ($Explicit) {
        if (-not (Test-Path -LiteralPath $Explicit -PathType Leaf)) {
            throw "Executable not found: $Explicit"
        }
        return (Resolve-Path -LiteralPath $Explicit).Path
    }
    $command = Get-Command $FallbackName -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required executable '$FallbackName' was not found."
    }
    return $command.Source
}

function Write-Utf8 {
    param([string]$Path, [string]$Text)
    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Write-Json {
    param([string]$Path, $Value)
    Write-Utf8 -Path $Path -Text (($Value | ConvertTo-Json -Depth 100) + [Environment]::NewLine)
}

function Convert-PwJson {
    param([string]$Text)
    $trimmed = $Text.Trim()
    $start = $trimmed.IndexOf("{")
    $end = $trimmed.LastIndexOf("}")
    if ($start -lt 0 -or $end -lt $start) {
        throw "Playwright CLI did not return JSON: $trimmed"
    }
    return ($trimmed.Substring($start, $end - $start + 1) | ConvertFrom-Json)
}

function Invoke-Pw {
    param(
        [string]$Session,
        [string[]]$Arguments,
        [switch]$IgnoreFailure
    )
    $allArguments = @("--yes", "--package", "@playwright/cli", "playwright-cli", "-s=$Session") +
        $Arguments +
        @("--json")
    $output = (& $script:NpxExe @allArguments 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0 -and -not $IgnoreFailure) {
        throw "Playwright CLI failed ($exitCode): $output"
    }
    try {
        return Convert-PwJson -Text $output
    }
    catch {
        if ($IgnoreFailure) {
            return [pscustomobject]@{
                isError = $true
                error = $_.Exception.Message
                raw = $output
            }
        }
        throw
    }
}

function Convert-ResultPayload {
    param($Response)
    $hasError = $Response.PSObject.Properties.Name -contains "isError"
    if ($hasError -and $Response.isError) {
        throw [string]$Response.error
    }
    if ($null -eq $Response.result) {
        throw "Playwright run-code returned no result."
    }
    if ($Response.result -is [string]) {
        return ($Response.result | ConvertFrom-Json)
    }
    return $Response.result
}

function Sanitize-Segment {
    param([string]$Value, [string]$Fallback = "unnamed")
    $clean = ($Value -replace '[<>:"/\\|?*\x00-\x1F]', "_") -replace '\s+', "_"
    $clean = $clean.Trim(".")
    if ($clean.Length -gt 100) {
        $clean = $clean.Substring(0, 100)
    }
    if ([string]::IsNullOrWhiteSpace($clean)) {
        return $Fallback
    }
    return $clean
}

function Resolve-OutputPath {
    param([string]$Value)
    if ([IO.Path]::IsPathRooted($Value)) {
        return [IO.Path]::GetFullPath($Value)
    }
    return [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Value))
}

function Start-LocalServer {
    param([string]$Directory, [string]$Python)
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()

    $stdout = Join-Path $tempRoot "local-server.stdout.log"
    $stderr = Join-Path $tempRoot "local-server.stderr.log"
    $arguments = @(
        "-m",
        "http.server",
        [string]$port,
        "--bind",
        "127.0.0.1",
        "--directory",
        "`"$Directory`""
    )
    $process = Start-Process -FilePath $Python `
        -ArgumentList $arguments `
        -WorkingDirectory $Directory `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
        if ($process.HasExited) {
            $errorText = if (Test-Path -LiteralPath $stderr) {
                Get-Content -Raw -LiteralPath $stderr
            }
            else {
                "No server error log."
            }
            throw "Local server exited unexpectedly: $errorText"
        }
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -UseBasicParsing -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        }
        catch {
            Start-Sleep -Milliseconds 100
        }
    }
    if (-not $ready) {
        throw "Local HTML server did not become ready."
    }
    return [pscustomobject]@{ Process = $process; Port = $port }
}

function Invoke-Workbook {
    param([string[]]$Arguments)
    Push-Location $runtimeDir
    try {
        $output = (& $script:NodeExe (Join-Path $PSScriptRoot "workbook.mjs") @Arguments 2>&1 | Out-String)
        if ($LASTEXITCODE -ne 0) {
            throw "Workbook builder failed: $output"
        }
        return $output
    }
    finally {
        Pop-Location
    }
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

try {
    $script:NodeExe = Resolve-Executable -Explicit $NodeExe -FallbackName "node"
    $script:NpxExe = Resolve-Executable -Explicit $NpxExe -FallbackName "npx"
    if (-not $NodeModules) {
        throw "NodeModules is required. Call load_workspace_dependencies and pass the bundled Node.js packages path."
    }
    if (-not (Test-Path -LiteralPath $NodeModules -PathType Container)) {
        throw "NodeModules directory not found: $NodeModules"
    }
    $resolvedNodeModules = (Resolve-Path -LiteralPath $NodeModules).Path

    if ($Config) {
        $resolvedConfigPath = (Resolve-Path -LiteralPath $Config -ErrorAction Stop).Path
        & $script:NodeExe (Join-Path $PSScriptRoot "parse-config.mjs") `
            --input $resolvedConfigPath `
            --output $configJsonPath | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to parse qa-config.yaml."
        }
    }
    else {
        Write-Utf8 -Path $configJsonPath -Text ("{}" + [Environment]::NewLine)
    }
    $resolvedConfig = Get-Content -Raw -Encoding UTF8 -LiteralPath $configJsonPath |
        ConvertFrom-Json

    $sourceUri = $null
    $sourceFile = $null
    $sourceKind = $null
    if ([Uri]::TryCreate($Source, [UriKind]::Absolute, [ref]$sourceUri) -and
        $sourceUri.Scheme -in @("http", "https")) {
        $targetUrl = $sourceUri.AbsoluteUri
        $sourceKind = "url"
    }
    else {
        $sourceFile = (Resolve-Path -LiteralPath $Source -ErrorAction Stop).Path
        if ([IO.Path]::GetExtension($sourceFile).ToLowerInvariant() -notin @(".html", ".htm")) {
            throw "Local source must be an .html or .htm file."
        }
        $sourceKind = "file"
        $script:PythonExe = Resolve-Executable -Explicit $PythonExe -FallbackName "python"
        $server = Start-LocalServer -Directory (Split-Path -Parent $sourceFile) -Python $script:PythonExe
        $serverProcess = $server.Process
        $encodedName = [Uri]::EscapeDataString((Split-Path -Leaf $sourceFile))
        $targetUrl = "http://127.0.0.1:$($server.Port)/$encodedName"
    }

    & $script:NpxExe --yes --package @playwright/cli playwright-cli --help | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Playwright CLI prerequisite check failed."
    }

    Push-Location $tempRoot
    try {
        $openArguments = @("open", $targetUrl)
        if ($Headed) {
            $openArguments += "--headed"
        }
        Invoke-Pw -Session $probeSession -Arguments $openArguments | Out-Null
        $probeOpened = $true
        Invoke-Pw -Session $probeSession -Arguments @("resize", "1440", "900") | Out-Null
        Invoke-Pw -Session $probeSession -Arguments @("snapshot") | Out-Null
        $probeResponse = Invoke-Pw -Session $probeSession -Arguments @(
            "run-code",
            "--filename",
            (Join-Path $PSScriptRoot "probe-page.js")
        )
        $probe = Convert-ResultPayload -Response $probeResponse
        Invoke-Pw -Session $probeSession -Arguments @("close") -IgnoreFailure | Out-Null
        $probeOpened = $false
    }
    finally {
        Pop-Location
    }

    $configPrjId = if ($resolvedConfig.PSObject.Properties.Name -contains "prj_id") {
        [string]$resolvedConfig.prj_id
    }
    else {
        $null
    }
    $effectivePrjId = if ($PrjId) {
        $PrjId
    }
    elseif ($configPrjId) {
        $configPrjId
    }
    elseif ($probe.prjId) {
        [string]$probe.prjId
    }
    else {
        Read-Host "prj_id was not found in the HTML. Enter prj_id"
    }
    if ([string]::IsNullOrWhiteSpace($effectivePrjId)) {
        throw "prj_id is required."
    }

    $configuredOutput = if ($resolvedConfig.PSObject.Properties.Name -contains "output_root") {
        [string]$resolvedConfig.output_root
    }
    else {
        $null
    }
    $effectiveOutputRoot = if ($OutputRoot) {
        Resolve-OutputPath -Value $OutputRoot
    }
    elseif ($configuredOutput) {
        Resolve-OutputPath -Value $configuredOutput
    }
    else {
        Resolve-OutputPath -Value "output/playwright"
    }
    $safePrjId = Sanitize-Segment -Value $effectivePrjId -Fallback "project"
    $runDirectory = Join-Path (Join-Path $effectiveOutputRoot $safePrjId) $timestamp
    New-Item -ItemType Directory -Force -Path $runDirectory | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $runDirectory "screenshots") | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $runDirectory "workbook-preview") | Out-Null

    $allowSubmitFromConfig = if ($resolvedConfig.PSObject.Properties.Name -contains "allow_submit") {
        [bool]$resolvedConfig.allow_submit
    }
    else {
        $false
    }
    $effectiveAllowSubmit = $AllowSubmit.IsPresent -or $allowSubmitFromConfig

    $outerHtml = [string]$probe.outerHTML
    $probe.PSObject.Properties.Remove("outerHTML")
    $probe | Add-Member -NotePropertyName "prjId" -NotePropertyValue $effectivePrjId -Force
    $probe | Add-Member -NotePropertyName "source" -NotePropertyValue ([pscustomobject]@{
            kind = $sourceKind
            value = if ($sourceKind -eq "file") { $sourceFile } else { $targetUrl }
            testedUrl = $targetUrl
        }) -Force
    $probe | Add-Member -NotePropertyName "allowSubmit" -NotePropertyValue $effectiveAllowSubmit -Force
    $probe | Add-Member -NotePropertyName "runStartedAt" `
        -NotePropertyValue ((Get-Date).ToString("o")) `
        -Force

    if ($sourceKind -eq "file") {
        $sourceSnapshot = Join-Path $runDirectory "source.html"
        Copy-Item -LiteralPath $sourceFile -Destination $sourceSnapshot
    }
    else {
        $sourceSnapshot = Join-Path $runDirectory "dom-snapshot.html"
        Write-Utf8 -Path $sourceSnapshot -Text $outerHtml
    }
    $hash = (Get-FileHash -LiteralPath $sourceSnapshot -Algorithm SHA256).Hash.ToLowerInvariant()
    $probe | Add-Member -NotePropertyName "sha256" -NotePropertyValue $hash -Force
    Write-Utf8 -Path (Join-Path $runDirectory "source.sha256") -Text ($hash + [Environment]::NewLine)
    Write-Json -Path (Join-Path $runDirectory "form-spec.json") -Value $probe
    Copy-Item -LiteralPath $configJsonPath -Destination (Join-Path $runDirectory "qa-config.resolved.json")

    $caseArguments = @(
        (Join-Path $PSScriptRoot "generate-cases.mjs"),
        "--spec",
        (Join-Path $runDirectory "form-spec.json"),
        "--config",
        (Join-Path $runDirectory "qa-config.resolved.json"),
        "--output",
        (Join-Path $runDirectory "test-cases.json")
    )
    $configuredMaxCases = if ($resolvedConfig.PSObject.Properties.Name -contains "max_cases") {
        [int]$resolvedConfig.max_cases
    }
    else {
        0
    }
    $effectiveMaxCases = if ($MaxCases -gt 0) { $MaxCases } else { $configuredMaxCases }
    if ($effectiveMaxCases -gt 0) {
        $caseArguments += @("--max-cases", [string]$effectiveMaxCases)
    }
    $caseOutput = (& $script:NodeExe @caseArguments 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Test case generation failed: $caseOutput"
    }
    $cases = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $runDirectory "test-cases.json") |
        ConvertFrom-Json

    New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $runtimeDir "node_modules") -Target $resolvedNodeModules |
        Out-Null
    Invoke-Workbook -Arguments @(
        "create",
        "--spec",
        (Join-Path $runDirectory "form-spec.json"),
        "--cases",
        (Join-Path $runDirectory "test-cases.json"),
        "--output",
        (Join-Path $runDirectory "test-data.xlsx"),
        "--preview-dir",
        (Join-Path $runDirectory "workbook-preview")
    ) | Out-Null

    $execution = [ordered]@{
        prjId = $effectivePrjId
        source = $targetUrl
        startedAt = (Get-Date).ToString("o")
        allowSubmit = $effectiveAllowSubmit
        browser = "chromium"
        viewport = "1440x900"
        results = @()
        totals = [ordered]@{
            cases = [int]$cases.totals.cases
            PASS = 0
            FAIL = 0
        }
    }
    Write-Json -Path (Join-Path $runDirectory "execution-log.json") -Value $execution

    Push-Location $runDirectory
    try {
        $openArguments = @("open", $targetUrl)
        if ($Headed) {
            $openArguments += "--headed"
        }
        Invoke-Pw -Session $runSession -Arguments $openArguments | Out-Null
        $runOpened = $true
        Invoke-Pw -Session $runSession -Arguments @("resize", "1440", "900") | Out-Null
        Invoke-Pw -Session $runSession -Arguments @("tracing-start") | Out-Null

        $allCases = @()
        foreach ($form in @($cases.forms)) {
            $allCases += @($form.cases)
        }
        $template = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot "execute-case-template.js")
        $configForJavascript = $resolvedConfig | ConvertTo-Json -Depth 100 -Compress

        foreach ($testCase in $allCases) {
            $result = $null
            $lastError = $null
            for ($attempt = 1; $attempt -le 2; $attempt += 1) {
                try {
                    Invoke-Pw -Session $runSession -Arguments @("goto", $targetUrl) | Out-Null
                    Invoke-Pw -Session $runSession -Arguments @("snapshot") | Out-Null
                    $caseJson = $testCase | ConvertTo-Json -Depth 100 -Compress
                    $runnerCode = $template.Replace("__TEST_CASE_JSON__", $caseJson)
                    $runnerCode = $runnerCode.Replace("__CONFIG_JSON__", $configForJavascript)
                    $runnerCode = $runnerCode.Replace(
                        "__ALLOW_SUBMIT__",
                        $effectiveAllowSubmit.ToString().ToLowerInvariant()
                    )
                    Write-Utf8 -Path $caseRunnerPath -Text $runnerCode
                    $response = Invoke-Pw -Session $runSession -Arguments @(
                        "run-code",
                        "--filename",
                        $caseRunnerPath
                    )
                    $result = Convert-ResultPayload -Response $response
                    break
                }
                catch {
                    $lastError = $_.Exception.Message
                    if ($attempt -lt 2) {
                        continue
                    }
                }
            }

            if (-not $result) {
                $result = [pscustomobject]@{
                    id = [string]$testCase.id
                    status = "TECHNICAL_ERROR"
                    actualResult = "Playwright execution failed after one retry."
                    note = $lastError
                    testedAt = (Get-Date).ToString("o")
                    submitted = $false
                    submissionAuthorized = $effectiveAllowSubmit
                }
            }
            $result | Add-Member -NotePropertyName "testedAt" `
                -NotePropertyValue ((Get-Date).ToString("o")) `
                -Force

            $safeSlug = Sanitize-Segment -Value ([string]$testCase.slug) -Fallback ([string]$testCase.id)
            $safeExpected = Sanitize-Segment -Value ([string]$testCase.expected.kind) -Fallback "expected"
            $safeStatus = Sanitize-Segment -Value ([string]$result.status) -Fallback "status"
            $screenshotFiles = @()
            $mainName = "${safeSlug}_${safeExpected}_$safeStatus.png"
            $mainPath = Join-Path (Join-Path $runDirectory "screenshots") $mainName
            $screenResponse = Invoke-Pw -Session $runSession -Arguments @(
                "screenshot",
                [string]$testCase.formSelector,
                "--filename",
                $mainPath
            ) -IgnoreFailure
            $screenHasError = $screenResponse.PSObject.Properties.Name -contains "isError"
            if ((-not $screenHasError -or -not $screenResponse.isError) -and
                (Test-Path -LiteralPath $mainPath)) {
                $screenshotFiles += $mainName
            }
            else {
                $fallbackName = "${safeSlug}_${safeExpected}_${safeStatus}_page.png"
                $fallbackPath = Join-Path (Join-Path $runDirectory "screenshots") $fallbackName
                Invoke-Pw -Session $runSession -Arguments @(
                    "screenshot",
                    "--filename",
                    $fallbackPath,
                    "--full-page"
                ) -IgnoreFailure | Out-Null
                if (Test-Path -LiteralPath $fallbackPath) {
                    $screenshotFiles += $fallbackName
                }
            }

            if ($result.status -ne "PASS") {
                $fullName = "${safeSlug}_${safeExpected}_${safeStatus}_full.png"
                $fullPath = Join-Path (Join-Path $runDirectory "screenshots") $fullName
                Invoke-Pw -Session $runSession -Arguments @(
                    "screenshot",
                    "--filename",
                    $fullPath,
                    "--full-page"
                ) -IgnoreFailure | Out-Null
                if (Test-Path -LiteralPath $fullPath) {
                    $screenshotFiles += $fullName
                }
            }

            $result | Add-Member -NotePropertyName "screenshotFiles" `
                -NotePropertyValue $screenshotFiles `
                -Force
            $execution.results += $result
            if ($execution.totals.Contains([string]$result.status)) {
                $execution.totals[[string]$result.status] += 1
            }
            else {
                $execution.totals[[string]$result.status] = 1
            }
            Write-Json -Path (Join-Path $runDirectory "execution-log.json") -Value $execution
        }

        $network = Invoke-Pw -Session $runSession -Arguments @("requests") -IgnoreFailure
        $console = Invoke-Pw -Session $runSession -Arguments @("console") -IgnoreFailure
        Write-Json -Path (Join-Path $runDirectory "network-log.json") -Value $network
        Write-Json -Path (Join-Path $runDirectory "console-log.json") -Value $console
        Invoke-Pw -Session $runSession -Arguments @("tracing-stop") -IgnoreFailure | Out-Null
        Invoke-Pw -Session $runSession -Arguments @("close") -IgnoreFailure | Out-Null
        $runOpened = $false
    }
    finally {
        Pop-Location
    }

    $traceDirectory = Join-Path (Join-Path $runDirectory ".playwright-cli") "traces"
    $traceZip = Join-Path $runDirectory "playwright-trace.zip"
    if (Test-Path -LiteralPath $traceDirectory -PathType Container) {
        $tracePackaged = $false
        $traceError = $null
        for ($traceAttempt = 1; $traceAttempt -le 5; $traceAttempt += 1) {
            try {
                Start-Sleep -Milliseconds 1500
                Compress-Archive -Path (Join-Path $traceDirectory "*") `
                    -DestinationPath $traceZip `
                    -CompressionLevel Optimal `
                    -Force `
                    -ErrorAction Stop
                $tracePackaged = $true
                break
            }
            catch {
                $traceError = $_.Exception.Message
                if (Test-Path -LiteralPath $traceZip) {
                    Remove-Item -LiteralPath $traceZip -Force -ErrorAction SilentlyContinue
                }
            }
        }
        if (-not $tracePackaged) {
            Write-Utf8 -Path (Join-Path $runDirectory "playwright-trace-missing.txt") `
                -Text ("Trace packaging failed after retries: $traceError" + [Environment]::NewLine)
        }
    }
    elseif (-not (Test-Path -LiteralPath $traceZip)) {
        Write-Utf8 -Path (Join-Path $runDirectory "playwright-trace-missing.txt") `
            -Text ("Playwright CLI did not expose a trace ZIP path." + [Environment]::NewLine)
    }

    $execution["finishedAt"] = (Get-Date).ToString("o")
    Write-Json -Path (Join-Path $runDirectory "execution-log.json") -Value $execution

    Invoke-Workbook -Arguments @(
        "results",
        "--input",
        (Join-Path $runDirectory "test-data.xlsx"),
        "--cases",
        (Join-Path $runDirectory "test-cases.json"),
        "--results",
        (Join-Path $runDirectory "execution-log.json"),
        "--output",
        (Join-Path $runDirectory "test-results.xlsx"),
        "--preview-dir",
        (Join-Path $runDirectory "workbook-preview")
    ) | Out-Null

    [pscustomobject]@{
        runDirectory = $runDirectory
        testData = Join-Path $runDirectory "test-data.xlsx"
        testResults = Join-Path $runDirectory "test-results.xlsx"
        totals = $execution.totals
        skipped = [int]$cases.totals.skipped
        allowSubmit = $effectiveAllowSubmit
    } | ConvertTo-Json -Depth 10
}
finally {
    if ($probeOpened) {
        Invoke-Pw -Session $probeSession -Arguments @("close") -IgnoreFailure | Out-Null
    }
    if ($runOpened) {
        Invoke-Pw -Session $runSession -Arguments @("close") -IgnoreFailure | Out-Null
    }
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $caseRunnerPath) {
        Remove-Item -LiteralPath $caseRunnerPath -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $tempRoot) {
        $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
        $allowedRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($resolvedTemp.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedTemp).StartsWith("test-html-forms-")) {
            Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
