$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$out = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../output/video/dev-20261029/voice-neutral-tw'))
$spec = Get-Content -LiteralPath (Join-Path $out 'specification.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$selected = @('001','015','026','038','066','079','083')
$checks = @()
foreach ($cue in $spec.cues | Where-Object { $_.id -in $selected }) {
    $file = Join-Path $out ('aligned/' + $cue.id + '-recognition.wav')
    & ffmpeg -v error -y -i (Join-Path $out ('aligned/' + $cue.id + '.wav')) -ar 16000 -ac 1 $file
    if ($LASTEXITCODE -ne 0) { throw 'Recognition input conversion failed' }
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine -ArgumentList ([Globalization.CultureInfo]'zh-TW')
    try {
        $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
        $recognizer.SetInputToWaveFile($file)
        $result = $recognizer.Recognize([TimeSpan]::FromSeconds(15))
        $checks += @{ cue = $cue.id; expected = $cue.text; recognized = $result.Text; confidence = $result.Confidence }
    } finally { $recognizer.Dispose() }
}
@{ engine = 'Windows System.Speech zh-TW local'; externalTransmission = $false; scope = 'Selected cues only; recognition is advisory, not human listening approval'; checks = $checks } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $out 'speech-check.json') -Encoding UTF8
Write-Output ('Local recognition checked ' + $checks.Count + ' selected cues')
