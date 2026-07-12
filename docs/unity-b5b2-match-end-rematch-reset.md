# Unity B5B2 — Live Match-End & Rematch Reset (PR #201)

> Status: **Optional, default-off, dev-only.** Completes the terminal presentation
> of the Unity live shadow preview by adding exactly two React→Unity events on top
> of B5A/B5B1. React and the Node realtime server remain the sole authority; Unity
> is presentation-only and never controls, delays, or gates React.

## What B5B2 adds

Exactly two events, sent from the existing authoritative handlers:

1. **`match_end`** — sent only when the existing React `onMatchEnd` flow **applies
   the authoritative terminal match state** (the terminal branch), not the
   reveal-active deferral branch. Because a reveal-active `onMatchEnd` defers and
   re-runs after the reveal hold, the **final round result still completes its
   existing reveal hold first**; only then does Unity receive `match_end` and show
   its MATCH OVER / MATCH DRAW banner.
2. **`reset`** — sent only when the existing React `onRematchAccepted` flow resets
   the match for a **confirmed** rematch, after all of React's existing reset
   state has been applied. Unity returns to its idle/waiting scene.

No other Unity event is added.

## Final-score presentation classification

`getUnityMatchEndPresentation(scores)` is a pure helper that reads **only** the
final authoritative score snapshot the server already produced:

- keeps only finite numeric entries; requires **≥ 2** valid entries or returns
  `null`;
- one player with the highest score → `{ winnerId, isDraw: false }`;
- a tie for the highest score → `{ winnerId: null, isDraw: true }`.

It classifies an **already-ended** match for presentation only — it never decides
whether the match ends and never mutates scores. If it returns `null` (malformed
/ fewer than two entries), **no Unity `match_end` is sent** and React continues
normally (a dev-only `console.warn` may note the skip). The handler reads
`payload.scores` directly (no stale React render values).

## Reset semantics

The `reset` message is presentation-only. It does **not** accept the rematch,
start the next round, change `matchInstance`, clear server state, or affect React
timing. The subsequent authoritative `match:update` drives the new rematch state.

## Message ids

- match end: `roomCode:matchInstance:match-end`
- rematch reset: `roomCode:matchInstance:rematch-reset`

Both are stable (no `Date.now()` identity). A duplicate `match:end` for the same
match instance produces the same id and is deduplicated by `MatchRenderer3D`
(delivered at most once per iframe lifecycle). The reset id intentionally uses the
**current (terminal)** match instance — it identifies the match being cleared; the
next rematch's `matchInstance` arrives via the existing authoritative
`match:update`.

## Late Unity / fail-open

`MatchRenderer3D` keeps only the latest pending message until `ready`. So Unity
ready in time receives the final `round_result` then `match_end`; Unity ready late
may receive only the latest `match_end`; a rematch accepted before Unity readies
may have `reset` replace a pending `match_end`. React never waits for Unity — no
new timer, no retry loop, no unbounded queue, no acknowledgements, and no
`animation_complete` dependency.

## Explicitly out of scope

No Unity events for: match aborted, match cancelled, rematch declined, terminal
rejoin redirect, room-not-found, forfeit initiation, disconnect countdown, or
tournament redirect. Not implemented: `animation_complete`, `pick_selected`, score
sync, Unity-controlled timers/progression, production renderer replacement, Unity
input, or match-result calculation.

## Flags, Unity source, and rebuild

Unchanged B5A flags (`NEXT_PUBLIC_UNITY_MATCH_ENABLED` +
`NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED`, both `"true"`, plus
`NEXT_PUBLIC_UNITY_BUILD_URL`); either false → no iframe and no shadow messages.
Default-off and non-production. **No Unity source change** — the current build
already supports `match_end` and `reset`, so **no fresh WebGL rebuild is
required** (reuse the existing B5B1 build). The existing generic MATCH OVER /
MATCH DRAW terminal presentation is acceptable for B5B2. Generated WebGL output
stays git-ignored and uncommitted.
