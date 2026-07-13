# Unity WebGL Build Pipeline — Penalty444

> Status: **B3 dry run completed locally** (Unity 6000.4.2f1, WebGL Build Support
> installed). Build output is validated at `apps/web/public/unity/penalty444/`
> and intentionally **not committed**. No CI build step, no web route, no live
> match integration. See `docs/unity-webgl-prototype-plan.md` for scope.

---

## 1. Source vs. output

| Purpose | Location | Committed? |
|---------|----------|------------|
| Unity project source | `unity/Penalty444Client/` | Yes (scripts, scenes, assets — small text/meta files) |
| Generated WebGL build | `apps/web/public/unity/penalty444/` (served at `/unity/penalty444/`) | **No** by default (build artifact) |
| Unity machine caches | `unity/Penalty444Client/{Library,Temp,Obj,Logs,Builds,Build}/` | **Never** |

The Next.js app is `apps/web`, so anything that must be served at the
`/unity/penalty444/` URL has to physically sit under `apps/web/public/unity/penalty444/`.

## 2. Future local build steps (not automated in this PR)

1. Open `unity/Penalty444Client/` in the Unity Editor.
2. Open the `Penalty444Prototype` scene.
3. Build target: **WebGL**.
4. Output the build to a scratch folder, then copy the web-servable files into
   `apps/web/public/unity/penalty444/` for dev testing.
5. Load it from a **dev-only** route (Phase B3) — never the live match page in
   these early phases.

## 3. What must NOT be committed

Unity generates large, machine-specific, and binary artifacts. Do not commit:

- `Library/`, `Temp/`, `Obj/`, `Logs/`, `UserSettings/`
- `Builds/`, `Build/`
- `*.csproj`, `*.sln`, `.vs/`
- Generated WebGL output (`apps/web/public/unity/penalty444/`) unless a small,
  explicitly-approved dev build is intended.

A scoped `unity/.gitignore` (added in this PR) enforces the Unity-project side of
this. It only affects the `unity/` tree and leaves the root `.gitignore`
untouched.

## 4. Safety guarantees carried into the build

The build pipeline changes nothing about authority:

- The Node realtime server stays the source of truth.
- The WebGL build is passive presentation; it opens no socket, holds no auth
  tokens or service-role keys, writes no Supabase data, submits no picks, and
  computes no official results.
- React (`MatchRenderer3D`, PR #186) remains the only thing that talks to Unity,
  and only via the validated, same-origin `postMessage` contract.

## 5. CI note

No CI changes are introduced. If a future phase adds a Unity build to CI it must
be a separate, reviewed PR; it is untouched here.

## 6. B3 WebGL build dry run — COMPLETED (Unity 6000.4.2f1)

**Outcome: the dry run succeeded.** WebGL Build Support is installed, the
`Penalty444Prototype` scene builds to WebGL locally, and the generated output
was validated on disk. **No build output was committed** — it lives under
`apps/web/public/unity/penalty444/`, which is git-ignored (root `.gitignore`,
PR #194).

### 6.1 WebGL Build Support status

- **Unity Editor:** `6000.4.2f1 (7a4c1aeef971)` — matches
  `ProjectSettings/ProjectVersion.txt`.
- **WebGL Build Support:** **installed** — confirmed via
  `Editor/Data/PlaybackEngines/WebGLSupport/` on the Hub install and
  `UnityEditor.WebGL.Extensions.dll` registration in the Editor log.
- **Install path (if missing on another machine):** Unity Hub → Installs →
  ⚙ beside `6000.4.2f1` → **Add modules** → tick **WebGL Build Support**.

### 6.2 Build scene

`Assets/Scenes/Penalty444Prototype.unity` (guid `d26389b1d3c201545bd895c8324741e2`)

`EditorBuildSettings.asset` now records this scene as the sole enabled build
scene (minimal Unity-generated settings change committed in this PR).

### 6.3 Exact build steps used

**Editor route (manual):**

1. Open `unity/Penalty444Client/` in Unity **6000.4.2f1**. Wait for compile.
2. Open `Assets/Scenes/Penalty444Prototype.unity`.
3. **File → Build Profiles → Web / WebGL → Switch Platform.**
4. Confirm `Penalty444Prototype` is in the scene list.
5. **Build** → output folder:
   `apps/web/public/unity/penalty444/` (repo-relative from project root).

**Batch/CLI route (used for the recorded dry run):**

A temporary `-executeMethod` editor helper ran `BuildPipeline.BuildPlayer` for
WebGL with the same scene and output path, then was deleted before commit. The
operator can repeat via Editor steps above; a permanent build script is a later
optional convenience.

### 6.4 Output path

```
apps/web/public/unity/penalty444/
```

Served at `/unity/penalty444/` when placed in the Next.js `public/` tree.
Git-ignored by `apps/web/public/unity/penalty444/` in the root `.gitignore`.

### 6.5 Generated files (recorded from the successful dry run)

Unity **6000.4.2f1** produced **17 files** (~10.6 MB total build size, ~5m 22s
build time). Gzip compression is on by default in this Unity version:

| Path | Role |
|------|------|
| `index.html` | loader shell |
| `Build/penalty444.loader.js` | Unity loader |
| `Build/penalty444.framework.js.gz` | framework (gzipped) |
| `Build/penalty444.data.gz` | asset data (gzipped) |
| `Build/penalty444.wasm.gz` | wasm binary (gzipped) |
| `TemplateData/*` | default template css, favicon, progress-bar images |

Exact filenames vary by Unity version/template; the checklist is: `index.html`,
`Build/*.loader.js`, `Build/*.framework.js*`, `Build/*.data*`, `Build/*.wasm*`,
`TemplateData/*`.

### 6.6 Not committed — repeat & clean

- **Not committed:** `git ls-files apps/web/public/unity/penalty444/` returns
  **0**; `git status` does not list the build output (ignore-protected).
- **Repeat:** re-run §6.3 after scene/script changes.
- **Clean:** delete the folder:
  `Remove-Item -Recurse -Force apps/web/public/unity/penalty444` (PowerShell)
  or `rm -rf apps/web/public/unity/penalty444`. Safe — it is never tracked.

### 6.7 Known limitations

- First WebGL builds are slow (IL2CPP + Emscripten) and large; keep them out of
  git.
- The prototype is still primitives + solid colors (no art) — this validates the
  **pipeline**, not visual quality.
- No dev-only web route loads the build yet (next phase).
- No `postMessage` wiring, no live match mount, no server connection.

### 6.8 Dev-only viewer route (PR #196)

`/dev/unity/penalty444` loads the local, git-ignored WebGL output
(`/unity/penalty444/index.html`) in a plain `<iframe>` for manual viewing. It is
server-gated (404 in production unless `UNITY_PROTOTYPE_ROUTE_ENABLED=true`, the
same flag as `/dev/unity-prototype`), manually-typed only (not linked from any
public surface), and **passive** — no `postMessage`, no Socket.IO, no Supabase,
no wallet/economy, no live match state, no gameplay authority. When the build
output is absent (fresh clone / Vercel), the page renders a "run the B3 build"
instruction box instead of the iframe, so the app still builds without the
git-ignored output.

### 6.9 Mock event harness (PR #198, B4)

`/dev/unity-prototype` now loads the local WebGL build in an iframe and sends
deterministic mock `PENALTY444_MATCH_EVENT` messages (staging_begin /
round_result / match_end / reset) over **same-origin** postMessage. A WebGL
`.jslib` bridge (`Assets/Plugins/WebGL/Penalty444WebBridge.jslib`) validates
`event.origin === location.origin` and `event.source === window.parent`, forwards
the envelope to `UnityBridgeReceiver.OnWebMessage`, and posts a single `ready`
event back. Only `ready` is implemented (no `animation_complete` yet). No live
match state, no Socket.IO, no Supabase, no authority.

> **A fresh Unity WebGL rebuild is required after any bridge source change**
> (the `.jslib` / `UnityBridgeReceiver.cs`), because the bridge is compiled into
> the WebGL output. Rebuild to `apps/web/public/unity/penalty444/` and do not
> commit it — the output stays git-ignored.

The passive viewer at `/dev/unity/penalty444` (PR #196) is unchanged.

### 6.10 Next phase

B5 (live match page optional visual mode behind a feature flag) remains future
work and is not started here.

## 6.11 B6B — committed local release build entry point (PR #204)

B6B adds a committed, repeatable **local** release-build entry point on top of
the B3 dry run. The B3 flow above remains **historical**: a temporary
`-executeMethod` helper that was deleted before commit. B6B replaces that
throwaway helper with a permanent, reviewed build command — but changes nothing
about publishing or production delivery.

- **Editor build entry point:**
  `unity/Penalty444Client/Assets/Editor/Penalty444WebGLReleaseBuilder.cs`
  (`Penalty444.Editor.Penalty444WebGLReleaseBuilder.BuildFromCommandLine`).
- **Operator wrapper:** `scripts/unity/build-penalty444-webgl-release.ps1`
  (Windows PowerShell; `-ValidateOnly` runs preflight without launching Unity).
- **Versioned output:** each release builds into a **new immutable** folder
  `apps/web/public/unity/penalty444/releases/<version>/`. This is under the
  existing git-ignored `apps/web/public/unity/penalty444/` rule, so **no
  generated output is committed** — `git ls-files` for that tree stays empty.
- **Manifest + checksums:** every release writes `manifest.json`
  (schemaVersion 1, per-file SHA-256, Unity version, source commit, sizes,
  compression mode) plus a `manifest.sha256` self-checksum. The wrapper then
  **independently** re-verifies the manifest and every file hash.
- **Pinned editor + clean source:** the build requires the `ProjectVersion.txt`
  editor version (`6000.4.2f1`) and a clean **tracked** working tree.

B6B does **not** publish or upload artifacts, configure storage/CDN/Vercel,
add a Unity build to CI, or activate Unity in production. It is local tooling
only. See `docs/unity-b6b-local-release-build.md` for the full contract, the
exact commands, the manifest schema, failure/partial-output behavior, and the
required local runtime test.

## 7. Production-readiness boundary

> B5 (live shadow preview) is complete on `master` (PRs #199–#202), but that does
> **not** make Unity production-ready. This section marks the boundary; the full
> gate is `docs/unity-b6a-production-readiness-audit.md` (PR #203).

- The current WebGL output remains **local and git-ignored** — it is never
  committed and is not present on a fresh clone or a normal Vercel deploy.
- The current build process is a successful **prototype dry run**, not a
  production release pipeline.
- **No normal CI build or artifact publication exists** — CI (`ci.yml`) runs only
  web + realtime typecheck/build.
- **Production artifact delivery and versioning remain unresolved** (no selected
  storage/CDN, no immutable versioned URL, no manifest/checksums).
- Do **not** commit generated WebGL output. See
  `docs/unity-b6a-production-readiness-audit.md` for the go/no-go gates and the
  proposed B6B–B6G sequence.
