$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$out = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../output/video/dev-20261029/voice-neutral-tw'))
$specification = Get-Content -LiteralPath (Join-Path $out 'specification.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.SelectVoice($specification.voice)
    foreach ($cue in $specification.cues) {
        $synth.SetOutputToWaveFile((Join-Path $out $cue.file))
        $synth.SpeakSsml($cue.ssml)
        $synth.SetOutputToNull()
    }
    Write-Output ('Narrated ' + $specification.cues.Count + ' subtitle cues locally')
} finally { $synth.Dispose() }
