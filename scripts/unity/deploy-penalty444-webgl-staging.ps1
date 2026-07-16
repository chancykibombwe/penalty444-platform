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

# ── Single reviewed native-process helper (Windows PowerShell 5.1 safe) ────────
# Runs a native command (git, vercel.cmd, …) capturing stdout, stderr and the
# real exit code SEPARATELY. Under Set-StrictMode + ErrorActionPreference=Stop,
# PS 5.1 turns harmless native stderr (e.g. Git CRLF/line-ending warnings, Vercel
# progress) into a terminating NativeCommandError. Redirecting stderr to a temp
# file with ErrorActionPreference temporarily relaxed avoids that WITHOUT hiding
# genuine failures — callers still branch on ExitCode. stderr text is never mixed
# into the parsed stdout lines. No shell string evaluation; args pass through the
# call operator so quoting (incl. paths with spaces) is handled by PowerShell.
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)] [string] $Exe,
        [string[]] $NativeArgs = @()
    )
    $errFile = [System.IO.Path]::GetTempFileName()
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $stdout = @()
    $code = $null
    try {
        $stdout = @(& $Exe @NativeArgs 2> $errFile)
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEAP
    }
    $stderr = ""
    if (Test-Path -LiteralPath $errFile) {
        $raw = Get-Content -LiteralPath $errFile -Raw -ErrorAction SilentlyContinue
        if ($null -ne $raw) { $stderr = $raw }
        Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
    }
    if ($null -eq $code) { $code = 1 }
    return [pscustomobject]@{
        StdOut   = $stdout            # array of stdout lines (no stderr mixed in)
        StdErr   = $stderr            # captured stderr text (warnings/progress)
        ExitCode = [int]$code
    }
}

# StrictMode-safe property existence check (missing property -> $false, no throw).
function Test-PSProp($obj, [string] $name) {
    if ($null -eq $obj) { return $false }
    return ($null -ne $obj.PSObject.Properties[$name])
}

# ── Dedicated Vercel deployment-URL parser ────────────────────────────────────
# Resolves the immutable preview deployment origin from the captured `vercel
# deploy` stdout, supporting exactly two strict contracts and nothing else:
#   1. The structured JSON form (Vercel CLI 56.2.0): the URL comes ONLY from
#      deployment.url, gated on status=ok, deployment.id (dpl_…), readyState=READY,
#      and target being null/empty (preview / non-prod). inspectorUrl,
#      deploymentApiUrl, message and next[] are ignored — never a source of a URL.
#   2. The documented plain-URL form: exactly one non-empty stdout line that IS a
#      bare https://*.vercel.app URL.
# It never scans prose for embedded URLs and never reads stderr for a URL. The
# single candidate is then run through full System.Uri validation, the exact
# project/production alias is rejected, and the result is normalized to
# scheme + authority. Does not modify deployment-url.txt.
function Resolve-VercelDeploymentUrl {
    param(
        [Parameter(Mandatory = $true)] [AllowEmptyCollection()] [string[]] $StdoutLines,
        [Parameter(Mandatory = $true)] [string] $ExpectedProject
    )
    $trimmed = (($StdoutLines -join "`n")).Trim()
    if ([string]::IsNullOrEmpty($trimmed)) {
        Fail "vercel deploy produced no stdout to parse for a deployment URL."
    }

    $candidate = $null
    if ($trimmed.StartsWith("{")) {
        # ── Strict JSON form. No regex/plain fallback if JSON parsing fails. ──
        $obj = $null
        try {
            $obj = $trimmed | ConvertFrom-Json
        } catch {
            Fail "vercel deploy stdout began with '{' but is not valid JSON; refusing any regex/plain fallback."
        }
        if (-not (Test-PSProp $obj 'status')) { Fail "Vercel JSON output missing 'status'." }
        if ($obj.status -ne 'ok') { Fail "Vercel JSON 'status' is not 'ok' (got '$($obj.status)')." }
        if (-not (Test-PSProp $obj 'deployment')) { Fail "Vercel JSON output missing 'deployment'." }
        $dep = $obj.deployment
        if ($null -eq $dep) { Fail "Vercel JSON 'deployment' is null." }
        if (-not (Test-PSProp $dep 'id')) { Fail "Vercel JSON 'deployment.id' missing." }
        $depId = [string]$dep.id
        if ([string]::IsNullOrEmpty($depId) -or ($depId -notmatch '^dpl_[A-Za-z0-9]+$')) {
            Fail "Vercel JSON 'deployment.id' is not a valid 'dpl_' identifier."
        }
        if (-not (Test-PSProp $dep 'url')) { Fail "Vercel JSON 'deployment.url' missing." }
        if ([string]::IsNullOrEmpty([string]$dep.url)) { Fail "Vercel JSON 'deployment.url' is empty." }
        if (-not (Test-PSProp $dep 'readyState')) { Fail "Vercel JSON 'deployment.readyState' missing." }
        if ($dep.readyState -ne 'READY') { Fail "Vercel JSON 'deployment.readyState' is not READY (got '$($dep.readyState)')." }
        if (-not (Test-PSProp $dep 'target')) { Fail "Vercel JSON 'deployment.target' property missing." }
        if (-not [string]::IsNullOrEmpty([string]$dep.target)) {
            Fail "Vercel JSON 'deployment.target' is '$($dep.target)'; expected null/empty (preview, non-prod)."
        }
        $candidate = [string]$dep.url
    } else {
        # ── Strict plain-URL form: exactly one bare https://*.vercel.app line. ──
        $lines = @($StdoutLines | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
        if ($lines.Count -ne 1) {
            Fail "Expected exactly one non-empty plain stdout line with the deployment URL, found $($lines.Count)."
        }
        if ($lines[0] -notmatch '^https://[A-Za-z0-9.-]+\.vercel\.app/?$') {
            Fail "Plain vercel stdout line is not a bare https://*.vercel.app URL."
        }
        $candidate = $lines[0]
    }

    # ── Retained System.Uri validation for the single candidate. ──
    $u = $null
    if (-not [System.Uri]::TryCreate($candidate, [System.UriKind]::Absolute, [ref]$u)) {
        Fail "Vercel deployment URL is not a valid absolute URL: $candidate"
    }
    if ($u.Scheme -ne 'https') { Fail "Deployment URL scheme must be https: $candidate" }
    if (-not $u.Host.EndsWith(".vercel.app")) { Fail "Deployment URL host must end with .vercel.app: $candidate" }
    if (-not [string]::IsNullOrEmpty($u.UserInfo)) { Fail "Deployment URL must not contain credentials: $candidate" }
    if (-not [string]::IsNullOrEmpty($u.Query)) { Fail "Deployment URL must not contain a query: $candidate" }
    if (-not [string]::IsNullOrEmpty($u.Fragment)) { Fail "Deployment URL must not contain a fragment: $candidate" }
    if ($u.AbsolutePath -ne '/') { Fail "Deployment URL path must be '/': $candidate" }
    if (-not $u.IsDefaultPort) { Fail "Deployment URL must use the default HTTPS port: $candidate" }

    # Explicitly reject the exact project/production alias.
    if ($u.Host -eq ("{0}.vercel.app" -f $ExpectedProject)) {
        Fail ("Deployment URL is the project/production alias ($candidate). B6C requires the GENERATED " +
              "immutable preview deployment URL, not the project/production alias.")
    }

    # Normalize to scheme + authority (no path/query/fragment, no trailing slash).
    return ("{0}://{1}" -f $u.Scheme, $u.Authority)
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
function Invoke-Git([string[]] $GitArgs, [string] $what) {
    $r = Invoke-Native "git" (@("-C", $RepoRoot) + $GitArgs)
    # Non-zero exit is a real failure; harmless stderr (CRLF/line-ending warnings)
    # on a zero exit is ignored and never mixed into the returned path lines.
    if ($r.ExitCode -ne 0) { Fail "$what failed (exit $($r.ExitCode)): $($r.StdErr.Trim())" }
    return @($r.StdOut | Where-Object { $_ -and $_.Trim().Length -gt 0 })
}

function Get-TrackedDirty {
    $porcelain = @(Invoke-Git @("status", "--porcelain", "--untracked-files=no") "git status")
    if ($porcelain.Count -eq 0) { return @() }

    $unstaged = @(Invoke-Git @("diff", "--name-only") "git diff")
    $staged   = @(Invoke-Git @("diff", "--cached", "--name-only") "git diff --cached")
    $unmerged = @(Invoke-Git @("diff", "--name-only", "--diff-filter=U") "git diff --diff-filter=U")

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

    # Source commit must exist in this repository (PS 5.1-safe native call).
    $cf = Invoke-Native "git" @("-C", $RepoRoot, "cat-file", "-e", ("{0}^{{commit}}" -f $m.sourceCommit))
    if ($cf.ExitCode -ne 0) { Fail "manifest sourceCommit $($m.sourceCommit) is not a known Git commit." }

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
$VercelExe = $vercelCmd.Source

# Optional --scope <team> suffix, added only when a team was supplied.
$scopeArgs = @()
if (-not [string]::IsNullOrEmpty($VercelTeam)) { $scopeArgs = @("--scope", $VercelTeam) }

# Confirm authentication without printing/inspecting tokens (PS 5.1-safe).
$who = Invoke-Native $VercelExe (@("whoami") + $scopeArgs)
if ($who.ExitCode -ne 0) {
    Fail "Not authenticated with Vercel (vercel whoami exit $($who.ExitCode)). Run 'vercel login' first."
}

# The dedicated artifact project MUST already exist. Verify before linking; never
# create a project. (Uses the same native discipline; progress on stderr is fine.)
$inspect = Invoke-Native $VercelExe (@("project", "inspect", $VercelProject) + $scopeArgs)
if ($inspect.ExitCode -ne 0) {
    Fail ("Vercel project '$VercelProject' was not found or is not accessible" +
          $(if ($scopeArgs.Count) { " for scope '$VercelTeam'" } else { "" }) +
          ". Create the dedicated artifact project manually in the Vercel dashboard first; " +
          "this script never creates a project.")
}

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

# Link the workspace to the pre-existing dedicated artifact project (PS 5.1-safe).
$linkArgs = @("link", "--cwd", $workspaceDir, "--yes", "--project", $VercelProject) + $scopeArgs
Write-Host ""
Write-Host "Linking workspace to Vercel project '$VercelProject'..."
$link = Invoke-Native $VercelExe $linkArgs
if ($link.ExitCode -ne 0) {
    Fail ("vercel link failed (exit $($link.ExitCode)). Confirm '$VercelProject' exists" +
          $(if ($scopeArgs.Count) { " under scope '$VercelTeam'" } else { "" }) +
          " (this script never creates a project). Details: $($link.StdErr.Trim())")
}

# Deploy a PREVIEW only (never --prod). Capture stdout/stderr/exit separately.
$urlFile    = Join-Path $workspaceDir "deployment-url.txt"
$errFile    = Join-Path $workspaceDir "vercel-deploy-error.txt"
$deployArgs = @("deploy", "--cwd", $workspaceDir, "--yes") + $scopeArgs

Write-Host "Creating Vercel PREVIEW deployment (no --prod)..."
$deploy = Invoke-Native $VercelExe $deployArgs
Set-Content -LiteralPath $urlFile -Value ($deploy.StdOut -join "`n") -Encoding UTF8
Set-Content -LiteralPath $errFile -Value $deploy.StdErr -Encoding UTF8
if ($deploy.ExitCode -ne 0) {
    Write-Host "vercel deploy failed (exit $($deploy.ExitCode)). See:" -ForegroundColor Yellow
    Write-Host "  $errFile"
    Fail "Staging deployment failed."
}

# Resolve the immutable preview deployment origin from the captured stdout via the
# dedicated parser (strict JSON form from Vercel CLI 56.2.0, or the plain-URL
# form). deployment-url.txt already holds the complete unmodified stdout above.
$deploymentUrl = Resolve-VercelDeploymentUrl -StdoutLines $deploy.StdOut -ExpectedProject $VercelProject
Write-Host "Deployment URL: $deploymentUrl" -ForegroundColor Green

# ── Independent post-deployment HTTP verification ─────────────────────────────
$artifactBaseUrl = "$deploymentUrl/releases/$ReleaseVersion"

# Raw header probe (no auto-redirect, no auto-decompression) so Content-Encoding
# survives for gzip payloads. Bounded per-request timeout. A network failure with
# NO HTTP response (DNS/name-resolution, connect, timeout, transport) returns
# Status 0 + NetworkError so the caller can treat it as a transient propagation
# condition rather than crashing; any actual HTTP response (incl. 3xx/4xx/5xx) is
# returned with its status.
function Invoke-HttpProbe([string] $url, [int] $timeoutMs) {
    if ($timeoutMs -lt 1) { $timeoutMs = 1 }   # HttpWebRequest requires a positive timeout.
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = "GET"
    $req.AllowAutoRedirect = $false
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::None
    $req.Timeout = $timeoutMs
    $req.ReadWriteTimeout = $timeoutMs
    $resp = $null
    try {
        $resp = $req.GetResponse()
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $resp = $_.Exception.Response
        } else {
            return [pscustomobject]@{ Status = 0; Headers = @{}; NetworkError = $_.Exception.Message }
        }
    }
    $status = [int]$resp.StatusCode
    $headers = @{}
    foreach ($key in $resp.Headers.AllKeys) { $headers[$key] = $resp.Headers[$key] }
    $resp.Close()
    return [pscustomobject]@{ Status = $status; Headers = $headers; NetworkError = $null }
}

# Transient conditions that can occur while a brand-new deployment's hostname is
# still propagating (DNS/readiness). These are retried until the SHARED window.
$TransientHttpStatuses = @(404, 408, 425, 429, 500, 502, 503, 504)
# ONE monotonic verification window shared by every artifact (see §9). The clock
# is started once, immediately before verification begins.
$VerifyWindowMs = 90000

# Centralized deadline-expiry failure so every expiry path reports identically.
# Never deletes, redeploys, promotes, aliases, or alters the deployment.
function Invoke-DeadlineFailure([string] $relPath, [int] $attempt, [string] $lastCondition) {
    Fail (
        "Artifact readiness/verification window ($([int]($VerifyWindowMs / 1000))s total) expired before " +
        "$relPath was reachable.`n" +
        "  - Deployment URL : $deploymentUrl`n" +
        "  - Last path      : $relPath`n" +
        "  - Attempts       : $attempt`n" +
        "  - Last condition : $lastCondition`n" +
        "  - The deployment itself may exist; the workspace is preserved for inspection.`n" +
        "  - This script never creates another deployment — inspect the preserved workspace and " +
        "the deployment before rerunning."
    )
}

# Poll one artifact path until HTTP 200 or the SHARED monotonic window elapses.
# Every request timeout is clamped to the remaining shared time; the clock is
# re-checked after each request (a late 200 past the window is NOT accepted); the
# poll sleep is clamped to remaining time. Transient network failures (Status 0)
# and transient HTTP statuses are retried; non-transient conditions FAIL FAST.
# Never retries the deployment itself — only HTTP readiness requests.
function Wait-For200([string] $relPath) {
    $url = "$artifactBaseUrl/$relPath"
    $attempt = 0
    $lastCondition = "(none)"
    while ($true) {
        # Do not START a request after the shared window has expired.
        $remainingMs = $VerifyWindowMs - $VerifyClock.ElapsedMilliseconds
        if ($remainingMs -le 0) { Invoke-DeadlineFailure $relPath $attempt $lastCondition }

        $attempt++
        $timeoutMs = [Math]::Min(20000, $remainingMs)   # cap per-request at 20s, clamp to remaining
        $p = Invoke-HttpProbe $url $timeoutMs

        # Re-check the shared clock AFTER the request. Never accept a late HTTP 200
        # (or anything else) once the total window has elapsed.
        if (($VerifyWindowMs - $VerifyClock.ElapsedMilliseconds) -le 0) {
            $cond = if ($p.Status -eq 0) { "network: $($p.NetworkError)" } else { "HTTP $($p.Status)" }
            Invoke-DeadlineFailure $relPath $attempt $cond
        }

        if ($p.Status -eq 200) { return $p }

        # ── Fail-fast: redirect to Vercel Authentication / SSO (protection). ──
        if (@(301, 302, 307, 308) -contains $p.Status) {
            $loc = $p.Headers["Location"]
            if ($loc -and ($loc -match '(?i)sso-api|/sso|vercel\.com/sso|vercel\.com/login|authenticate')) {
                Fail (
                    "Artifact request for $relPath returned HTTP $($p.Status) redirecting to Vercel " +
                    "Authentication ($loc).`n" +
                    "  - The immutable preview is protected by Vercel Authentication.`n" +
                    "  - B6C requires the dedicated artifact preview to be ANONYMOUSLY reachable so the " +
                    "main app's server-side rewrite can fetch it.`n" +
                    "  - Change deployment protection ONLY on the dedicated artifact project " +
                    "'penalty444-unity-staging'.`n" +
                    "  - Do NOT change protection on the main application project 'penalty444-platform-at1y'.`n" +
                    "  - Do NOT use the production/project alias; use only the generated immutable deployment URL.`n" +
                    "  - Re-run this script after adjusting the artifact project's protection."
                )
            }
            Fail "Unexpected HTTP $($p.Status) redirect for ${relPath} -> $loc"
        }
        # ── Fail-fast: auth/permission/bad-request and other non-transient 4xx. ──
        if (@(400, 401, 403) -contains $p.Status) {
            Fail "Non-transient HTTP $($p.Status) for ${relPath} (bad request / auth / permission) — not a propagation delay."
        }
        if ($p.Status -ge 400 -and $p.Status -lt 500 -and (-not ($TransientHttpStatuses -contains $p.Status))) {
            Fail "Non-transient HTTP $($p.Status) for ${relPath}."
        }

        # ── Transient: network failure (no response) or a transient HTTP status. ──
        if ($p.Status -eq 0) {
            $lastCondition = "network: $($p.NetworkError)"
        } elseif ($TransientHttpStatuses -contains $p.Status) {
            $lastCondition = "HTTP $($p.Status)"
        } else {
            # Anything else (unexpected 3xx/5xx not classified above) fails fast.
            Fail "Unexpected HTTP $($p.Status) for ${relPath}."
        }

        # Clamp the poll sleep to the remaining shared time; never overshoot.
        $remainingMs = $VerifyWindowMs - $VerifyClock.ElapsedMilliseconds
        if ($remainingMs -le 0) { Invoke-DeadlineFailure $relPath $attempt $lastCondition }
        $sleepMs = [Math]::Min(2000, $remainingMs)
        if ($sleepMs -lt 1) { $sleepMs = 1 }
        Write-Host "  waiting for $relPath (attempt $attempt, last: $lastCondition)…" -ForegroundColor DarkGray
        Start-Sleep -Milliseconds $sleepMs
    }
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

# ONE shared, monotonic, bounded readiness/verification window ($VerifyWindowMs
# total) — not a fresh window per file. Started once, here, immediately before
# verification. A monotonic Stopwatch (not wall-clock) so the total window is
# strictly enforced: every request timeout is clamped to the remaining time, the
# clock is re-checked after each request (a late 200 is rejected), and the poll
# sleep is clamped to the remaining time. Tolerates immediate post-deploy
# DNS/readiness propagation (the hostname can take ~15s to resolve) without ever
# redeploying.
$VerifyClock = [System.Diagnostics.Stopwatch]::StartNew()

Write-Host "Verifying hosted artifact over HTTP (shared $([int]($VerifyWindowMs / 1000))s monotonic window, ~2s polling)..."
# index.html first: this is the propagation gate for the whole deployment.
$indexProbe     = Wait-For200 "index.html"
$null           = Wait-For200 "manifest.json"
$null           = Wait-For200 "manifest.sha256"
$null           = Wait-For200 $loaderPath
$frameworkProbe = Wait-For200 $frameworkPath
$dataProbe      = Wait-For200 $dataPath
$wasmProbe      = Wait-For200 $wasmPath
$null           = Wait-For200 $templatePath1

# gzip payload headers (always gzip in B6C). Header mismatches after a 200 fail
# immediately — they are not a propagation condition.
Require-Header $frameworkProbe "Content-Type" "application/javascript" $frameworkPath
Require-Header $frameworkProbe "Content-Encoding" "gzip" $frameworkPath
Require-Header $wasmProbe "Content-Type" "application/wasm" $wasmPath
Require-Header $wasmProbe "Content-Encoding" "gzip" $wasmPath
Require-Header $dataProbe "Content-Type" "application/octet-stream" $dataPath
Require-Header $dataProbe "Content-Encoding" "gzip" $dataPath

# Security/immutability headers on the general release path (reuse the index probe
# already confirmed 200 — no extra fetch, no race).
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
