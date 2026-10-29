param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$out = [IO.Path]::GetFullPath($OutputDirectory)
$script = Get-Content -LiteralPath (Join-Path $out 'script.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice.SelectVoice($script.voice)
$voice.Rate = 0
try {
    foreach ($shot in $script.shots) {
        $file = Join-Path $out ('audio/' + $shot.id + '.wav')
        $voice.SetOutputToWaveFile($file)
        $voice.Speak($shot.narration)
        $voice.SetOutputToNull()
        Write-Output ($shot.id + ' narrated')
    }
} finally { $voice.Dispose() }
