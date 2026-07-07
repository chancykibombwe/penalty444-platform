# Scenes — Penalty444 3D prototype

Home of the B2 prototype scene. The canonical prototype scene is
`Penalty444Prototype` — assemble it manually inside the Unity Editor following
`docs/unity-b2-local-prototype-scaffold.md` (GameObject list + which script
attaches where). No scene YAML is hand-authored in git; scenes are created and
saved from the Editor.

Contents:

- `PenaltyMatch.unity` / `SampleScene.unity` — early local editor scenes;
  superseded by `Penalty444Prototype` once assembled.

Rules: scenes are visual presentation only. No sockets, no Supabase, no auth,
no wallet/economy, no gameplay authority — the Node realtime server remains the
single source of truth.
