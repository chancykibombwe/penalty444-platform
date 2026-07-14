# Unity B6B — Local Release Builder and Artifact Manifest

> **Local tooling only.** This phase adds a committed, repeatable **local** Unity
> WebGL release-build command, an immutable versioned output layout, a
> machine-readable artifact manifest with SHA-256 checksums, and an independent
> post-build verification step. It adds **no** publishing, **no** storage/CDN,
> **no** Vercel change, **no** CI Unity build, **no** production activation, and
> **no** change to the React renderer, gameplay, the Unity presentation scene, or
> the bridge behavior.
>
> The B6A production decision (`docs/unity-b6a-production-readiness-audit.md`)
> remains **NO-GO**. B6B does not flip any production gate to PASS and does not
> authorize B6C.

---

## 1. Scope and non-goals

**B6B adds (local only):**

- A committed Unity Editor build entry point:
  `unity/Penalty444Client/Assets/Editor/Penalty444WebGLReleaseBuilder.cs`
  (`Penalty444.Editor.Penalty444WebGLReleaseBuilder.BuildFromCommandLine`).
- A committed PowerShell wrapper for a non-developer Windows operator:
  `scripts/unity/build-penalty444-webgl-release.ps1`.
- An **immutable, versioned** local output folder per release under
  `apps/web/public/unity/penalty444/releases/<version>/` (still git-ignored via
  the existing `apps/web/public/unity/penalty444/` rule — see §5).
- A machine-readable `manifest.json` (schemaVersion 1) with per-file SHA-256
  checksums, plus a `manifest.sha256` self-checksum.
- Independent, post-build manifest + checksum verification inside the wrapper.

**B6B explicitly does NOT:**

- Upload, publish, or distribute artifacts anywhere.
- Select or configure object storage, a CDN, or any hosting provider.
- Modify Vercel configuration or deployment.
- Install or activate Unity in GitHub Actions / CI.
- Activate Unity in production or change any feature flag default.
- Modify the React renderer (`MatchRenderer3D.tsx`), gameplay, match authority,
  the Unity presentation scene, or the Unity↔React bridge behavior.
- Commit any generated WebGL output.
- Prove cross-machine reproducibility, bit-for-bit determinism, or any
  production performance / compatibility / security result.

## 2. Pinned Unity editor version

The release build **requires** the editor version pinned in
`unity/Penalty444Client/ProjectSettings/ProjectVersion.txt`
(`m_EditorVersion`), currently **`6000.4.2f1`**.

Both layers enforce this:

- The **wrapper** reads `m_EditorVersion` and resolves the Unity executable from
  `-UnityEditorPath` (must exist) or the default Hub path
  `C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe`.
- The **editor build entry point** re-reads `m_EditorVersion` and **fails** the
  build unless it exactly equals `Application.unityVersion` of the running
  editor. A mismatched editor aborts with a non-zero exit and no manifest.

## 3. What the build guarantees before it runs

The build refuses to proceed unless all of these hold:

1. **Clean tracked working tree** — the wrapper runs
   `git status --porcelain --untracked-files=no` and refuses to build if any
   **tracked** file is dirty. (The git-ignored WebGL output does not count.)
2. **Valid source commit** — the wrapper resolves the full 40-hex `git HEAD` and
   passes it to the build; the editor entry point re-validates the 40-hex shape
   and records it (lowercased) as the manifest `sourceCommit`.
3. **Valid version** — `-Version` must match
   `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (no slash, backslash, `..`, or path
   traversal). `-PreviousVersion` must match the same pattern or be empty.
4. **Non-empty release notes** — `-ReleaseNotes` must be non-empty after
   decoding.
5. **New immutable output** — if
   `apps/web/public/unity/penalty444/releases/<version>/` already exists, the
   build refuses. Existing releases are never overwritten; use a **new**
   `-Version` for every attempt.
6. **Correct editor version** — see §2.
7. **WebGL build support** — the editor entry point checks
   `BuildPipeline.IsBuildTargetSupported(BuildTargetGroup.WebGL, BuildTarget.WebGL)`.
8. **Fixed scene present** — the build always builds exactly
   `Assets/Scenes/Penalty444Prototype.unity` (the same prototype scene; no scene
   selection, no gameplay change).

## 4. Commands

Run from the **repository root** on Windows. These commands contain no
machine-specific absolute paths; supply `-UnityEditorPath` only if your Unity
install is not at the default Hub location.

**Configuration validation only (does NOT launch Unity, creates NO output):**

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/unity/build-penalty444-webgl-release.ps1 -Version "b6b-validation" -ReleaseNotes "B6B configuration validation only." -ValidateOnly
```

`-ValidateOnly` reads the pinned project version from `ProjectVersion.txt`,
confirms the expected/`-UnityEditorPath` editor executable path exists, and
validates the Git / source-commit / version / output-directory preflight (clean
tracked tree, valid version pattern, target release directory free). It prints
the planned `-executeMethod`, then exits **without** launching Unity and
**without** creating any output directory.

`-ValidateOnly` does **not** prove a custom `-UnityEditorPath` executable's exact
runtime version (it only checks the file exists). The real Unity build entry
point enforces `Application.unityVersion == ProjectVersion.txt` before building
(see §2), so a wrong editor is rejected at build time.

**Real local release build:**

Compute a short commit SHA first, then pass it into `-Version`:

```
$shortSha = (git rev-parse --short=8 HEAD).Trim()

powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/unity/build-penalty444-webgl-release.ps1 `
  -Version "b6b-local-$shortSha-a" `
  -ReleaseNotes "B6B local release validation."
```

This launches Unity in batchmode
(`-batchmode -quit -nographics -projectPath ... -executeMethod
Penalty444.Editor.Penalty444WebGLReleaseBuilder.BuildFromCommandLine -logFile -`),
builds the fixed scene into the new versioned directory, writes the manifest and
its self-checksum, and then independently verifies them (see §7).

> Running the real build requires a local Unity **6000.4.2f1** install with
> WebGL Build Support. It has **not** been run in CI or in the review sandbox;
> the operator must run it locally and a runtime check is required before this
> tooling is trusted (see §10).

## 5. Immutable, versioned, git-ignored output

- Output path: `apps/web/public/unity/penalty444/releases/<version>/`.
- This sits under the existing git-ignored `apps/web/public/unity/penalty444/`
  rule, so **no generated release output is ever committed**.
- Each `<version>` directory is written **once** and never modified by this
  tooling. Rebuilding requires a **new** version. This is *local* immutability
  (the builder refuses to overwrite), not a hosted/immutable-URL guarantee.

## 6. Artifact validation (inside the editor build)

After `BuildPipeline.BuildPlayer` reports success, the editor entry point
validates the output before writing the manifest:

- `index.html` is present.
- Exactly **one** `Build/*.loader.js` exists.
- At least one framework, one data, and one wasm artifact exist
  (`.js` / `.gz` / `.br` variants accepted).
- `TemplateData/` is present and non-empty.

Any failed check aborts with a non-zero exit; a partial directory may remain
(see §9).

## 7. Manifest contract (`manifest.json`, schemaVersion 1)

The manifest is written as **UTF-8 without BOM**, with hand-serialized JSON so
the bytes are exact. Top-level fields:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `game` | `"penalty444"` |
| `releaseVersion` | the `-Version` value |
| `buildTarget` | `"WebGL"` |
| `unityVersion` | `Application.unityVersion` of the building editor |
| `sourceCommit` | 40-hex lowercased git HEAD at build time |
| `scene` | `"Assets/Scenes/Penalty444Prototype.unity"` |
| `buildTimestampUtc` | UTC build time (`yyyy-MM-ddTHH:mm:ssZ`) |
| `previousVersion` | `-PreviousVersion` or `null` |
| `releaseNotes` | decoded `-ReleaseNotes` text |
| `compressionMode` | derived from main payload encodings (`gzip` / `br` / `identity` / `mixed`) |
| `totalArtifactBytes` | sum of all listed file bytes |
| `compressedPayloadBytes` | sum of `.gz` / `.br` payload bytes |
| `fileCount` | number of listed files |
| `files[]` | per file: `path` (forward-slash, ordinal-sorted), `bytes`, `sha256` (lowercase hex), `contentEncoding` (`gzip` / `br` / `identity`) |

`manifest.json` and `manifest.sha256` are **excluded** from the enumerated
`files[]`.

### Self-checksum (`manifest.sha256`)

`manifest.sha256` contains the SHA-256 of the exact `manifest.json` bytes in the
form `<hash>  manifest.json\n`. Because the manifest is serialized with exact
byte control, this hash is computed over the precise final bytes on disk and can
be re-verified independently.

## 8. Independent post-build verification (wrapper)

After Unity exits 0, the wrapper **re-verifies** the artifact without trusting
the editor's own report:

- `manifest.json` and `manifest.sha256` exist.
- `releaseVersion` matches `-Version`; `sourceCommit` matches the pre-build HEAD;
  `unityVersion` matches `ProjectVersion.txt`.
- For every `files[]` entry: the file exists, its byte length matches, and its
  recomputed `Get-FileHash` SHA-256 matches.
- `manifest.sha256` matches a freshly recomputed hash of `manifest.json`.
- Required artifact categories are present (one loader, plus framework / data /
  wasm, plus non-empty `TemplateData/`).
- The tracked working tree is **still** clean — Unity must not have modified any
  tracked project file. The wrapper never stages, resets, or commits anything;
  if tracked files changed, it reports them and fails for manual review.

## 9. Failure and partial-output behavior

- On any failure the process exits **non-zero**.
- A **partial** release directory may remain on disk. This tooling does **not**
  auto-delete, auto-reset, auto-stage, or auto-commit anything, and never
  uploads a partial build.
- Because releases are immutable, the next attempt must use a **new** `-Version`.
  The operator removes partial/unwanted directories manually (they are
  git-ignored and safe to delete).

## 10. Runtime test required before this tooling is trusted / merged

The C# entry point and the PowerShell wrapper **cannot** be compiled or executed
in the review sandbox (no Unity editor, no Windows PowerShell runtime for the
build path). Pre-PR validation covers only web/realtime typecheck+build
regression and file-scope hygiene. Before this tooling is relied upon:

1. An operator must run the **real** build locally on Unity **6000.4.2f1** with
   WebGL Build Support and confirm a clean success + green wrapper verification.
2. To sanity-check **local repeatability**, run the build twice from the **same**
   clean source commit (into two different `-Version` directories) and compare
   **equivalent artifact roles** across the two releases (see §10.2). The
   `-Version` value is intentionally embedded in some generated artifact
   filenames, and Unity WebGL output is **not** guaranteed to be bit-for-bit
   identical between runs, so a raw `path|bytes|sha256` comparison of the two
   `files[]` arrays is expected to differ and is **not** the correct test.

### 10.1 Observed runtime evidence (first Windows run)

A first Windows run on Unity **6000.4.2f1** produced two complete WebGL releases
from the **same** source commit (`b6b-local-bdb4cd9b-a` and `-b`). Observed:

- Both Unity builds completed successfully; both manifests were written and every
  listed file checksum independently verified afterward.
- Both manifests listed **17** files and used **gzip** compression.
- The loader (`Build/*.loader.js`) content matched exactly.
- `index.html` matched after normalizing the release-version-derived filename.
- The framework and wasm **compressed** bytes differed between runs, but their
  **decompressed** payload hashes matched.
- The data artifact's compressed bytes differed **and** its decompressed payload
  hashes also differed.

**Therefore exact local bit-for-bit determinism is not proven.** B6B establishes
a repeatable local invocation, traceable source metadata, immutable local output
directories, and verified manifests/checksums — it does **not** promise identical
artifacts across repeated runs.

> The first run also surfaced two wrapper orchestration defects (a `Set-StrictMode`
> empty-pipeline `.Count` failure on a clean tree, and continuing before the full
> Unity process tree had finished / the manifest existed). Both are corrected in
> this PR; a corrected-head Windows rerun is still required. The run additionally
> reported `ProjectSettings.asset` as `M` in `git status` with **no content diff**
> (a CRLF/LF/status-only anomaly) — the wrapper now distinguishes real tracked
> content/index changes from status-only anomalies and never alters Git state.

### 10.2 How to compare two same-source builds

Do **not** compare the two `files[]` arrays as raw `path|bytes|sha256` strings.
Instead compare **equivalent artifact roles**, applying:

- release-version filename normalization (strip/normalize the version-derived
  portion of artifact names before matching roles);
- **decompressed** payload comparison for `.gz` (and `.br`) files, not compressed
  bytes;
- **exact** comparison of the loader;
- **normalized** comparison of `index.html`.

Matching decompressed payloads across roles indicates local repeatability of
those payloads; differing payloads (as observed for the data artifact) are
**evidence to report**, not a defect to auto-fix. Do not modify the Unity C#
builder to force matching artifacts.

**Local repeatability is not production reproducibility.** The observed evidence
above already shows non-identical artifacts across two runs on one machine, so
bit-for-bit determinism across runs — let alone across machines, OS versions, or
Unity patch levels — is **not** established. The production reproducibility gate
remains **BLOCKED** and is **not** claimed here.

## 11. Relationship to B6A and B6C

- B6B addresses only the B6A blockers for a **committed local build command**
  and a **manifest/checksum tooling** shape. It does **not** address publishing,
  hosted delivery, staging, immutable **URLs**, performance, compatibility,
  security sign-off, telemetry, rollout, or rollback.
- The B6A decision remains **NO-GO**; no production gate is marked PASS by B6B.
- **B6C (versioned staging artifact delivery) is separately gated** and is
  **not** authorized by B6B. It requires its own scoped, reviewed PR.
