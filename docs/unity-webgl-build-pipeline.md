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
be a separate, reviewed PR; the current CI (`.github/workflows/ci.yml`) only
runs web + realtime-server typecheck/build and is untouched here.
