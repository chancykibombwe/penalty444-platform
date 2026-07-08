# Unity WebGL Prototype Plan — Penalty444 (Phase B2)

> Status: **Planning / scaffold only.** No Unity engine code, no live match
> integration, no WebGL build output ships in this PR. This document defines the
> B2 prototype scope and sits alongside:
>
> - `docs/unity-3d-prototype-plan.md` — the overall architecture contract (read first).
> - `docs/unity-phase-b1-notes.md` — the passive React bridge (`MatchRenderer3D`, PR #186).
> - `docs/unity-webgl-build-pipeline.md` — build output location + Unity gitignore guidance.
>
> This plan does not replace those; it extends them for the local WebGL prototype phase.

---

## 1. Unity Phase B2 goal

B2 creates a **local / dev-only Unity WebGL prototype** for Penalty444 3D. It is
a standalone visual prototype — it does **not** connect to anything live.

The prototype scene should contain:

- A 3D penalty arena (floor + surroundings)
- A goal post
- A keeper placeholder
- A kicker placeholder
- A ball placeholder
- LEFT / CENTER / RIGHT lane markers
- Goal / save / draw visual states
- Basic round-reveal animation placeholders

Explicitly **out of scope** for B2:

- No live server connection
- No Supabase
- No Socket.IO
- No wallet/economy
- No live match page integration

The only "input" the prototype reacts to is **mock** React→Unity messages fired
from a dev harness (see §3), so the animation states can be exercised locally.

## 2. Architecture rule (non-negotiable)

- The **Node realtime server remains the single source of truth** for all match
  logic and results.
- **React / Next.js owns** auth, routing, lobby, match state, and the Socket.IO
  connection.
- **Unity is visual presentation only.**
- Unity **never** calculates official results.
- Unity **never** submits picks.
- Unity **never** writes to Supabase.
- Unity **never** receives JWTs, service-role keys, wallet data, or private user
  tokens.

This mirrors the constraints already enforced in `MatchRenderer3D.tsx` (PR #186)
and in `docs/unity-3d-prototype-plan.md` §4 / §11.

## 3. Unity ↔ React bridge contract

The React half already exists and is passive/default-off:
`apps/web/src/components/match/MatchRenderer3D.tsx` (PR #186). B2's Unity scripts
must speak the same message contract.

**React → Unity** (`type: "PENALTY444_MATCH_EVENT"`), each payload derived only
from state the server has already resolved:

| event | payload | meaning |
|-------|---------|---------|
| `staging_begin` | `{ startsAt: number }` | pre-round staging countdown |
| `round_result` | `{ kickerLane, keeperLane, result, scores, round, maxRounds, phase }` | animate the resolved round |
| `match_end` | `{ winnerId: string \| null, isDraw: boolean }` | play the end sequence |
| `reset` | `null` | reset scene to idle |

**Unity → React** (`type: "PENALTY444_UNITY_EVENT"`):

| event | payload | meaning |
|-------|---------|---------|
| `ready` | `null` | Unity build loaded and listening |
| `animation_complete` | `{ round: number }` | presentation finished for a round |
| `error` | `{ message: string }` | non-fatal Unity-side error surfaced to React |

**Authority note:** Unity → React messages are **presentation timing hints
only**. They cannot affect match authority — they never carry or influence
results, picks, scores, auth, stats, or money. React validates every inbound
message shape and origin before acting (see `validateUnityMessage` in
`MatchRenderer3D.tsx`).

## 4. WebGL build output plan

- **Unity project source** lives under: `unity/Penalty444Client/`
- **Built WebGL output** should eventually be copied to the Next.js public
  directory so it is served at the `/unity/penalty444/` URL path. In this
  monorepo the Next app is `apps/web`, so the on-disk location is:
  **`apps/web/public/unity/penalty444/`** (served at `/unity/penalty444/`).

For **this** PR (scaffold only):

- Do **not** commit heavy generated Unity build output.
- Do **not** commit `Library/`, `Temp/`, `Obj/`, `Build/`, `Builds/`, `Logs/`.
- Do **not** commit large binary artifacts unless explicitly approved.

See `docs/unity-webgl-build-pipeline.md` for the full build + placement steps.

## 5. Git ignore guidance

Unity generates large, machine-specific folders that must never be committed.
This PR adds a **scoped** `unity/.gitignore` (it only affects the `unity/` tree
and does not disturb the existing root `.gitignore`) covering:

```
Library/
Temp/
Obj/
Logs/
UserSettings/
Builds/
Build/
*.csproj
*.sln
.vs/
```

Generated WebGL build output placed under `apps/web/public/unity/penalty444/`
should also be treated as a build artifact (kept out of git unless a small,
explicitly-approved dev build is intended). See the build-pipeline doc.

## 6. Phase B2 prototype scene requirements

**Scene name:** `Penalty444Prototype`

**Objects:**

- Arena floor
- Goal
- Keeper placeholder
- Kicker placeholder
- Ball
- Three lane targets: LEFT / CENTER / RIGHT
- Simple scoreboard UI
- Round status text
- Result banner

**Scripts to plan** (documented now; implemented in the B2 build phase, not this
PR):

- `UnityBridgeReceiver.cs` — receives validated React→Unity messages, dispatches
  to the scene controller. Never sends picks/results back as authority.
- `PenaltySceneController.cs` — owns scene state machine (idle → staging →
  reveal → result → reset) driven purely by received events.
- `LaneTarget.cs` — represents a LEFT/CENTER/RIGHT marker and its highlight.
- `ResultAnimator.cs` — plays goal / save / draw placeholder animations.

This PR only scaffolds/documents these via README placeholders — no `.cs` files
are added yet.

## 7. Phase B2 acceptance criteria

B2 is complete only when **all** of the following hold:

- Unity project opens locally.
- The `Penalty444Prototype` scene loads.
- The static scene displays (arena, goal, keeper, kicker, ball, lane targets,
  scoreboard, status text, result banner).
- Mock React→Unity messages can trigger goal / save / draw animations locally.
- A WebGL build can be produced locally.
- The build can be placed under `apps/web/public/unity/penalty444/` for dev
  testing.
- **No** live match page integration yet.
- **No** server authority changes.
- **No** Supabase writes.
- **CI still passes.**

## 8. Future phases

- **B2** — Unity local prototype scene (this plan). *(Done — PRs #188–#192.)*
- **B3** — Unity WebGL build loaded in a **dev-only** route, not the live match.
  - **B3 status (PR #193):** the WebGL build **pipeline dry run was BLOCKED** —
    no Unity Editor / WebGL Build Support was available in the environment where
    it was attempted, so no build was run or faked. The exact build steps,
    WebGL-Build-Support install steps, output path, and validation checklist are
    documented in `docs/unity-webgl-build-pipeline.md` §6, ready for an operator
    with the Editor installed. The dev-only route itself remains a later step.
- **B4** — React sends **mock** events to Unity from a dev harness.
- **B5** — Live match page optional visual mode behind a feature flag. *(Future only.)*
- **B6** — Production-ready Unity 3D Penalty444 with fallback to the normal web
  renderer. *(Future only.)*

**B5 and B6 are future phases only and are not implemented in this PR.**
