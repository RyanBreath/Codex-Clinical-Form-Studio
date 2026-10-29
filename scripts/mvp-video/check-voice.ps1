param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$out = [IO.Path]::GetFullPath($OutputDirectory)
$script = Get-Content -LiteralPath (Join-Path $out 'script.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @()
foreach ($shot in $script.shots) {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList ([Globalization.CultureInfo]'zh-TW')
    try {
        $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
        $recognizer.SetInputToWaveFile((Join-Path $out ('audio/' + $shot.id + '.wav')))
        $segments = @()
        while ($true) {
            try { $recognized = $recognizer.Recognize([TimeSpan]::FromSeconds(30)) }
            catch { if ($_.Exception.InnerException -is [InvalidOperationException] -and $segments.Count -gt 0) { break }; throw }
            if ($null -eq $recognized) { break }
            $segments += @{ text = $recognized.Text; confidence = $recognized.Confidence }
        }
        $result += @{ shot = $shot.id; expected = $shot.narration; recognized = @($segments); engine = 'local-zh-TW'; transmittedExternally = $false }
        Write-Output ($shot.id + ' voice checked locally')
    } finally { $recognizer.Dispose() }
}
$result | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $out 'speech-check.json') -Encoding UTF8
