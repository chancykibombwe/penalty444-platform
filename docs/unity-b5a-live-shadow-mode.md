# Unity B5A — Live Resolved-Round Shadow Mode (PR #199)

> **Superseded sequencing (see `docs/unity-b5b1-staging-result-sequence.md`, PR
> #200):** B5A sent `round_result` to Unity immediately when the authoritative
> `match:result` was accepted, so Unity revealed the outcome before the React
> tension window finished. **B5B1** changes this to a two-phase, React-timed
> sequence: `staging_begin` when React enters REVEALING, and `round_result` only
> when React reaches REVEALED. The flags, authority model, and everything else in
> this document are unchanged.

> Status: **Optional, default-off, dev-only shadow preview.** B5A is **not** the
> final live Unity mode. It mounts `MatchRenderer3D` in the live Penalty444 match
> page purely to mirror already-resolved rounds. The React renderer remains the
> primary, authoritative match experience and is unchanged.

## What B5A does

When (and only when) two build-time flags are both `"true"`, the live match page
(`MatchRoomPanel`) renders an extra, clearly-labelled secondary **shadow preview**
below the arena. Each time the existing `match:result` flow accepts an
authoritative, server-resolved round, the panel forwards a single `round_result`
presentation message into the Unity iframe (`MatchRenderer3D`). Nothing else
about the match changes.

## What B5A explicitly is NOT

- Not a replacement for the React renderer (React stays visible + authoritative).
- Not a new socket listener — it reuses the existing `match:result` handler.
- Not gameplay authority — Unity never submits picks, computes GOAL/SAVE/DRAW,
  compares lanes, changes scores, advances rounds, or affects timers, reconnect,
  match-end, or persistence.
- Not for production — the shadow flag must stay off in production during B5A.

## Feature flags (public, build-time only)

The shadow preview mounts only when BOTH are exactly `"true"`:

- `NEXT_PUBLIC_UNITY_MATCH_ENABLED=true`
- `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED=true`

Plus the build URL:

- `NEXT_PUBLIC_UNITY_BUILD_URL=/unity/penalty444/index.html`

Default behaviour when the flags are absent/false: **no Unity iframe, no Unity
state, no Unity listeners** — the match page behaves exactly as on current
master. Set these in `apps/web/.env.local` for local testing only; **do not**
commit `.env.local`, and **do not** enable the shadow flag in production during
B5A.

## Event scope

- **React → Unity:** `round_result` only (built from accepted authoritative
  state — `kickerLane`/`keeperLane`/`result` from the accepted result;
  `round`/`maxRounds`/`phase` from current authoritative match state). If either
  lane is null, the message is skipped. The result is taken directly from the
  server; it is never inferred from the lanes.
  - **Scores:** the message carries the **latest client-held authoritative score
    snapshot** for contract completeness only. `match:result` does **not** include
    scores, so this snapshot may be the pre-result score. B5A performs **no local
    score calculation**, and **Unity ignores scores in B5A**.
- **Unity → React:** `ready` (gates message delivery) and `error` (logged as a
  non-blocking dev warning). No dependency on `animation_complete`.
- **Not wired in B5A:** `staging_begin`, `match_end`, `reset`,
  `animation_complete`, score sync, round advancement, live fallback switching,
  production replacement mode. Those are later B5 increments.

## Delivery & dedup

- Messages are held pending until Unity signals `ready`, then delivered.
- Each message carries a stable id (`roomCode:matchInstance:round:result`) and is
  delivered at most once per iframe lifecycle; an iframe reload resets that so the
  latest pending message can be re-delivered after the next `ready`.
- All `postMessage` is same-origin (`window.location.origin`), targeted at the
  iframe's own window — never `"*"`.

## Failure behaviour (fail open)

Every failure falls back to the normal React renderer: flag off, missing build
URL, missing iframe, Unity never sends `ready`, `postMessage` error, malformed
Unity message, or a Unity `error` event — none of these block, delay, or freeze
the match. Unity can never stall a match.

## Not committed / not rebuilt

No Unity C# or `.jslib` changes are in PR #199, so no new WebGL rebuild is
required. No WebGL build output is committed (it stays git-ignored under
`apps/web/public/unity/penalty444/`).

## Next

B5B and beyond (staging/end/reset events, animation-complete pacing, and any path
toward a production visual mode) remain future work and are not started here.
