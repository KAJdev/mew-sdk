$ErrorActionPreference = "Stop"

$repo = "KAJdev/mew-sdk"
$version = if ($env:MEW_VERSION) { $env:MEW_VERSION } else { "latest" }
$installDir = if ($env:MEW_INSTALL_DIR) { $env:MEW_INSTALL_DIR } else { Join-Path $HOME ".mew\bin" }
$base = if ($env:MEW_RELEASE_URL) { $env:MEW_RELEASE_URL }
  elseif ($version -eq "latest") { "https://github.com/$repo/releases/latest/download" }
  else { "https://github.com/$repo/releases/download/$version" }

if (-not [Environment]::Is64BitOperatingSystem) { throw "mew install: a 64-bit Windows is required" }
$asset = "mew-windows-x64.exe"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $sums = Join-Path $tmp "SHA256SUMS"
  $binary = Join-Path $tmp $asset
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $binary
  $line = Get-Content $sums | Where-Object { ($_ -split "\s+")[1] -in @($asset, "*$asset") } | Select-Object -First 1
  if (-not $line) { throw "mew install: $asset is not listed in SHA256SUMS" }
  $expected = ($line -split "\s+")[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -Path $binary).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "mew install: checksum mismatch for $asset (expected $expected, got $actual)" }
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  $target = Join-Path $installDir "mew.exe"
  Move-Item -Force $binary $target
  Write-Host "Installed mew $(& $target --version) to $target"
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($userPath -split ";") -contains $installDir)) {
    [Environment]::SetEnvironmentVariable("Path", "$installDir;$userPath", "User")
    Write-Host "Added $installDir to your user PATH. Restart your terminal to use mew."
  }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
