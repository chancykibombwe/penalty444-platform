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

**Repeatability (observed).** A first Windows run on Unity **6000.4.2f1**
produced two complete releases from the same source commit (both 17 files, gzip;
loader exact-match; `index.html` match after version-filename normalization;
framework/wasm decompressed payloads matched though compressed bytes differed;
the data artifact's decompressed payload differed). So B6B provides a repeatable
local invocation with verified manifests/checksums but **does not** promise
bit-for-bit-identical artifacts across runs. Two same-source builds must be
compared by **equivalent artifact role** (version-filename normalization,
decompressed-payload comparison for `.gz`), **not** as raw
`path|bytes|sha256` manifest strings. The production **reproducibility gate
remains BLOCKED**.

## 6.12 B6C — provider-specific staging delivery candidate (PR #205)

B6C adds a **staging-only** delivery candidate on top of the B6B local builder:
it deploys **one** existing, locally-built and verified B6B release to a
**separate Vercel preview artifact deployment** and serves it at a verified,
immutable, versioned hosted path — consumed **same-origin** through the main app.

- **Deploy tooling:** `scripts/unity/deploy-penalty444-webgl-staging.ps1`
  (Windows PowerShell; `-ValidateOnly` runs full source verification without any
  workspace/copy/link/deploy/network) + a committed Vercel header template
  `scripts/unity/vercel/penalty444-webgl-staging.vercel.json`.
- **Separate artifact project:** a pre-existing, manually-created Vercel project
  (e.g. `penalty444-unity-staging`); the script never creates it and never uses
  `--prod` or an alias.
- **Immutable hosted path:** `/releases/<version>/index.html` on the artifact
  origin, exposed same-origin via a validated server-only rewrite
  (`UNITY_STAGING_ARTIFACT_ORIGIN`) at
  `/unity/penalty444/staging/releases/<version>/index.html`.
- **Gzip-only.** The committed template ships gzip rules only, so B6C accepts
  gzip B6B releases only (`compressionMode == "gzip"`, exactly one of
  `Build/*.{framework.js,data,wasm}.gz`); Brotli/identity releases are rejected.
- **Staging-only enforced in code.** A non-empty `UNITY_STAGING_ARTIFACT_ORIGIN`
  on `VERCEL_ENV === "production"` fails the web build, and `/dev/unity-staging`
  is `notFound()` in production — the staging rewrite can never reach a Vercel
  production deployment.
- **No production delivery, no automatic publishing, no CI Unity build, no
  production activation, no committed WebGL output.** The legacy B3 dry run and
  the B6B local builder remain as documented above; B6C changes nothing about
  them.

The first Windows runtime built + deployed a preview successfully but **exited 1
during HTTP verification** because the dedicated artifact preview was protected by
Vercel Authentication (HTTP 302 → SSO); the dedicated `penalty444-unity-staging`
preview must permit **anonymous** artifact access (main-app project protection
unchanged). After disabling that protection, a corrected-head rerun deployed and
**fully verified** an immutable preview
(`…-42qkvl348-…vercel.app`, `dpl_4yEsG8YSFzdg9sFyuLAxMuqLzxyV`, exit 0) — proving
the artifact path and headers work — but a preceding deployment had failed
verification **only** because its generated hostname took ~15 s to resolve. The
wrapper is now hardened with a **shared, monotonic, strictly-bounded 90-second
readiness poll** (single `Stopwatch`, ~2 s interval) covering all hosted
verification: every request timeout is clamped to the remaining shared time, the
clock is re-checked after each request (a **late 200 past the window is
rejected**), and the poll sleep is clamped to remaining time. It tolerates
transient DNS/connection/timeout failures and transient HTTP statuses
(404/408/425/429/500/502/503/504) while failing fast on auth/redirect/other-4xx;
**deployment creation is never auto-retried**.

A pristine checkout of head `453eb9ac` then **failed the Windows PowerShell 5.1
parser** because of non-ASCII em dashes inside executable strings (PS 5.1
mis-tokenizes them without a UTF-8 BOM); the wrapper is now **ASCII-only**
(source-encoding change only, verified byte-for-byte identical apart from the
substituted punctuation). *(A pristine head then failed the Windows PS 5.1 parser
on those em dashes; resolved by making the wrapper ASCII-only — commit
`5091328f`.)*

A main-app preview runtime test then found that although `/dev/unity-staging`
loaded the artifact same-origin and the mock events worked, **live Socket.IO
connections appeared on the staging route** — the root `layout.tsx` globally
mounted `ActiveMatchRecovery` / `MatchReadyNotification` whose mount-time
`getSocket()` binds realtime + Supabase auth, breaking the route's
no-Socket.IO/no-Supabase isolation. Fixed with a route-aware shell
(`RouteAwareAppShell`) that mounts **no** global runtime/chrome on
`/dev/unity-staging` (all other routes unchanged; no `disconnectSocket()`
workaround, no socket/auth-policy change).

**Final staging runtime — PASS.** The full Windows + Vercel operator runtime then
completed successfully: the artifact preview
(`dpl_CrN11NEwGrwDAaxUErrksMuXZSWj`, `…-phs4cj38n-…vercel.app`, `target=null`,
exit 0) passed all MIME/gzip/SAMEORIGIN/nosniff/immutable checks with DNS
propagation absorbed by the bounded poll (no second deployment); the corrected
main-app preview (`dpl_7Z6QwuuQXQk7pUeY3jJRyu3WZipW`, READY) loaded the route
same-origin, Unity reached ready, and mock `staging_begin`/GOAL/SAVE/`match_end`/
`reset` all passed; and the **route-isolation retest passed** (Socket Network
filter empty, 0/34, no `socket.io`/WebSocket/Supabase traffic). **The B6C
staging-runtime gate is PASS** (staging only; no Unity in live matches). See
`docs/unity-b6c-versioned-staging-delivery.md` §14.3. **Production delivery
remains NO-GO, production reproducibility remains BLOCKED, and B6D remains
unauthorized.**

The deployment URL is resolved by a dedicated parser supporting the Vercel CLI
**56.2.0** structured-JSON stdout (immutable origin taken only from
`deployment.url`, gated on `status=ok` / `readyState=READY` / `target=null`) and
the plain-URL stdout form; arbitrary embedded-URL extraction is prohibited and the
project alias is rejected.

See `docs/unity-b6c-versioned-staging-delivery.md` for scope, the full
verification contract, headers, `-ValidateOnly`, the PS 5.1 native-process
discipline, deployment-URL parsing, protected-preview detection, rollback
selection, and the required Windows/Vercel runtime test. B6C is **staging only**;
the production decision remains **NO-GO** and B6C does not authorize B6D.

## 6.13 B6D — real-match integration (PLANNING ONLY; not started)

B6C is **complete** (staging-runtime gate PASS; §6.12). **B6D implementation has
not started.** A formal scope/risk brief —
`docs/unity-b6d-real-match-integration-scope.md` — proposes how the Unity
presentation *could* consume authoritative real-match presentation events while
Node.js/Socket.IO remains the sole gameplay authority, Unity stays
presentation-only, and the React renderer remains the fallback.

- The brief defines the proposed gates **B6D1** (contract + sanitizing adapter +
  tests), **B6D2** (preview shadow mode), **B6D3** (internal preview renderer),
  **B6D4** (failure/recovery validation), and **B6D5** (closeout).
- **No subphase is authorized by the existence of the document** — each requires
  its own separate review/gate.
- **Production remains NO-GO. Production reproducibility remains BLOCKED.** B6D is
  preview/free-play only and activates no production Unity.

**B6D1 — implemented as standalone contract/test groundwork only** (see
`docs/unity-b6d1-contract-adapter.md`). Adds a versioned presentation protocol
(`unityPresentationProtocol.ts`), a sanitizing adapter
(`unityPresentationAdapter.ts`), and **58** unit tests
(`unityPresentationAdapter.test.ts`, run via `npm run test:unity-presentation`
using `tsx` + Node `node:test`). The validators/gate are **exception-safe**
against hostile getters and Proxies. The tests are enforced in the existing
GitHub **Web CI job** (`.github/workflows/ci.yml`, step "Unity presentation
contract tests").

- **It does NOT activate the existing bridge.** `MatchRoomPanel` and
  `MatchRenderer3D` are **unchanged**; the module is imported by nothing at
  runtime.
- **No Unity, server, Supabase, or deployment change**; no feature-flag change;
  no generated WebGL output. The only CI change is the added Web test step. It is
  pure TypeScript + tests.
- **B6D2 requires a separate approval after B6D1 review.** Production remains
  **NO-GO**; reproducibility remains **BLOCKED**.

**B6D2A — default-off web shadow dispatch only** (see
`docs/unity-b6d2a-web-shadow-dispatch.md`). B6D1 is **complete**; B6D2A wires the
tested B6D1 contract/adapter into the existing optional React→Unity shadow path to
build, order, and dispatch real authoritative `round_result` / `match_state_sync`
envelopes, behind a **third** public flag `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`
(default off; runs only when all three Unity flags are `"true"`).

- **No Unity source and no production configuration.** React stays the
  player-facing renderer and sole client lifecycle owner; the legacy shadow is
  preserved exactly when the flag is off; `package-lock.json` is unchanged.
- It **proves envelopes are built/ordered/dispatched**, **not** that Unity has
  applied `match_state_sync`.
- **B6D2A must pass code review before any branch-preview flag configuration.**
  **B6D2B requires separate authorization** (as does B6D3). Production remains
  **NO-GO**; reproducibility remains **BLOCKED**.

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
