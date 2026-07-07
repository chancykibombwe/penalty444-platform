# Scenes — Penalty444 3D prototype

Home of the B2 prototype scene.

Contents:

- `Penalty444Prototype.unity` — the canonical B2 prototype scene (PR #190),
  assembled and saved by Unity Editor `6000.4.2f1`. Arena floor, goal frame,
  keeper/kicker capsules, ball, LEFT/CENTER/RIGHT lane targets, scoreboard /
  round status / result banner UI, camera, light, and the wired presentation
  scripts (`PenaltySceneController`, `UnityBridgeReceiver`, `ResultAnimator`,
  `LaneTarget`). See `docs/unity-b2-local-prototype-scaffold.md`.
- `PenaltyMatch.unity` / `SampleScene.unity` — early local editor scenes;
  superseded by `Penalty444Prototype`.

Rules: scenes are visual presentation only. No sockets, no Supabase, no auth,
no wallet/economy, no gameplay authority — the Node realtime server remains the
single source of truth.
