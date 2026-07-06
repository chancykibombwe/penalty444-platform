# Penalty444Client (Unity) — Scaffold

> Status: **Scaffold only.** This folder currently holds documentation
> placeholders. No Unity engine project, scenes, scripts, or build output are
> committed yet. Engine work begins in the B2 build phase after review.

This is the future home of the Penalty444 3D Unity project. It pairs with the
passive React bridge component `apps/web/src/components/match/MatchRenderer3D.tsx`
(PR #186) and the plans in:

- `docs/unity-webgl-prototype-plan.md` — Phase B2 scope + scene/scripts.
- `docs/unity-webgl-build-pipeline.md` — build output location + gitignore.
- `docs/unity-3d-prototype-plan.md` — overall architecture contract.

## Hard rules (carried from the architecture contract)

- The Node realtime server is the single source of truth.
- Unity is **visual presentation only** — it never computes official results,
  never submits picks, never writes to Supabase, and never receives JWTs,
  service-role keys, wallet data, or private user tokens.
- React owns auth, routing, lobby, match state, and the socket connection.
- Unity communicates with React only via the validated, same-origin
  `postMessage` contract documented in the plan.

## Planned layout (B2)

```
unity/Penalty444Client/
  Assets/
    Scenes/        Penalty444Prototype scene (B2)
    Scripts/       UnityBridgeReceiver.cs, PenaltySceneController.cs,
                   LaneTarget.cs, ResultAnimator.cs (B2)
```

## Not committed

Unity build caches and generated output are excluded via `unity/.gitignore`
(`Library/`, `Temp/`, `Obj/`, `Logs/`, `UserSettings/`, `Builds/`, `Build/`,
`*.csproj`, `*.sln`, `.vs/`). WebGL build output goes to
`apps/web/public/unity/penalty444/` and is treated as a build artifact.
