<#
.SYNOPSIS
  B6C — local Unity WebGL STAGING artifact deployment wrapper (Windows PowerShell).

.DESCRIPTION
  LOCAL TOOLING ONLY. Independently re-verifies one existing, locally-generated
  B6B Unity WebGL release, copies it into a NEW ignored temporary workspace with
  the committed Vercel header template, links that workspace to a pre-existing
  dedicated Vercel artifact project, and creates a PREVIEW (non-production)
  deployment at an immutable versioned path. It then independently verifies the
  hosted artifact over HTTP and records local deployment metadata.

  STAGING ONLY. It never deploys with --prod, never creates the Vercel project,
  never assigns an alias, never configures production/preview environment
  variables, never activates Unity in production, never publishes through Git,
  and never alters Git content/index state. The overall production decision
  remains NO-GO. See docs/unity-b6c-versioned-staging-delivery.md.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass `
    -File scripts/unity/deploy-penalty444-webgl-staging.ps1 `
    -ReleaseVersion "b6b-local-fb840878-d" `
    -VercelProject "penalty444-unity-staging" `
    -ValidateOnly

.EXAMPLE
  # Personal scope (no team). Add -VercelTeam "my-vercel-team" for a team scope.
  powershell -NoProfile -ExecutionPolicy Bypass `
    -File scripts/unity/deploy-penalty444-webgl-staging.ps1 `
    -ReleaseVersion "b6b-local-fb840878-d" `
    -VercelProject "penalty444-unity-staging"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ReleaseVersion,
    [Parameter(Mandatory = $true)] [string] $VercelProject,
    [string] $VercelTeam = "",
    [switch] $ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string] $message) {
    Write-Error $message
    exit 1
}

$VersionPattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
$ProjectPattern = '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
$CommitPattern  = '^[0-9a-fA-F]{40}$'
$BuildScene     = "Assets/Scenes/Penalty444Prototype.unity"
$Game           = "penalty444"

# Version validity: committed character-set regex plus an explicit ".." reject.
function Test-ReleaseVersion([string] $value) {
    return (-not [string]::IsNullOrEmpty($value)) `
        -and ($value -match $VersionPattern) `
        -and (-not $value.Contains(".."))
}

function Get-Sha256Lower([string] $path) {
    return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# ── Locate repo root from the script location (scripts/unity/ -> repo root) ────
$RepoRoot        = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ReleaseRoot     = Join-Path $RepoRoot "apps\web\public\unity\penalty444\releases"
$ReleaseDir      = Join-Path $ReleaseRoot $ReleaseVersion
$TemplatePath    = Join-Path $RepoRoot "scripts\unity\vercel\penalty444-webgl-staging.vercel.json"
$StagingRootRel  = "audit-artifacts\unity-staging"
$StagingRoot     = Join-Path $RepoRoot $StagingRootRel

# ── Parameter-shape validation ────────────────────────────────────────────────
if (-not (Test-ReleaseVersion $ReleaseVersion)) {
    Fail "Invalid -ReleaseVersion '$ReleaseVersion'. Must match $VersionPattern and contain no '..'."
}
if ([string]::IsNullOrWhiteSpace($VercelProject) -or ($VercelProject -notmatch $ProjectPattern)) {
    Fail "Invalid -VercelProject '$VercelProject'. Must match $ProjectPattern."
}
if (-not [string]::IsNullOrEmpty($VercelTeam) -and ($VercelTeam -notmatch $ProjectPattern)) {
    Fail "Invalid -VercelTeam '$VercelTeam'. Must match $ProjectPattern or be empty."
}

# ── Committed Vercel template must exist and be valid JSON ─────────────────────
if (-not (Test-Path -LiteralPath $TemplatePath)) { Fail "Vercel template not found: $TemplatePath" }
try {
    $null = Get-Content -LiteralPath $TemplatePath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Fail "Vercel template is not valid JSON: $TemplatePath"
}

# ── Tracked content hygiene (B6B content-clean logic; never alters Git state) ──
function Get-TrackedDirty {
    $porcelain = @(& git -C $RepoRoot status --porcelain --untracked-files=no 2>$null |
        Where-Object { $_ -and $_.Trim().Length -gt 0 })
    if ($LASTEXITCODE -ne 0) { Fail "git status failed." }
    if ($porcelain.Count -eq 0) { return @() }

    $unstaged = @(& git -C $RepoRoot diff --name-only 2>$null |
        Where-Object { $_ -and $_.Trim().Length -gt 0 })
    if ($LASTEXITCODE -ne 0) { Fail "git diff failed." }
    $staged = @(& git -C $RepoRoot diff --cached --name-only 2>$null |
        Where-Object { $_ -and $_.Trim().Length -gt 0 })
    if ($LASTEXITCODE -ne 0) { Fail "git diff --cached failed." }
    $unmerged = @(& git -C $RepoRoot diff --name-only --diff-filter=U 2>$null |
        Where-Object { $_ -and $_.Trim().Length -gt 0 })
    if ($LASTEXITCODE -ne 0) { Fail "git diff --diff-filter=U failed." }

    $union = @($unstaged + $staged + $unmerged | Sort-Object -Unique)
    if ($union.Count -eq 0) {
        Write-Host ("Note: Git reported status metadata (e.g. line-ending/index state) for " +
                    "$($porcelain.Count) path(s) with no tracked content diff; treating as content-clean. " +
                    "No Git content/index state was modified.") -ForegroundColor Yellow
        return @()
    }
    return $union
}

# ── Independent source-release verification ───────────────────────────────────
# Returns the parsed manifest object. Verifies manifest integrity, source-commit
# existence, every listed file's bytes+SHA-256, path safety, artifact categories,
# and that no undeclared extra file is present. Never modifies the release.
function Test-SourceRelease([string] $dir, [string] $expectedVersion) {
    if (-not (Test-Path -LiteralPath $dir)) { Fail "Release directory not found: $dir" }

    $manifestPath = Join-Path $dir "manifest.json"
    $shaPath      = Join-Path $dir "manifest.sha256"
    if (-not (Test-Path -LiteralPath $manifestPath)) { Fail "manifest.json missing: $manifestPath" }
    if (-not (Test-Path -LiteralPath $shaPath)) { Fail "manifest.sha256 missing: $shaPath" }

    # Self-checksum must match the exact manifest bytes.
    $recordedSha = ((Get-Content -LiteralPath $shaPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    $actualSha   = Get-Sha256Lower $manifestPath
    if ($recordedSha -ne $actualSha) { Fail "manifest.sha256 does not match manifest.json in $dir." }

    $m = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

    if ([int]$m.schemaVersion -ne 1) { Fail "manifest schemaVersion is not 1." }
    if ($m.game -ne $Game) { Fail "manifest game is not '$Game'." }
    if ($m.releaseVersion -ne $expectedVersion) { Fail "manifest releaseVersion '$($m.releaseVersion)' != requested '$expectedVersion'." }
    if ($m.buildTarget -ne "WebGL") { Fail "manifest buildTarget is not 'WebGL'." }
    if ([string]::IsNullOrWhiteSpace($m.unityVersion)) { Fail "manifest unityVersion is empty." }
    if ($m.sourceCommit -notmatch $CommitPattern) { Fail "manifest sourceCommit is not a 40-char hex SHA." }
    if ($m.scene -ne $BuildScene) { Fail "manifest scene is not '$BuildScene'." }
    # B6C's committed Vercel template ships gzip rules only.
    if ($m.compressionMode -ne "gzip") {
        Fail "B6C staging delivery currently supports gzip B6B releases only. (manifest compressionMode='$($m.compressionMode)')"
    }

    # Source commit must exist in this repository.
    & git -C $RepoRoot cat-file -e ("{0}^{{commit}}" -f $m.sourceCommit) 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "manifest sourceCommit $($m.sourceCommit) is not a known Git commit." }

    if ($null -eq $m.files -or @($m.files).Count -eq 0) { Fail "manifest files[] is empty." }

    # Canonical release prefix used to confine every manifest entry.
    $canonicalDir = [System.IO.Path]::GetFullPath($dir)
    if (-not $canonicalDir.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
        $canonicalDir += [System.IO.Path]::DirectorySeparatorChar
    }

    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $declared = New-Object 'System.Collections.Generic.HashSet[string]'
    $loaderCount = 0
    # B6C is gzip-only: require exactly one gzip artifact per category.
    $frameworkGzCount = 0; $dataGzCount = 0; $wasmGzCount = 0

    foreach ($f in $m.files) {
        $rel = $f.path
        if ([string]::IsNullOrEmpty($rel)) { Fail "Manifest contains an empty file path." }
        if ($rel.Contains('\')) { Fail "Manifest path must use '/', not backslash: $rel" }
        if ([System.IO.Path]::IsPathRooted($rel)) { Fail "Manifest path must be relative: $rel" }
        foreach ($seg in ($rel -split '/')) {
            if ([string]::IsNullOrEmpty($seg) -or $seg -eq '.' -or $seg -eq '..') {
                Fail "Manifest path has an invalid segment ('', '.', or '..'): $rel"
            }
        }
        if (-not $declared.Add($rel)) { Fail "Manifest lists a duplicate path: $rel" }

        $candidate = [System.IO.Path]::GetFullPath((Join-Path $dir ($rel -replace '/', '\')))
        if (-not $candidate.StartsWith($canonicalDir, [System.StringComparison]::OrdinalIgnoreCase)) {
            Fail "Manifest path escapes the release directory: $rel"
        }
        if (-not (Test-Path -LiteralPath $candidate)) { Fail "Manifest file missing on disk: $rel" }
        $bytes = (Get-Item -LiteralPath $candidate).Length
        if ($bytes -ne [long]$f.bytes) { Fail "Byte count mismatch for ${rel}: manifest=$($f.bytes) actual=$bytes" }
        $sha = Get-Sha256Lower $candidate
        if ($sha -ne $f.sha256) { Fail "SHA-256 mismatch for $rel." }

        $null = $seen.Add($candidate.ToLowerInvariant())

        if ($rel -match '^Build/[^/]+\.loader\.js$')        { $loaderCount++ }
        if ($rel -match '^Build/[^/]+\.framework\.js\.gz$') { $frameworkGzCount++ }
        if ($rel -match '^Build/[^/]+\.data\.gz$')          { $dataGzCount++ }
        if ($rel -match '^Build/[^/]+\.wasm\.gz$')          { $wasmGzCount++ }
    }

    if ($loaderCount -ne 1) { Fail "Expected exactly one Build/*.loader.js, found $loaderCount." }
    $gzMsg = "B6C staging delivery currently supports gzip B6B releases only."
    if ($frameworkGzCount -ne 1) { Fail "Expected exactly one Build/*.framework.js.gz, found $frameworkGzCount. $gzMsg" }
    if ($dataGzCount -ne 1)      { Fail "Expected exactly one Build/*.data.gz, found $dataGzCount. $gzMsg" }
    if ($wasmGzCount -ne 1)      { Fail "Expected exactly one Build/*.wasm.gz, found $wasmGzCount. $gzMsg" }

    $templateDir = Join-Path $dir "TemplateData"
    if (-not (Test-Path -LiteralPath $templateDir) -or
        @(Get-ChildItem -LiteralPath $templateDir -Recurse -File).Count -eq 0) {
        Fail "TemplateData/ missing or empty."
    }

    # No undeclared extra files: the only allowed non-manifest files are the two
    # manifest artifacts themselves. Anything else (logs, tokens, .env, .vercel)
    # blocks the deploy.
    $manifestJsonFull = ([System.IO.Path]::GetFullPath($manifestPath)).ToLowerInvariant()
    $manifestShaFull  = ([System.IO.Path]::GetFullPath($shaPath)).ToLowerInvariant()
    foreach ($disk in (Get-ChildItem -LiteralPath $dir -Recurse -File)) {
        $full = $disk.FullName.ToLowerInvariant()
        if ($full -eq $manifestJsonFull -or $full -eq $manifestShaFull) { continue }
        if (-not $seen.Contains($full)) {
            $relDisk = $disk.FullName.Substring($canonicalDir.Length)
            Fail "Undeclared file present in release (not listed in manifest): $relDisk. Refusing to deploy."
        }
    }

    return $m
}

# ── Preflight (always) ────────────────────────────────────────────────────────
$dirty = @(Get-TrackedDirty)
if ($dirty.Count -gt 0) {
    Write-Host "Tracked working tree has content/index changes; commit/stash before deploying:" -ForegroundColor Yellow
    $dirty | ForEach-Object { Write-Host "  $_" }
    Fail "Refusing to deploy with a dirty tracked working tree."
}

$manifest = Test-SourceRelease $ReleaseDir $ReleaseVersion

# Deterministic UTC workspace name; created only in the real deploy path.
$stamp        = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$workspaceName = "$ReleaseVersion-$stamp"
$workspaceDir  = Join-Path $StagingRoot $workspaceName
$artifactBaseRel = "releases/$ReleaseVersion/"

# Optional: is the Vercel CLI available?
$vercelCmd = Get-Command vercel -ErrorAction SilentlyContinue

Write-Host "Penalty444 B6C staging-deploy preflight:"
Write-Host "  Repo root         : $RepoRoot"
Write-Host "  Release version   : $ReleaseVersion"
Write-Host "  Release directory : $ReleaseDir"
Write-Host "  Source commit     : $($manifest.sourceCommit)"
Write-Host "  Unity version     : $($manifest.unityVersion)"
Write-Host "  Manifest SHA-256  : $(Get-Sha256Lower (Join-Path $ReleaseDir 'manifest.json'))"
Write-Host "  File count        : $($manifest.fileCount)"
Write-Host "  Vercel project    : $VercelProject"
Write-Host "  Vercel team       : $(if ([string]::IsNullOrEmpty($VercelTeam)) { '<none>' } else { $VercelTeam })"
Write-Host "  Vercel template   : $TemplatePath"
Write-Host "  Planned workspace : $StagingRootRel\$workspaceName"
Write-Host "  Hosted base path  : /$artifactBaseRel (immutable, versioned)"
Write-Host "  Vercel CLI        : $(if ($vercelCmd) { $vercelCmd.Source } else { '<not found on PATH>' })"

if ($ValidateOnly) {
    Write-Host ""
    Write-Host ("ValidateOnly: preflight passed. Source release + manifest + every SHA-256 verified, " +
                "parameters and template validated, tracked tree content-clean. No workspace was created, " +
                "no files copied, no vercel link/deploy, and no network request was made.") -ForegroundColor Green
    exit 0
}

# ── Real staging deployment ───────────────────────────────────────────────────
if (-not $vercelCmd) { Fail "Vercel CLI ('vercel') not found on PATH. Install it before deploying." }

# Confirm authentication without printing/inspecting tokens.
& vercel whoami 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "Not authenticated with Vercel. Run 'vercel login' first." }

if (Test-Path -LiteralPath $workspaceDir) { Fail "Workspace already exists (refusing to overwrite): $workspaceDir" }
New-Item -ItemType Directory -Path $workspaceDir -Force | Out-Null

# Copy the source release CONTENTS into <workspace>/releases/<version>/ (source
# untouched, and without an extra nesting level). Enumerate with -LiteralPath so
# the release path is treated literally (no wildcard expansion).
$workspaceReleaseParent = Join-Path $workspaceDir "releases"
$workspaceReleaseDir    = Join-Path $workspaceReleaseParent $ReleaseVersion
New-Item -ItemType Directory -Path $workspaceReleaseDir -Force | Out-Null
$sourceItems = @(Get-ChildItem -LiteralPath $ReleaseDir -Force)
if ($sourceItems.Count -eq 0) { Fail "Verified source release unexpectedly has no items: $ReleaseDir" }
foreach ($item in $sourceItems) {
    Copy-Item -LiteralPath $item.FullName -Destination $workspaceReleaseDir -Recurse -Force
}

# Copy the committed Vercel header template to <workspace>/vercel.json.
Copy-Item -LiteralPath $TemplatePath -Destination (Join-Path $workspaceDir "vercel.json") -Force

# Re-verify the COPIED release before deploying.
$null = Test-SourceRelease $workspaceReleaseDir $ReleaseVersion

# Link the workspace to the pre-existing dedicated artifact project.
$linkArgs = @("link", "--cwd", $workspaceDir, "--yes", "--project", $VercelProject)
if (-not [string]::IsNullOrEmpty($VercelTeam)) { $linkArgs += @("--scope", $VercelTeam) }
Write-Host ""
Write-Host "Linking workspace to Vercel project '$VercelProject'..."
& vercel @linkArgs
if ($LASTEXITCODE -ne 0) {
    Fail ("vercel link failed. If the project does not exist, create '$VercelProject' manually in the " +
          "Vercel dashboard first (this script never creates a project). Then re-run.")
}

# Deploy a PREVIEW only (never --prod). Capture stdout/stderr/exit code.
$urlFile   = Join-Path $workspaceDir "deployment-url.txt"
$errFile   = Join-Path $workspaceDir "vercel-deploy-error.txt"
$deployArgs = @("deploy", "--cwd", $workspaceDir, "--yes")
if (-not [string]::IsNullOrEmpty($VercelTeam)) { $deployArgs += @("--scope", $VercelTeam) }

Write-Host "Creating Vercel PREVIEW deployment (no --prod)..."
& vercel @deployArgs 1> $urlFile 2> $errFile
$deployExit = $LASTEXITCODE
if ($deployExit -ne 0) {
    Write-Host "vercel deploy failed (exit $deployExit). See:" -ForegroundColor Yellow
    Write-Host "  $errFile"
    Fail "Staging deployment failed."
}

# stdout must resolve to exactly one HTTPS *.vercel.app deployment URL.
$urlMatches = @(
    (Get-Content -LiteralPath $urlFile -Raw) |
    Select-String -Pattern 'https://[A-Za-z0-9._-]+\.vercel\.app[^\s]*' -AllMatches |
    ForEach-Object { $_.Matches } | ForEach-Object { $_.Value }
) | Sort-Object -Unique
if ($urlMatches.Count -ne 1) {
    Fail "Expected exactly one https://*.vercel.app deployment URL in vercel output, found $($urlMatches.Count)."
}
$rawUrl = $urlMatches[0]
$uri = $null
if (-not [System.Uri]::TryCreate($rawUrl, [System.UriKind]::Absolute, [ref]$uri)) {
    Fail "Vercel deployment URL is not a valid absolute URL: $rawUrl"
}
if ($uri.Scheme -ne 'https') { Fail "Deployment URL scheme must be https: $rawUrl" }
if (-not $uri.Host.EndsWith(".vercel.app")) { Fail "Deployment URL host must end with .vercel.app: $rawUrl" }
if (-not [string]::IsNullOrEmpty($uri.UserInfo)) { Fail "Deployment URL must not contain credentials: $rawUrl" }
if (-not [string]::IsNullOrEmpty($uri.Query)) { Fail "Deployment URL must not contain a query: $rawUrl" }
if (-not [string]::IsNullOrEmpty($uri.Fragment)) { Fail "Deployment URL must not contain a fragment: $rawUrl" }
if ($uri.AbsolutePath -ne '/') { Fail "Deployment URL path must be '/': $rawUrl" }
if (-not $uri.IsDefaultPort) { Fail "Deployment URL must use the default HTTPS port: $rawUrl" }
# Normalize to scheme + authority (no path/query/fragment, no trailing slash).
$deploymentUrl = ("{0}://{1}" -f $uri.Scheme, $uri.Authority)
Write-Host "Deployment URL: $deploymentUrl" -ForegroundColor Green

# ── Independent post-deployment HTTP verification ─────────────────────────────
$artifactBaseUrl = "$deploymentUrl/releases/$ReleaseVersion"

# Raw header probe (no auto-redirect, no auto-decompression) so Content-Encoding
# survives for gzip payloads. Bounded timeout; no indefinite retry.
function Invoke-HttpProbe([string] $url, [int] $timeoutSec = 30) {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = "GET"
    $req.AllowAutoRedirect = $false
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::None
    $req.Timeout = $timeoutSec * 1000
    $req.ReadWriteTimeout = $timeoutSec * 1000
    try {
        $resp = $req.GetResponse()
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) { $resp = $_.Exception.Response } else { throw }
    }
    $status = [int]$resp.StatusCode
    $headers = @{}
    foreach ($key in $resp.Headers.AllKeys) { $headers[$key] = $resp.Headers[$key] }
    $resp.Close()
    return [pscustomobject]@{ Status = $status; Headers = $headers }
}

function Require-200([string] $relPath) {
    $u = "$artifactBaseUrl/$relPath"
    $p = Invoke-HttpProbe $u
    if ($p.Status -ne 200) { Fail "Expected HTTP 200 for $relPath, got $($p.Status)." }
    return $p
}

function Require-Header($probe, [string] $name, [string] $mustContain, [string] $rel) {
    $val = $probe.Headers[$name]
    if (-not $val) { Fail "Missing header $name on $rel." }
    if ($val.ToLowerInvariant().IndexOf($mustContain.ToLowerInvariant()) -lt 0) {
        Fail "Header $name on $rel = '$val'; expected to contain '$mustContain'."
    }
}

# Resolve concrete artifact filenames from the manifest.
function Find-ManifestPath([string] $pattern) {
    $hit = @($manifest.files | Where-Object { $_.path -match $pattern }) | Select-Object -First 1
    if (-not $hit) { Fail "No manifest file matched $pattern for HTTP verification." }
    return $hit.path
}
# B6C is gzip-only, so resolve the exact gzip artifact roles (Test-SourceRelease
# already guaranteed exactly one of each).
$loaderPath    = Find-ManifestPath '^Build/[^/]+\.loader\.js$'
$frameworkPath = Find-ManifestPath '^Build/[^/]+\.framework\.js\.gz$'
$dataPath      = Find-ManifestPath '^Build/[^/]+\.data\.gz$'
$wasmPath      = Find-ManifestPath '^Build/[^/]+\.wasm\.gz$'
$templatePath1 = Find-ManifestPath '^TemplateData/.+'

Write-Host "Verifying hosted artifact over HTTP..."
$null = Require-200 "index.html"
$null = Require-200 "manifest.json"
$null = Require-200 "manifest.sha256"
$null = Require-200 $loaderPath
$frameworkProbe = Require-200 $frameworkPath
$dataProbe      = Require-200 $dataPath
$wasmProbe      = Require-200 $wasmPath
$null = Require-200 $templatePath1

# gzip payload headers (always gzip in B6C).
Require-Header $frameworkProbe "Content-Type" "application/javascript" $frameworkPath
Require-Header $frameworkProbe "Content-Encoding" "gzip" $frameworkPath
Require-Header $wasmProbe "Content-Type" "application/wasm" $wasmPath
Require-Header $wasmProbe "Content-Encoding" "gzip" $wasmPath
Require-Header $dataProbe "Content-Type" "application/octet-stream" $dataPath
Require-Header $dataProbe "Content-Encoding" "gzip" $dataPath

# Security/immutability headers on the general release path (index.html).
$indexProbe = Invoke-HttpProbe "$artifactBaseUrl/index.html"
Require-Header $indexProbe "X-Content-Type-Options" "nosniff" "index.html"
Require-Header $indexProbe "X-Frame-Options" "SAMEORIGIN" "index.html"
Require-Header $indexProbe "Cache-Control" "immutable" "index.html"

Write-Host "HTTP verification passed." -ForegroundColor Green

# ── Local deployment record (inside the ignored workspace only) ───────────────
$record = [ordered]@{
    schemaVersion          = 1
    game                   = $Game
    releaseVersion         = $ReleaseVersion
    deploymentUrl          = $deploymentUrl
    artifactBaseUrl        = $artifactBaseUrl
    vercelProject          = $VercelProject
    vercelTeam             = if ([string]::IsNullOrEmpty($VercelTeam)) { $null } else { $VercelTeam }
    sourceCommit           = $manifest.sourceCommit
    unityVersion           = $manifest.unityVersion
    manifestSha256         = Get-Sha256Lower (Join-Path $ReleaseDir 'manifest.json')
    fileCount              = $manifest.fileCount
    totalArtifactBytes     = $manifest.totalArtifactBytes
    compressedPayloadBytes = $manifest.compressedPayloadBytes
    compressionMode        = $manifest.compressionMode
    deployedAtUtc          = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    verificationStatus     = "passed"
}
$recordPath = Join-Path $workspaceDir "staging-deployment.json"
($record | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $recordPath -Encoding UTF8

Write-Host ""
Write-Host "B6C staging deployment verified." -ForegroundColor Green
Write-Host "  Deployment URL    : $deploymentUrl"
Write-Host "  Artifact base URL : $artifactBaseUrl/"
Write-Host "  Hosted index      : $artifactBaseUrl/index.html"
Write-Host "  Deployment record : $StagingRootRel\$workspaceName\staging-deployment.json"
Write-Host ""
Write-Host ("Next (manual, separate step): set UNITY_STAGING_ARTIFACT_ORIGIN=$deploymentUrl on the MAIN " +
            "Next.js PREVIEW deployment only, then open /dev/unity-staging?version=$ReleaseVersion.") -ForegroundColor Cyan
exit 0
