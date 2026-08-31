[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$manifestCandidates = @(
  (Join-Path $PSScriptRoot "codex-runtime.json"),
  (Join-Path $PSScriptRoot "..\codex-runtime.json")
)
$manifestPath = $manifestCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if (-not $manifestPath) {
  throw "codex-runtime.json was not found next to the installer script."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($manifest.version) -or [string]::IsNullOrWhiteSpace($manifest.installerUrl) -or [string]::IsNullOrWhiteSpace($manifest.installerSha256)) {
  throw "The Codex runtime manifest is incomplete."
}
if (-not ([Uri]$manifest.installerUrl).Scheme.Equals("https", [StringComparison]::OrdinalIgnoreCase)) {
  throw "The Codex installer URL must use HTTPS."
}
if ([string]$manifest.installerSha256 -notmatch "^[0-9a-fA-F]{64}$") {
  throw "The Codex installer SHA-256 is invalid."
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("radimo-reporthalo-codex-" + [Guid]::NewGuid().ToString("N"))
$installerPath = Join-Path $tempRoot "install.ps1"
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
  Write-Host ("Downloading the official Codex installer for version {0}..." -f $manifest.version)
  Invoke-WebRequest -UseBasicParsing -Uri $manifest.installerUrl -OutFile $installerPath
  $actualHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne ([string]$manifest.installerSha256).ToLowerInvariant()) {
    throw "The downloaded Codex installer failed SHA-256 verification."
  }

  $previousRelease = $env:CODEX_RELEASE
  $previousNonInteractive = $env:CODEX_NON_INTERACTIVE
  $previousSource = $env:CODEX_INSTALLER_USE_RELEASES_OPENAI_COM
  try {
    $env:CODEX_RELEASE = [string]$manifest.version
    $env:CODEX_NON_INTERACTIVE = "true"
    $env:CODEX_INSTALLER_USE_RELEASES_OPENAI_COM = "true"
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $installerPath -Release ([string]$manifest.version)
    if ($LASTEXITCODE -ne 0) { throw "The official Codex installer exited with code $LASTEXITCODE." }
  } finally {
    $env:CODEX_RELEASE = $previousRelease
    $env:CODEX_NON_INTERACTIVE = $previousNonInteractive
    $env:CODEX_INSTALLER_USE_RELEASES_OPENAI_COM = $previousSource
  }

  $codexHome = if ([string]::IsNullOrWhiteSpace($env:CODEX_HOME)) { Join-Path $env:USERPROFILE ".codex" } else { $env:CODEX_HOME }
  $knownPaths = @(
    (Join-Path $codexHome "packages\standalone\current\bin\codex.exe"),
    (Join-Path $codexHome "packages\standalone\current\codex.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\OpenAI\Codex\bin\codex.exe")
  )
  $managedRoot = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
  if (Test-Path -LiteralPath $managedRoot -PathType Container) {
    $knownPaths += Get-ChildItem -LiteralPath $managedRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
      Join-Path $_.FullName "codex.exe"
    }
  }
  $installed = $knownPaths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $installed) { throw "Codex installation completed without a discoverable codex.exe." }
  Write-Host ("Codex is ready at {0}" -f $installed)
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
