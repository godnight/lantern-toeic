param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [string]$FfmpegPath = (Get-Command ffmpeg -ErrorAction Stop).Source,
  [string]$FfprobePath = (Get-Command ffprobe -ErrorAction Stop).Source
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Speech
$utf8 = New-Object System.Text.UTF8Encoding($false)
$inputManifest = [System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$outputDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($InputPath))
$audioDirectory = Join-Path $outputDirectory 'mp3'
$waveDirectory = Join-Path $outputDirectory 'wav'
[System.IO.Directory]::CreateDirectory($audioDirectory) | Out-Null
[System.IO.Directory]::CreateDirectory($waveDirectory) | Out-Null
if (-not (Test-Path -LiteralPath $FfmpegPath -PathType Leaf)) { throw 'ffmpeg executable is missing' }
if (-not (Test-Path -LiteralPath $FfprobePath -PathType Leaf)) { throw 'ffprobe executable is missing' }
$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synthesizer.SelectVoice($inputManifest.voice.name)
$synthesizer.Rate = $inputManifest.voice.rate
$synthesizer.Volume = $inputManifest.voice.volume
if ($synthesizer.Voice.Culture.Name -ne 'en-US') { throw 'Expected en-US voice' }
$results = New-Object System.Collections.Generic.List[object]
$index = 0
try {
  foreach ($item in $inputManifest.entries) {
    $index++
    $textBytes = [System.Text.Encoding]::UTF8.GetBytes($item.text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $textHash = ([System.BitConverter]::ToString($sha.ComputeHash($textBytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($textHash -ne $item.textSha256 -or $item.filename -ne ($textHash.Substring(0, 20) + '.mp3')) { throw 'Text hash mismatch' }
    $wavePath = Join-Path $waveDirectory ($textHash.Substring(0, 20) + '.wav')
    $audioPath = Join-Path $audioDirectory $item.filename
    if (-not (Test-Path -LiteralPath $wavePath -PathType Leaf)) {
      $synthesizer.SetOutputToWaveFile($wavePath)
      try { $synthesizer.Speak($item.text) }
      finally { $synthesizer.SetOutputToNull() }
    }
    if (-not (Test-Path -LiteralPath $audioPath -PathType Leaf)) {
      & $FfmpegPath -hide_banner -loglevel error -nostdin -y -i $wavePath -map_metadata -1 -ac 1 -ar 22050 -codec:a libmp3lame -b:a 64k $audioPath
      if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed: $($item.filename)" }
    }
    $probeText = (& $FfprobePath -v error -show_entries 'format=duration:stream=codec_name,sample_rate,channels,bit_rate' -of json $audioPath) -join [Environment]::NewLine
    if ($LASTEXITCODE -ne 0) { throw "ffprobe failed: $($item.filename)" }
    $probe = $probeText | ConvertFrom-Json
    $duration = [double]::Parse($probe.format.duration, [System.Globalization.CultureInfo]::InvariantCulture)
    if ($duration -le 0 -or $probe.streams.Count -ne 1 -or $probe.streams[0].codec_name -ne 'mp3' -or $probe.streams[0].channels -ne 1 -or $probe.streams[0].sample_rate -ne '22050') { throw "Invalid audio format: $($item.filename)" }
    $record = [ordered]@{
      text = $item.text
      textSha256 = $item.textSha256
      file = $item.filename
      bytes = (Get-Item -LiteralPath $audioPath).Length
      sha256 = (Get-FileHash -LiteralPath $audioPath -Algorithm SHA256).Hash.ToLowerInvariant()
      durationSeconds = $duration
      references = @($item.references)
    }
    $results.Add($record)
    if ($index % 10 -eq 0 -or $index -eq $inputManifest.entries.Count) { Write-Output ("Generated/verified {0}/{1}: {2}" -f $index, $inputManifest.entries.Count, $item.filename) }
  }
  $manifest = [ordered]@{
    schemaVersion = 1
    generatedAt = [DateTime]::UtcNow.ToString('o')
    sourceFiles = $inputManifest.sourceFiles
    textPolicy = $inputManifest.textPolicy
    voice = $inputManifest.voice
    format = $inputManifest.format
    generation = [ordered]@{ networkServiceUsed = $false; systemSpeechAssembly = $synthesizer.GetType().Assembly.FullName; voiceDescription = $synthesizer.Voice.Description; ffmpeg = (& $FfmpegPath -version | Select-Object -First 1) }
    clips = @($results.ToArray())
  }
  [System.IO.File]::WriteAllText((Join-Path $outputDirectory 'manifest.json'), (($manifest | ConvertTo-Json -Depth 14) + [Environment]::NewLine), $utf8)
  Write-Output ("Complete: {0} MP3 files" -f $results.Count)
}
finally { $synthesizer.Dispose() }
