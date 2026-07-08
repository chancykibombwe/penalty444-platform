# Unity WebGL Build Pipeline — Penalty444

> Status: **Documentation only.** This describes how a future Unity WebGL build
> will be produced and where it will live. No build tooling, CI step, or build
> output is added in this PR. See `docs/unity-webgl-prototype-plan.md` for the
> B2 scope and `docs/unity-3d-prototype-plan.md` for the architecture contract.

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

## 6. B3 WebGL build dry run (PR #193) — BLOCKED: no Unity Editor available

**Outcome: the dry run could not be executed because there is no Unity Editor
(and therefore no WebGL Build Support module) available in the environment where
this PR was prepared.** Per the B3 task rule, a build was **not** faked and no
build output was hand-created — this is therefore a **documentation-only** PR
that records the exact blocker and the steps to run the build on a real machine.

### 6.1 Environment evidence (why it is blocked)

- **Unity version targeted:** `6000.4.2f1` (from
  `unity/Penalty444Client/ProjectSettings/ProjectVersion.txt`) — unchanged.
- **Unity Editor:** none found on `PATH` or in the usual install locations
  (`unity` / `unity-editor` / `Unity` / Unity Hub all absent).
- **WebGL Build Support module:** not present (no `PlaybackEngines/WebGLSupport`
  or equivalent). With no Editor installed, no build module can be present.
- **Consequence:** steps 3–5 of the B3 task (run build, validate output, verify
  no-commit of output) cannot be performed here. Scripts were also **not**
  Unity-compiled here for the same reason (they are unchanged from PR #192).

### 6.2 WebGL Build Support — installation (do this before the real dry run)

On a machine with Unity Hub:

1. Open **Unity Hub → Installs**.
2. If Editor **6000.4.2f1** is not installed: **Install Editor →** pick
   `6000.4.2f1` (or a compatible `6000.4.x`).
3. On the **Add modules** screen (or later via the ⚙ / **Add modules** on the
   installed version), tick **WebGL Build Support** and install.
4. Verify: `Editor → File → Build Profiles` (Unity 6) shows **Web / WebGL** as a
   selectable platform (not greyed out with "module not installed").

Command-line install (headless machines), adjust the Hub path per OS:

```
# example — the exact module id/changeset must match 6000.4.2f1
unityhub -- --headless install-modules --version 6000.4.2f1 --module webgl
```

### 6.3 Exact build steps to run the dry run (once WebGL support is installed)

Editor route:
1. Open `unity/Penalty444Client/` in Unity **6000.4.2f1**. Confirm scripts
   compile (Console clean).
2. **File → Build Profiles → Web/WebGL → Switch Platform.**
3. Confirm the **scene in build** is `Assets/Scenes/Penalty444Prototype.unity`
   (add it to the profile's scene list if empty). Only commit the resulting
   `EditorBuildSettings.asset` change if Unity records it and it is minimal.
4. **Build** → choose a scratch output folder (see §6.4).

Batch/CLI route (deterministic; requires a small `-executeMethod` build script
or the built-in build, not added in this PR):

```
<UnityEditor> -batchmode -nographics -quit \
  -projectPath unity/Penalty444Client \
  -buildTarget WebGL \
  -logFile - \
  # -executeMethod Penalty444.BuildTools.BuildWebGL   # (a future helper)
```

### 6.4 Output path for the dry run

Use a scratch path that is already git-ignored so nothing can be committed:

```
unity/Penalty444Client/Builds/WebGL/Penalty444Prototype/
```

`unity/.gitignore` already ignores `Builds/` and `Build/`, so this location is
safe by construction. Either path is now ignore-protected —
`apps/web/public/unity/penalty444/` was added to the root `.gitignore` in
PR #194 — but this scratch path stays the default for a pure pipeline dry run
(the web path is only needed once a dev-only route actually loads the build, a
later phase).

### 6.5 Expected generated files (validation checklist for the real run)

After a successful WebGL build, expect (exact names vary by Unity version):

- `index.html`
- `Build/*.loader.js`
- `Build/*.framework.js`
- `Build/*.data`
- `Build/*.wasm`
- `TemplateData/*` (css, favicon, progress-bar images)

Confirm these exist locally, then **do not commit them** — delete the scratch
folder or rely on the `Builds/` ignore.

### 6.6 Repeat & clean

- **Repeat:** re-run §6.3 after any scene/script change.
- **Clean:** delete the scratch build folder, e.g. remove
  `unity/Penalty444Client/Builds/`. Because it is git-ignored it never appears in
  `git status`.
- **`apps/web/public/unity/penalty444/` is git-ignored** (root `.gitignore`,
  added in PR #194), so a build placed there for a future dev-only route can
  never be committed by accident. `apps/web/public/unity/README.md` stays
  tracked.

### 6.7 Known limitations

- No build was produced or validated in this environment — §6.5 is a checklist
  for the operator, not a recorded result.
- First WebGL builds are slow (IL2CPP + Emscripten) and large; keep them out of
  git.
- The prototype is still primitives + solid colors (no art), so the build is a
  pipeline smoke test, not a visual milestone.

### 6.8 Next phase

Once a real WebGL build succeeds locally: a later, separately-reviewed PR adds a
**dev-only** web route that loads the local build for manual viewing (still no
live match mount, no `postMessage`, no server connection). No web/route work is
started in this PR.
