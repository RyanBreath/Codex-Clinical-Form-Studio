param(
  [Parameter(Mandatory = $true)][string]$InputTextFile,
  [Parameter(Mandatory = $true)][string]$OutputWaveFile,
  [string]$Voice = "Microsoft David Desktop",
  [int]$Rate = 2
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$text = Get-Content -LiteralPath $InputTextFile -Raw -Encoding UTF8
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.SelectVoice($Voice)
  $synth.Rate = $Rate
  $synth.Volume = 100
  $synth.SetOutputToWaveFile($OutputWaveFile)
  $synth.Speak($text)
}
finally {
  $synth.Dispose()
}
