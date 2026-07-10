# Scripts — Penalty444 3D prototype (Phase B2)

C# scripts for the Penalty444 3D local prototype. All of them are
**presentation-only** — see the authority rules below.

- `PenaltyVisualTypes.cs` — visual-only enums: `PenaltyLane` (LEFT/CENTER/RIGHT),
  `PenaltyVisualResult` (GOAL/SAVE/DRAW), `PenaltyVisualState`
  (Idle/Staging/Revealing/Result/Ended). These do **not** replace the server/web
  types; they only describe what to draw.
- `UnityBridgeReceiver.cs` — the React→Unity message entry point. Exposes public
  dispatch methods + Editor context-menu mocks for `staging_begin`,
  `round_result`, `match_end`, `reset`, and dispatches them to the scene
  controller. In B4 (PR #198) it adds a WebGL entry point
  `OnWebMessage(string json)` that parses the presentation fields of an
  already-validated `PENALTY444_MATCH_EVENT` envelope and dispatches to those
  same methods (it never derives a result from the lanes). Under
  `#if UNITY_WEBGL && !UNITY_EDITOR` it registers the browser bridge in `Start()`.
  No sockets, no network, no auth/token/env reads.
- `../Plugins/WebGL/Penalty444WebBridge.jslib` — the WebGL browser bridge. Adds
  one `window` "message" listener that accepts only same-origin, same-parent
  `PENALTY444_MATCH_EVENT` envelopes, forwards them to
  `UnityBridgeReceiver.OnWebMessage` via `SendMessage`, and posts a single
  `PENALTY444_UNITY_EVENT` `ready` back to the parent. Opens no network, reads no
  cookies/localStorage/tokens/secrets. **A fresh WebGL rebuild is required after
  changing the bridge source.**
- `PenaltySceneController.cs` — visual scene state machine (Idle → Staging →
  Revealing → Result → Ended). Holds references to the kicker/keeper/ball
  placeholders, the three lane targets, and scoreboard/status/banner text.
  Only updates visuals and debug text.
- `LaneTarget.cs` — a LEFT/CENTER/RIGHT lane marker with idle/selected/
  success/failed tint states. No gameplay authority.
- `ResultAnimator.cs` — placeholder goal/save/draw/reset animations
  (Debug.Log + simple transform nudges). No result authority.

Authority rule: these scripts present already-resolved match state only. They
never compute results, submit picks, touch Supabase, or handle auth/wallet
data. The Node realtime server remains the single source of truth. See
`docs/unity-webgl-prototype-plan.md` §2–§3 for the contract and
`docs/unity-b2-local-prototype-scaffold.md` for scene assembly + local testing.
