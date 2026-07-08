# Unity B2 — Local Prototype Scene Scaffold (PR #188)

> Status: **Unity-source scaffold only.** Nothing here connects Unity to the
> live web app. No live match mount, no WebGL build output, no server /
> Supabase / wallet logic. Companion docs:
>
> - `docs/unity-webgl-prototype-plan.md` — B2 scope + bridge contract (PR #187).
> - `docs/unity-webgl-build-pipeline.md` — build output location + gitignore.
> - `docs/unity-phase-b1-notes.md` — the passive React bridge (PR #186).

## 1. What this scaffold adds

Presentation-only C# source under `unity/Penalty444Client/Assets/Scripts/`:

| File | Role |
|---|---|
| `PenaltyVisualTypes.cs` | Visual-only enums: `PenaltyLane` (LEFT/CENTER/RIGHT), `PenaltyVisualResult` (GOAL/SAVE/DRAW), `PenaltyVisualState` (Idle/Staging/Revealing/Result/Ended) |
| `UnityBridgeReceiver.cs` | Future React→Unity entry point; B2 exposes local mock methods for `staging_begin` / `round_result` / `match_end` / `reset` and dispatches to the scene controller |
| `PenaltySceneController.cs` | Visual scene state machine; holds kicker/keeper/ball placeholders, three lane targets, scoreboard/status/banner text |
| `LaneTarget.cs` | LEFT/CENTER/RIGHT marker with `SetIdle` / `SetSelected` / `SetSuccess` / `SetFailed` tint states |
| `ResultAnimator.cs` | Placeholder `PlayGoal` / `PlaySave` / `PlayDraw` / `PlayReset` (Debug.Log + simple transform nudges) |

Plus folder placeholders with READMEs: `Assets/Scenes/`, `Assets/Prefabs/`,
`Assets/Materials/`. Each `.cs`/`.md` file has a matching Unity `.meta` file so
the Editor imports them with stable GUIDs.

The Unity project itself (`Packages/manifest.json`, `ProjectSettings/*` —
standard small Unity text files, Editor version `6000.4.2f1`) already exists in
the repo, so the folder opens directly in Unity Hub.

**Authority rules (unchanged, non-negotiable):** Unity is visual presentation
only. No Socket.IO, no Supabase, no JWTs/tokens/secrets/wallet data, no
official result calculation, no pick submission, no stats or match-result
writes. The Node realtime server remains the single source of truth. These
enums/scripts never replace the server or web types — they only describe what
to draw.

## 2. Opening the project locally

1. Install Unity Editor **6000.4.2f1** (or a compatible 6000.4.x) via Unity Hub.
2. In Unity Hub: **Add → Add project from disk** → select
   `unity/Penalty444Client/`.
3. Open the project. Unity regenerates `Library/` locally (gitignored). The
   scripts under `Assets/Scripts/` should compile with no errors.

## 3. The `Penalty444Prototype` scene (assembled in PR #190)

> **Status:** the scene now EXISTS at
> `Assets/Scenes/Penalty444Prototype.unity`. It was assembled and saved by
> Unity Editor **6000.4.2f1** (batch `-executeMethod` scene-builder run — the
> scene YAML is Editor-generated, not hand-authored), with the small
> solid-color materials in `Assets/Materials/` (`ArenaFloor`, `GoalFrame`,
> `KickerPlaceholder`, `KeeperPlaceholder`, `Ball`, `LaneIdle`). All inspector
> references are wired: `SceneController` (PenaltySceneController) →
> placeholders/lanes/UI/animator, `BridgeReceiver` (UnityBridgeReceiver) →
> controller, `ResultAnimator` → ball + keeper transforms, and each lane cube's
> `LaneTarget` has its Lane + Renderer set. Mock validation (all six bridge
> events) passed — see §4.
>
> The steps below are kept as the reference for rebuilding the scene by hand
> if it is ever recreated:

1. **File → New Scene**, save as `Assets/Scenes/Penalty444Prototype.unity`.
2. Create these GameObjects:
   - **Arena floor** — 3D Object → Plane, scaled to taste (e.g. 3×3).
   - **Goal** — a simple frame from 3D Object → Cube pieces (two posts + crossbar), placed at one end of the floor.
   - **Keeper placeholder** — 3D Object → Capsule, centered on the goal line.
   - **Kicker placeholder** — 3D Object → Capsule, ~11 units in front of the goal.
   - **Ball** — 3D Object → Sphere, at the kicker's feet.
   - **LaneTarget_LEFT / LaneTarget_CENTER / LaneTarget_RIGHT** — 3D Object → Cube (flattened), spread across the goal mouth left/center/right.
   - **Canvas** (UI → Canvas) containing three Text elements: **ScoreboardText**, **RoundStatusText**, **ResultBannerText**.
   - An empty GameObject named **MatchPresentation** to host the controller scripts.
3. Attach scripts:
   - `LaneTarget` → each of the three lane cubes; set the **Lane** field to LEFT / CENTER / RIGHT respectively (the cube's Renderer is picked up automatically).
   - `ResultAnimator` → **MatchPresentation**; assign the **Ball** and **Keeper placeholder** transforms.
   - `PenaltySceneController` → **MatchPresentation**; assign kicker/keeper/ball transforms, the three `LaneTarget`s, the three Text elements, and the `ResultAnimator`.
   - `UnityBridgeReceiver` → **MatchPresentation**; assign the `PenaltySceneController`.

## 4. Testing locally with mock events

1. Enter **Play Mode**. The controller resets to Idle ("Waiting…").
2. Select the **BridgeReceiver** GameObject (in the committed scene the
   presentation scripts live on separate `SceneController` / `BridgeReceiver` /
   `ResultAnimator` objects), right-click the **UnityBridgeReceiver** component
   header, and fire the context-menu mocks:
   - `Mock/staging_begin` → status shows "Get ready…", lanes idle.
   - `Mock/round_result — LEFT vs RIGHT → GOAL` → LEFT lane tints green, RIGHT lane tints yellow, ball nudges into the net, status shows "GOAL!".
   - `Mock/round_result — CENTER vs CENTER → SAVE` → CENTER tints red + selected, keeper nudges, status shows "SAVED!".
   - `Mock/match_end — winner` / `Mock/match_end — draw` → result banner text.
   - `Mock/reset` → everything returns to idle.
3. The Console logs every dispatched event — these mocks are the ONLY input in
   B2. There is no web integration, dev harness route, or postMessage wiring yet.

**Recorded mock-test results (PR #190, Unity 6000.4.2f1):** the saved scene was
reloaded and all six bridge events were exercised through `UnityBridgeReceiver`
— `reset`, `staging_begin`, `round_result` GOAL (LEFT vs RIGHT),
`round_result` SAVE (CENTER vs CENTER), `round_result` DRAW (RIGHT vs LEFT),
`match_end` winner, and `match_end` draw. All 13 assertions passed: visual
state transitions (Idle → Staging → Result → Ended → Idle), round status text
("Waiting…" / "Get ready…" / "GOAL!" / "SAVED!" / "DRAW"), and result banner
("MATCH OVER" / "MATCH DRAW" / cleared). Scripts compiled with no console
errors.

**Known limitations (placeholder-level by design):** primitives only (capsules/
cubes/sphere/plane) — no player models, stadium art, or textures; "animations"
are simple transform nudges + `Debug.Log`; the scoreboard shows a static
"— : —" (real score display is a later phase, driven by server-resolved data);
draw plays no movement; validation ran in edit mode — Play Mode behaves the
same but adds the `Start()` auto-reset.

## 5. Explicitly not in this phase

- No live web integration (nothing imports or mounts anything Unity-side;
  `MatchRenderer3D.tsx` is untouched).
- No WebGL build output committed (see `docs/unity-webgl-build-pipeline.md`).
- No `Library/`, `Temp/`, `Obj/`, `Logs/`, `UserSettings/`, `Build/`,
  `Builds/`, `.vs/`, `*.csproj`, `*.sln` in this change (covered by
  `unity/.gitignore`).
- No server, Supabase, auth, wallet/economy, tournament, leaderboard, timer,
  reconnect, result-persistence, or gameplay-rule changes.

Next steps after this scaffold (future PRs, per plan §8): B3 loads a local
WebGL build in a dev-only route; B4 sends mock events from a React dev harness.

## 6. Visual polish & prototype animation pass (PR #191)

> **Status:** this pass upgraded the presentation **scripts** and added
> **solid-color materials**. It remains local Unity only — no WebGL build, no
> web route, no `postMessage` wiring, no live match integration, no server
> connection. Authority rules from §1 are unchanged: Unity never computes
> results, submits picks, or writes stats/match results.

**Unity version:** project targets Editor **6000.4.2f1** (unchanged;
`ProjectSettings/ProjectVersion.txt`).

### 6.1 Animation improvements (`ResultAnimator.cs`)

The placeholder "animations" moved from one-frame transform snaps to simple,
deterministic, **time-based tweens** (coroutines, `Mathf.SmoothStep` easing).
No physics is used as authority; no randomness (mock runs stay repeatable);
each routine tweens **from the captured idle pose** so repeated events never
accumulate drift.

- **`PlayGoal()`** — ball travels forward into the net over `goalDuration`
  with a rise-and-fall **scale pulse**; ends resting in the net (reset restores).
- **`PlaySave()` / `PlaySave(float keeperDir)`** — keeper **leans toward the
  shot** (direction hint −1/0/+1 supplied by the controller from the keeper
  lane, display-only) plus a small forward lunge; the ball **darts out and
  eases back** (a recoil arc). A parameterless overload is kept for
  compatibility.
- **`PlayDraw()`** — a small **deterministic decaying left-right shake** plus a
  subtle pulse (previously log-only), so DRAW now reads as a neutral,
  no-winner beat.
- **`PlayReset()`** — stops any in-flight coroutine and restores ball + keeper
  position/scale to the captured idle baseline (clean, repeatable reset).

### 6.2 Lane feedback (`LaneTarget.cs`)

Kept the idle/selected/success/failed colour tints and added an optional brief
**scale pulse** on non-idle states (`enablePulse`, default on) so the
highlighted lane is easier to see. Still visual-only — colour + transform
scale, no input capture, no network.

### 6.3 Controller (`PenaltySceneController.cs`)

Minimal readability change only: the SAVE branch now passes the keeper lane as
a display-only horizontal **direction hint** to `PlaySave(...)` (via a private
`LaneDirection` map). No rules, winner, score, or pick logic added.

### 6.4 Mock triggers (`UnityBridgeReceiver.cs`)

Added two editor context-menu mocks so the full step-8 test list is
exercisable: a **directional SAVE** (`RIGHT vs LEFT → SAVE`) and a **round
DRAW** (`CENTER vs CENTER → DRAW`). No behaviour change to the existing mocks.

### 6.5 Materials added

Five new small **solid-color** Standard-shader materials (no textures), under
`Assets/Materials/`, matching the existing material template and the lane-state
palette: `FieldLine` (0.90/0.90/0.90), `LaneSelected` (1.0/0.85/0.20),
`LaneSuccess` (0.20/0.85/0.35), `LaneFailed` (0.90/0.25/0.25), `UIAccent`
(0.23/0.62/1.0). `LaneIdle` already existed (from PR #190) and is **unchanged**
(its GUID was preserved). No existing material was modified.

### 6.6 Environment note & what still needs the Unity Editor

This pass was prepared **without a Unity Editor in the working environment**, so
the following were done and are review-verifiable as source:

- ✅ Script edits (`ResultAnimator`, `LaneTarget`, `PenaltySceneController`,
  `UnityBridgeReceiver`) — reviewed for C# correctness; **not** compiled by a
  Unity Editor here.
- ✅ New material assets (with valid unique `.meta` GUIDs).

The following are **staged for the operator in the Unity Editor** and were **not**
performed in this change (the 2065-line scene YAML was intentionally left
untouched rather than hand-edited blind):

- ⏳ Scene layout / camera framing / lighting adjustments in
  `Penalty444Prototype.unity`.
- ⏳ Assigning the new materials to the floor lines / lane cubes / UI accents in
  the scene inspector.
- ⏳ Running **Play Mode** and firing the mock context-menu events (reset,
  staging_begin, round_result GOAL/SAVE/DRAW, match_end winner/draw, reset
  again) to confirm the new tweens read well and the scene resets cleanly with
  no console compile errors.

### 6.7 Known limitations (placeholder-level by design)

Primitives only (capsules/cubes/sphere/plane); solid colours, no textures/art;
tweens are simple transform interpolations, not Animator clips or VFX; the
scoreboard still shows a static "— : —" (real score display is a later
server-driven phase). All intentional for a local prototype.
