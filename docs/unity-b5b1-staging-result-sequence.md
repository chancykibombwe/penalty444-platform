# Unity B5B1 — Live Staging & Timed Result Sequence (PR #200)

> Status: **Optional, default-off, dev-only.** Improves the B5A live shadow
> preview so Unity follows React's existing reveal timing instead of revealing
> the result early. React remains the primary, authoritative match experience;
> Unity is a presentation-only shadow renderer that never controls React.
>
> **Extended by B5B2 (`docs/unity-b5b2-match-end-rematch-reset.md`, PR #201):**
> adds `match_end` (at the existing terminal `onMatchEnd` boundary, after the
> final round result's reveal hold) and `reset` (on confirmed
> `onRematchAccepted`). Same flags, authority model, and fail-open renderer.

## What changed vs B5A

B5A forwarded `round_result` to Unity the moment an authoritative `match:result`
was accepted — so Unity showed GOAL/SAVE/DRAW before the React REVEALING tension
window finished. B5B1 splits that into two phases, both driven entirely by
React's existing timing:

1. **`staging_begin`** is sent when the accepted result enters React **REVEALING**
   (inside the existing `onMatchResult` flow, after all current validation, right
   before `clearAllRevealTimers()` / `setRevealStage("REVEALING")`). Unity moves
   to its "Get ready…" staging pose.
2. **`round_result`** is sent only when React reaches **REVEALED**, from inside
   the existing `applyRevealedResult(authoritative)` (right after the REVEALED
   state setters). Unity then plays its existing result animation.

`applyRevealedResult` is already the point where React enters REVEALED, so it is
reused as the sequencing boundary — **no new timer, no `setTimeout`, and no
duplication of React's reveal timing** is added for Unity.

## Why B5B is split (B5B1 vs B5B2)

B5B1 does only the smallest observable improvement — correct staging→result
ordering for the round presentation — so it can be reviewed and runtime-tested in
isolation. `match_end` and `reset` integration is deferred to **B5B2**.

## Message ids

- staging: `roomCode:matchInstance:round:staging`
- result:  `roomCode:matchInstance:round:result`

They are distinct per round, built from authoritative identifiers.
`Date.now()` is used **only** for the `staging_begin` `startsAt` payload field,
never as a message identity.

## Late / missing Unity (fail-open)

`MatchRenderer3D` keeps only the latest pending message until Unity signals
`ready`. So:

- If Unity is ready, `staging_begin` sends during REVEALING and `round_result`
  sends at REVEALED.
- If Unity becomes ready **late** — after the `round_result` has already replaced
  the pending `staging_begin` — Unity simply receives the latest result. That is
  acceptable; staging is best-effort.
- React **never** waits for Unity. There is no retry loop, no unbounded queue, and
  no `animation_complete` dependency. Any delivery failure is caught and surfaced
  as a non-blocking dev warning.

## Unity `BeginStaging` pose reset

`PenaltySceneController.BeginStaging` now calls `resultAnimator?.PlayReset()`
before showing the staging text. This restores the ball/keeper to their idle
poses from the previous round's result animation. It does **not** call
`ResetScene()`, does **not** reset the visual round counter (rounds keep
incrementing), introduces no timer, and computes nothing. `ShowRoundResult`,
`ShowMatchEnd`, `ResetScene`, and `ResultAnimator` timing are unchanged.

## Events

- **React → Unity:** `staging_begin`, `round_result`.
- **Unity → React:** `ready` (gates delivery), `error` (non-blocking dev warning).
- **Not implemented / not depended on:** `animation_complete`, `match_end`,
  `reset`, `pick_selected`, score sync, match progression, fallback switching,
  Unity-controlled pacing. `match_end` and `reset` are B5B2. If
  `animation_complete` is ever added it must be telemetry-only and must never
  gate authoritative match progression.

## Flags & production

Unchanged from B5A — both `NEXT_PUBLIC_UNITY_MATCH_ENABLED` and
`NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED` must be exactly `"true"`, plus
`NEXT_PUBLIC_UNITY_BUILD_URL`. When either boolean flag is false there is no
Unity iframe, no staging/result message, and no presentation bookkeeping — the
match behaves exactly as on master. Shadow mode stays **default-off and
non-production**; `.env.local` is not committed.

## Rebuild note

`PenaltySceneController.cs` changed, so **a fresh Unity WebGL rebuild is required**
before this can be validated (rebuild to `apps/web/public/unity/penalty444/`).
The WebGL output stays git-ignored and is never committed. No `.jslib` or
`UnityBridgeReceiver.cs` change was needed — `staging_begin` and `round_result`
were already supported.
