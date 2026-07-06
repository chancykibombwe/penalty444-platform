# Scripts — Scaffold placeholder

Planned C# scripts for the Penalty444 3D prototype (documented now, implemented
in the B2 build phase — no `.cs` files are committed in this PR):

- `UnityBridgeReceiver.cs` — receives validated React→Unity `PENALTY444_MATCH_EVENT`
  messages (`staging_begin`, `round_result`, `match_end`, `reset`) and dispatches
  them to the scene controller. Emits only presentation hints back to React
  (`ready`, `animation_complete`, `error`). Never authoritative.
- `PenaltySceneController.cs` — scene state machine (idle → staging → reveal →
  result → reset), driven purely by received events.
- `LaneTarget.cs` — a LEFT / CENTER / RIGHT lane marker and its highlight state.
- `ResultAnimator.cs` — plays goal / save / draw placeholder animations.

Authority rule: these scripts present already-resolved match state only. They
never compute results, submit picks, touch Supabase, or handle auth/wallet data.
See `docs/unity-webgl-prototype-plan.md` §3 for the message contract.
