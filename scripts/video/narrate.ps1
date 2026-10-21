# Offline narration for ATLAS Academy videos (Windows built-in speech; no network, no account).
# Usage: powershell -NoProfile -File narrate.ps1 -Manifest <segments.json>
# segments.json: [{ "file": "C:/.../seg-01.wav", "text": "..." }, ...]
param([Parameter(Mandatory = $true)][string]$Manifest, [string]$Voice = 'Microsoft Zira Desktop', [int]$Rate = -1)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$segments = Get-Content -Raw -Encoding UTF8 $Manifest | ConvertFrom-Json
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($s in $segments) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($Voice)
  $synth.Rate = $Rate
  $synth.SetOutputToWaveFile($s.file, $format)
  $synth.Speak([string]$s.text)
  $synth.SetOutputToNull()
  $synth.Dispose()
  Write-Output ("narrated " + [System.IO.Path]::GetFileName($s.file))
}
