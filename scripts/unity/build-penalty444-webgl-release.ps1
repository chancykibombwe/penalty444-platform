<#
.SYNOPSIS
  B6B — local Unity WebGL release builder wrapper (Windows PowerShell).

.DESCRIPTION
  LOCAL TOOLING ONLY. Preflights the environment, launches the committed Unity
  Editor build entry point in batchmode to build the fixed Penalty444Prototype
  scene into a NEW immutable, git-ignored, versioned release directory, and then
  INDEPENDENTLY verifies the resulting artifact manifest + checksums.

  It never uploads/publishes artifacts, configures storage/CDN/Vercel, installs
  Unity in CI, activates Unity in production, or resets/stages/commits Git.

  B6B establishes a repeatable LOCAL command with a pinned editor version,
  immutable output, source metadata, and per-file checksums. It does NOT prove
  cross-machine reproducibility, bit-for-bit determinism, or production
  hosting/performance/compatibility. See docs/unity-b6b-local-release-build.md.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass `
    -File scripts/unity/build-penalty444-webgl-release.ps1 `
    -Version "b6b-validation" -ReleaseNotes "B6B configuration validation only." -ValidateOnly

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass `
    -File scripts/unity/build-penalty444-webgl-release.ps1 `
    -Version "b6b-local-<short-sha>-a" -ReleaseNotes "B6B local release validation."
#>

[CmdletBinding()]
param(
    [string] $UnityEditorPath,
    [Parameter(Mandatory = $true)] [string] $Version,
    [string] $PreviousVersion = "",
    [Parameter(Mandatory = $true)] [string] $ReleaseNotes,
    [switch] $ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string] $message) {
    Write-Error $message
    exit 1
}

$VersionPattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
$ExecuteMethod = "Penalty444.Editor.Penalty444WebGLReleaseBuilder.BuildFromCommandLine"

# ── Locate repo root from the script location (scripts/unity/ -> repo root) ────
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$UnityProject = Join-Path $RepoRoot "unity\Penalty444Client"
$ProjectVersionTxt = Join-Path $UnityProject "ProjectSettings\ProjectVersion.txt"
$ReleaseRoot = Join-Path $RepoRoot "apps\web\public\unity\penalty444\releases"
$ReleaseDir = Join-Path $ReleaseRoot $Version

if (-not (Test-Path $UnityProject)) { Fail "Unity project not found: $UnityProject" }
if (-not (Test-Path $ProjectVersionTxt)) { Fail "ProjectVersion.txt not found: $ProjectVersionTxt" }

# ── Read the pinned project Unity version ─────────────────────────────────────
$ProjectUnityVersion = $null
foreach ($line in Get-Content -LiteralPath $ProjectVersionTxt) {
    if ($line.Trim().StartsWith("m_EditorVersion:")) {
        $ProjectUnityVersion = $line.Trim().Substring("m_EditorVersion:".Length).Trim()
        break
    }
}
if ([string]::IsNullOrWhiteSpace($ProjectUnityVersion)) { Fail "m_EditorVersion not found in ProjectVersion.txt." }

# ── Validate release version(s) ───────────────────────────────────────────────
if ($Version -notmatch $VersionPattern) {
    Fail "Invalid -Version '$Version'. Must match $VersionPattern (no slash/backslash/'..'/traversal)."
}
if (-not [string]::IsNullOrEmpty($PreviousVersion) -and ($PreviousVersion -notmatch $VersionPattern)) {
    Fail "Invalid -PreviousVersion '$PreviousVersion'. Must match $VersionPattern or be empty."
}
if ([string]::IsNullOrWhiteSpace($ReleaseNotes)) { Fail "Release notes must not be empty." }

# ── Resolve the Unity editor executable ───────────────────────────────────────
if ($UnityEditorPath) {
    if (-not (Test-Path -LiteralPath $UnityEditorPath -PathType Leaf)) {
        Fail "-UnityEditorPath does not exist: $UnityEditorPath"
    }
} else {
    $UnityEditorPath = "C:\Program Files\Unity\Hub\Editor\$ProjectUnityVersion\Editor\Unity.exe"
    if (-not (Test-Path -LiteralPath $UnityEditorPath -PathType Leaf)) {
        Fail ("Unity editor not found at the default Hub path for $ProjectUnityVersion. " +
              "Provide -UnityEditorPath <path-to-Unity.exe>.")
    }
}

# ── Resolve current full Git HEAD SHA ─────────────────────────────────────────
$HeadSha = (& git -C $RepoRoot rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or ($HeadSha -notmatch '^[0-9a-fA-F]{40}$')) {
    Fail "Could not resolve a valid 40-character Git HEAD SHA."
}
$HeadSha = $HeadSha.ToLowerInvariant()

# ── Require a clean TRACKED working tree (ignored WebGL output does not count) ─
function Get-TrackedDirty {
    $out = & git -C $RepoRoot status --porcelain --untracked-files=no 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "git status failed." }
    return @($out | Where-Object { $_ -and $_.Trim().Length -gt 0 })
}
$dirty = Get-TrackedDirty
if ($dirty.Count -gt 0) {
    Write-Host "Tracked working tree is not clean. Commit/stash these before building:" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "  $_" }
    Fail "Refusing to build with a dirty tracked working tree."
}

# ── Confirm the versioned release directory does not already exist ────────────
if (Test-Path -LiteralPath $ReleaseDir) {
    Fail "Release directory already exists (immutable): $ReleaseDir. Choose a new -Version."
}

# ── Encode release notes as UTF-8 Base64 ──────────────────────────────────────
$ReleaseNotesB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($ReleaseNotes))

Write-Host "Penalty444 B6B release preflight:"
Write-Host "  Repo root         : $RepoRoot"
Write-Host "  Unity project     : $UnityProject"
Write-Host "  Unity editor      : $UnityEditorPath"
Write-Host "  Project version   : $ProjectUnityVersion"
Write-Host "  Release version   : $Version"
Write-Host "  Previous version  : $PreviousVersion"
Write-Host "  Source commit     : $HeadSha"
Write-Host "  Output directory  : $ReleaseDir"
Write-Host "  Execute method    : $ExecuteMethod"

if ($ValidateOnly) {
    Write-Host ""
    Write-Host "ValidateOnly: preflight passed. Unity was NOT launched and no output was created." -ForegroundColor Green
    exit 0
}

# ── Launch Unity (batchmode) ──────────────────────────────────────────────────
$unityArgs = @(
    "-batchmode", "-quit", "-nographics",
    "-projectPath", $UnityProject,
    "-executeMethod", $ExecuteMethod,
    "-logFile", "-",
    "-penalty444ReleaseVersion", $Version,
    "-penalty444SourceCommit", $HeadSha,
    "-penalty444PreviousVersion", $PreviousVersion,
    "-penalty444ReleaseNotesBase64", $ReleaseNotesB64
)

Write-Host ""
Write-Host "Launching Unity build..."
& $UnityEditorPath @unityArgs
$unityExit = $LASTEXITCODE
if ($unityExit -ne 0) {
    Fail "Unity build process failed (exit $unityExit). Inspect the partial output at $ReleaseDir if present; use a NEW -Version for the next attempt (releases are immutable)."
}

# ── Independent post-build verification ───────────────────────────────────────
$manifestPath = Join-Path $ReleaseDir "manifest.json"
$manifestShaPath = Join-Path $ReleaseDir "manifest.sha256"
if (-not (Test-Path -LiteralPath $manifestPath)) { Fail "manifest.json missing after build." }
if (-not (Test-Path -LiteralPath $manifestShaPath)) { Fail "manifest.sha256 missing after build." }

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

if ($manifest.releaseVersion -ne $Version) { Fail "Manifest releaseVersion mismatch." }
if ($manifest.sourceCommit -ne $HeadSha) { Fail "Manifest sourceCommit does not match pre-build HEAD." }
if ($manifest.unityVersion -ne $ProjectUnityVersion) { Fail "Manifest unityVersion does not match ProjectVersion.txt." }

foreach ($f in $manifest.files) {
    $rel = $f.path -replace '/', '\'
    $abs = Join-Path $ReleaseDir $rel
    if (-not (Test-Path -LiteralPath $abs)) { Fail "Manifest file missing on disk: $($f.path)" }
    $actualBytes = (Get-Item -LiteralPath $abs).Length
    if ($actualBytes -ne [long]$f.bytes) { Fail "Byte count mismatch for $($f.path): manifest=$($f.bytes) actual=$actualBytes" }
    $actualSha = (Get-FileHash -LiteralPath $abs -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha -ne $f.sha256) { Fail "SHA-256 mismatch for $($f.path)." }
}

# manifest.sha256 must match manifest.json
$recordedManifestSha = ((Get-Content -LiteralPath $manifestShaPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
$actualManifestSha = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($recordedManifestSha -ne $actualManifestSha) { Fail "manifest.sha256 does not match manifest.json." }

# Required artifact categories present
$buildDir = Join-Path $ReleaseDir "Build"
if (-not (Test-Path $buildDir)) { Fail "Build/ directory missing." }
$buildFiles = Get-ChildItem -LiteralPath $buildDir -File | ForEach-Object { $_.Name }
$loaderCount = @($buildFiles | Where-Object { $_ -like '*.loader.js' }).Count
if ($loaderCount -ne 1) { Fail "Expected exactly one Build/*.loader.js, found $loaderCount." }
foreach ($cat in @(
    @{ n = 'framework'; p = @('*.framework.js', '*.framework.js.gz', '*.framework.js.br') },
    @{ n = 'data';      p = @('*.data', '*.data.gz', '*.data.br') },
    @{ n = 'wasm';      p = @('*.wasm', '*.wasm.gz', '*.wasm.br') }
)) {
    $found = $false
    foreach ($pat in $cat.p) { if (@($buildFiles | Where-Object { $_ -like $pat }).Count -gt 0) { $found = $true; break } }
    if (-not $found) { Fail "Missing Build/*.$($cat.n) artifact." }
}
if (-not (Test-Path (Join-Path $ReleaseDir "TemplateData")) -or
    @(Get-ChildItem -LiteralPath (Join-Path $ReleaseDir "TemplateData") -Recurse -File).Count -eq 0) {
    Fail "TemplateData/ missing or empty."
}

# Tracked tree must STILL be clean (Unity must not modify tracked project files)
$dirtyAfter = Get-TrackedDirty
if ($dirtyAfter.Count -gt 0) {
    Write-Host "Unity modified tracked project files (NOT staged/reset by this script):" -ForegroundColor Yellow
    $dirtyAfter | ForEach-Object { Write-Host "  $_" }
    Fail "Tracked working tree is dirty after build. Review the changes above manually."
}

# ── Success summary ───────────────────────────────────────────────────────────
Write-Host ""
Write-Host "B6B release build verified." -ForegroundColor Green
Write-Host "  Release directory : $ReleaseDir"
Write-Host "  Unity version     : $($manifest.unityVersion)"
Write-Host "  Source commit     : $($manifest.sourceCommit)"
Write-Host "  File count        : $($manifest.fileCount)"
Write-Host "  Total bytes       : $($manifest.totalArtifactBytes)"
Write-Host "  Compressed bytes  : $($manifest.compressedPayloadBytes)"
Write-Host "  Compression mode  : $($manifest.compressionMode)"
Write-Host "  Manifest SHA-256  : $actualManifestSha"
exit 0
