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
