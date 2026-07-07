# Unity Generated Files Cleanup (PR #189)

> Cleanup-only. No gameplay, web, realtime-server, Supabase, wallet/economy,
> admin, tournament, CI, or live Unity integration changes.

## What happened

Old commits (before the scoped `unity/.gitignore` from PR #187 existed)
accidentally committed ~15,954 Unity-generated files to git:

- `unity/Penalty444Client/Library/` (15,165 files), `Logs/` (10),
  `UserSettings/` (4) — Editor caches, logs, and per-machine layout files.
- `unity/New Unity Project/` (775 files) — a leftover *empty default* Unity
  project (default name, no `Assets/` at all; only auto-generated `Library/`,
  `Logs/`, `Temp/`, `UserSettings/`, and stock `Packages/` +
  `ProjectSettings/`). Verified to contain no unique scenes, scripts, or assets
  before removal.

A `.gitignore` only prevents *new* files from being tracked — it does not
untrack files that were already committed, which is why these survived PR #187.

## What this cleanup did

Removed all of the above from git tracking with `git rm -r --cached` (working
copies on developers' machines are untouched; Unity regenerates `Library/`
locally on open). The already-present `unity/.gitignore` now keeps them out
permanently (`Library/`, `Temp/`, `Obj/`, `Logs/`, `UserSettings/`, `Build/`,
`Builds/`, `.vs/`, `*.csproj`, `*.sln`, `*.suo`, `*.user`, `*.userprefs`,
`*.stackdump`).

## What remains tracked (intentionally)

- `unity/.gitignore`
- `unity/Penalty444Client/Assets/` — the PR #188 B2 scaffold: scripts + `.meta`
  files, folder READMEs, existing scenes (`PenaltyMatch.unity`,
  `SampleScene.unity`), and `InputSystem_Actions.inputactions`.
- `unity/Penalty444Client/Packages/` — `manifest.json`, `packages-lock.json`.
- `unity/Penalty444Client/ProjectSettings/` — small standard Unity text
  settings (Editor `6000.4.2f1`), needed to open the project.
- `unity/Penalty444Client/README.md` and all `docs/unity-*.md`.

Result: tracked files under `unity/` went from **16,015** to **61**, so future
Unity PRs stay small and reviewable. WebGL build output remains excluded and
belongs (untracked) under `apps/web/public/unity/penalty444/` per
`docs/unity-webgl-build-pipeline.md`.
