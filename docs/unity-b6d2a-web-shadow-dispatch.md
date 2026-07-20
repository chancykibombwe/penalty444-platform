# Unity B6D2A — Versioned Web Shadow Dispatch and Audit

> **Scope: B6D2A only.** Wires the tested B6D1 contract/adapter into the existing
> optional React→Unity shadow path so real authoritative `round_result` /
> `match_state_sync` envelopes are sent, with safe ordering, queueing, and
> sanitized audit evidence. **Default-off** behind a new third public flag. React
> remains the player-facing renderer and sole client lifecycle owner. **No Unity
> C# change.** B6D2B and B6D3 are **unauthorized**; production remains **NO-GO**;
> reproducibility remains **BLOCKED**.

---

## 1. Scope

B6D2A **dispatches** versioned envelopes into the already-mounted, default-off
Unity shadow iframe. It does **not** claim Unity has applied `match_state_sync`,
does **not** replace the player-facing React renderer, and changes **no** server,
Supabase, Vercel, or Unity source. It only: (a) builds envelopes from raw
authoritative payloads via the pure B6D1 adapter, (b) delivers them in FIFO order,
and (c) records sanitized audit metadata.

## 2. Master base

`bff4c685bb30cff19324b289b84a84a4dc37523c`

## 3. Exact files

- `apps/web/src/components/match/unityPresentationShadow.ts` (new) — pure
  coordinator + FIFO dispatch queue + audit/summary helpers.
- `apps/web/src/components/match/unityPresentationShadow.test.ts` (new) — tests.
- `apps/web/src/components/match/MatchRenderer3D.tsx` — FIFO delivery mode +
  versioned message support (legacy contract preserved).
- `apps/web/src/components/match/MatchRoomPanel.tsx` — narrow versioned dispatch at
  the existing authoritative boundaries + sanitized audit panel.
- `apps/web/package.json` — the `test:unity-presentation` script now runs both
  test files. **No new dependency; `package-lock.json` unchanged.**
- `docs/unity-b6d2a-web-shadow-dispatch.md` (this) + a B6D section update in
  `docs/unity-webgl-build-pipeline.md`.

**Untouched:** `unityPresentationProtocol.ts`, `unityPresentationAdapter.ts`,
`unityPresentationAdapter.test.ts`, `matchPresentation.ts`, `lib/socket/client.ts`,
`apps/realtime-server/**`, `packages/shared/**`, `unity/**`,
`apps/web/public/unity/**`, Supabase, Vercel, GitHub Actions.

## 4. The third feature flag & default-off behavior

A third build-time public flag, `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`. The
B6D2A path runs **only** when all three are exactly `"true"`:

```
NEXT_PUBLIC_UNITY_MATCH_ENABLED
NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED
NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED   ← new
```

`const unityB6D2ShadowEnabled = unityShadowEnabled && process.env.NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED === "true";`

- **Default off.** Missing/false is never treated as enabled; there is no
  enable-by-default fallback.
- The flag is **not** configured in Vercel and **not** added to production by this
  PR.
- When the third flag is absent/false, the **existing two-flag B5 shadow behavior
  is unchanged** (legacy `staging_begin` / `round_result` / `match_end` / `reset`).
- The versioned B6D2A path **replaces** the legacy feed **only while the third
  flag is true**. Existing live feature-flag defaults are unchanged.

## 5. Legacy path preservation

Every legacy shadow feed remains byte-for-byte when B6D2A is off. While on:
- legacy `staging_begin` and `reset` are **suppressed** (the protocol has no such
  events);
- legacy `round_result` and `match_end` are **replaced** by versioned envelopes;
- `MatchRenderer3D` runs in `deliveryMode="latest"` (legacy) by default and only
  `"fifo"` under B6D2A. The legacy `UnityInbound` contract and the Unity→React
  allowlist (`ready` / `animation_complete` / `error`) are unchanged.

## 6. Coordinator design (`UnityPresentationShadowCoordinator`)

Pure TypeScript (no React/Socket.IO/Supabase/browser). Owns the active protocol
`matchInstanceId`, a `PresentationSequenceEmitter`, and the last accepted complete
authoritative snapshot. Uses the B6D1 exports (`deriveMatchInstanceId`,
`PresentationSequenceEmitter`, `buildRoundResultEnvelope`,
`buildMatchStateSyncEnvelope`, `buildTerminalStateSyncEnvelope`,
`PriorStateSnapshot`, `PresentationEnvelope`). Every method returns a controlled
`null` on malformed input and never throws. It never computes a score.

- **`acceptMatchUpdate(roomCode, raw, emittedAt?)`** — requires a positive numeric
  raw `matchInstance`; derives the protocol id from `roomCode + matchInstance`; an
  **explicit new instance** clears the prior snapshot and resets the sequence to
  1; builds `match_state_sync` directly from the raw payload; stores only the
  sanitized envelope payload as the prior snapshot.
- **`acceptRoundResult(raw, emittedAt?)`** — requires an established active
  instance; builds `round_result`; no scores/phase/maxRounds; no result
  derivation; `null` before an instance exists.
- **`acceptMatchEnd(raw, emittedAt?)`** — combines the final authoritative scores
  with the same-instance stored complete snapshot; `null` when no valid
  same-instance prior exists; never fabricates round/maxRounds/phase.
- **`buildReadyResync(emittedAt?)`** — rebuilds a fresh `match_state_sync` from the
  last stored sanitized snapshot with a new sequence; `null` if no snapshot; never
  replays `round_result` history.

## 7. Authoritative integration points (MatchRoomPanel)

MatchRoomPanel is modified **narrowly** — no socket-subscription, timer,
reveal-timing, scoring, reconnect, rematch, or authority changes.

- **`match:update`** — dispatched **after** the room check AND the existing reveal
  gate (deferred updates flush through `onMatchUpdate`, so nothing is sent early).
  Built from the **raw accepted payload** (never `scores`/`liveScoresRef`/
  `maxRounds`/`phase` React state or later effects).
- **`match:result`** — at the existing revealed boundary in `applyRevealedResult`.
  When enabled, the versioned `round_result` is published (no scores, no legacy
  snapshot, no waiting for state sync, no result derivation); when disabled, the
  legacy B5 shadow is preserved exactly.
- **`match:end`** — when enabled, the coordinator attempts a defensive terminal
  state sync (`null` → send nothing); React match-end behavior is unchanged; a
  later full `match:update` may send the preferred complete terminal sync.
- **Unity `ready`/reload** — `MatchRenderer3D` `onReady` triggers
  `buildReadyResync`; when available it is published. No old results are replayed;
  React match state is untouched.
- **Rematch / new instance** — the protocol instance is **never** reset by a
  rematch button/vote. The new authoritative `match:update` with a new numeric
  `matchInstance` performs the transition (sequence resets to 1, prior cleared).

## 8. Sequence and instance behavior

Sequence starts at 1 per instance and increases monotonically in send order; a new
`matchInstanceId` resets to 1. The receiver-side gate (B6D1) rejects
duplicate/stale/foreign messages. Instance changes come **only** from an
authoritative `match:update` carrying a valid numeric `matchInstance` — never from
`match:result`, `match:end`, or an arbitrary message.

## 9. FIFO queue (renderer)

`MatchRenderer3D` gains `deliveryMode?: "latest" | "fifo"` (default `"latest"`
preserves the legacy single-pending behavior). In `"fifo"` mode it uses the pure
`ShadowDispatchQueue`:
- queues messages in prop-arrival order;
- never enqueues an id already sent or already queued;
- flushes in exact FIFO order after Unity is `ready`, via
  `postMessage(msg, window.location.origin)` (never `"*"`);
- caps the queue at **32**; on overflow it fails the preview open as
  `unavailable` (React continues) rather than silently dropping/reordering.

Props added: `messages?` (the ordered list), `activeMatchInstanceId?` (explicit
active instance — on change the queue + per-lifecycle sent ids are cleared; the
renderer never infers an instance from an incoming message), and
`onMessageSent?(summary)` which receives **sanitized** metadata only (`messageId`,
`event`, and `matchInstanceId`/`sequence` for versioned envelopes; never raw
payloads; callback errors never break the renderer). On iframe reload in fifo
mode the queue + sent ids are cleared and the parent's `ready` callback publishes a
fresh state sync — historical `round_result`s are not replayed.

## 10. Ready resync

On Unity `ready`/reload the parent calls `buildReadyResync`, which returns a fresh
`match_state_sync` (new sequence) from the **last stored sanitized complete
snapshot**, or `null` when none exists. It never replays round history and never
reads React state / `liveScoresRef`.

## 11. Terminal `match:end` limitation

`match:end` carries only `{ scores }`. The terminal combiner uses those scores +
the same-instance stored complete snapshot's round/maxRounds/phase, or returns
`null`. The **preferred** complete terminal sync is the server's post-`match:end`
full `match:update` (handled by the normal `acceptMatchUpdate` path).

## 12. Raw `match:rejoinState` limitation

`match:rejoinState` lacks `scores` and `maxRounds`, so it is **not** a complete
snapshot; the coordinator builds **no** `match_state_sync` directly from it
(tested). On reconnect, the complete snapshot comes from the `match:update` the
server also emits.

## 13. Sanitized audit output

While enabled, MatchRoomPanel keeps a tiny audit state: active `matchInstanceId`,
last built event/sequence, last sent event/sequence, latest source-comparison
result, and the Unity lifecycle (`loading`/`ready`/`unavailable`). Console logs use
a consistent **`[unity-b6d2-shadow]`** prefix and log only sanitized audit
summaries. The audit **never** contains player ids, usernames, email, tokens,
socket ids, wallet/economy data, scores-keyed-by-id, or raw payloads — score data
appears only as **sorted numeric values** with a `playerCount`. The experimental
shadow panel (secondary, non-interactive) shows Protocol v1 / active instance /
last sent event+sequence / comparison PASS·FAIL·PENDING / "React authoritative".
It never replaces lane controls, scoreboard, timer, reveal, disconnect, or
match-end UI.

## 14. Source comparison

`compareEnvelopeToSource(envelope, rawSource)` re-checks the constructed envelope's
allowlisted fields against the raw authoritative source (`PASS`/`FAIL`, or
`PENDING` when there is no directly-comparable raw source, e.g. terminal /
ready-resync). It **never** computes a gameplay outcome.

## 15. Test inventory

`npm run test:unity-presentation` runs **both** `unityPresentationAdapter.test.ts`
(58) and `unityPresentationShadow.test.ts` (61) → **119 tests, all passing**, and
runs in the GitHub Web CI job. The shadow tests cover: first-update
instance+sequence-1; invalid/missing `matchInstance`; result-before-instance;
result-after-state next sequence; round_result has no scores/phase/maxRounds;
second-state next sequence; state↔result dispatch order (both orders); stale
pre-result scores not relabeled; later scores copied exactly; no local score
calc; new instance resets to 1; new instance clears the prior; old-instance prior
not reusable for terminal; terminal with valid prior; terminal without prior →
null; ready resync uses last complete state; ready resync never replays result;
raw `match:rejoinState` → no state sync; source extras stripped; sensitive fields
never reach envelope; sensitive fields never reach audit; audit has no player ids;
stable message-id format; hostile getters/proxies never throw; the source
comparison; and the pure queue (FIFO order, duplicate-queued, duplicate-sent,
overflow, reset/reload policy, latest-vs-fifo) + sanitized sent-summary (legacy
vs versioned, junk-safe).

## 15a. Lifecycle corrections (review)

- **Pending-unsent buffer, not replayable history.** The parent keeps only
  **unsent** versioned dispatches (no `.slice(-32)` permanent history). A
  transported message is **removed** when its id is acknowledged via
  `onMessageSent`, so a sent message can never be re-supplied after a reload or
  instance reset. The audit history is kept separately as sanitized scalar
  metadata only.
- **Atomic instance transition.** `acceptMatchUpdate` **validates the complete
  candidate state first**; only on success does it commit (switch instance, reset
  the sequence to 1, clear + replace the prior snapshot). A validation failure
  changes **nothing** — no instance change, no prior clear, **no sequence
  consumed**. Likewise a malformed `round_result` / `match:end` / `ready_resync`
  consumes **no** sequence, so the first valid message after rejected input gets
  the sequence it would have had.
- **Ready / reload discards pre-ready history.** In FIFO mode, on Unity `ready`
  (initial, reload, or a fresh lifecycle) the renderer **discards** any pre-ready
  queued messages and does **not** flush them; the parent replaces its buffer with
  a single fresh `ready_resync` `match_state_sync` (current authoritative state)
  when available. A shadow preview that was not ready at the time of an animation
  does **not** replay that historical animation later — it **resumes from current
  authoritative state**. No earlier `round_result` is replayed.
- **Active-instance isolation.** An explicit `activeMatchInstanceId` change clears
  the renderer queue + sent ids and replaces the parent buffer for the new
  instance; the renderer defensively **rejects** a queued envelope whose
  `matchInstanceId` differs from the active instance; the active instance is never
  inferred from a message; a previous-instance message is never re-enqueued after
  reset; the first successful new-instance state sync is **sequence 1**.
- **Explicit, fail-open overflow.** The FIFO limit is **32 unsent**; the **33rd**
  reaches a controlled overflow that marks the Unity preview `unavailable` through
  the existing fail-open path (React continues). The oldest is **never** trimmed;
  the parent buffer is bounded at **32 + 1** overflow-trigger to prevent unbounded
  memory growth; messages are never reordered.
- **Exact comparison, identity-free audit.** `compareEnvelopeToSource` for
  `match_state_sync` compares the **exact set of player-id keys** and each keyed
  score (a swapped player→score assignment → `FAIL`), plus round / maxRounds /
  phase / `suddenDeathRound` presence+value; `round_result` compares
  round / kickerPick→kickerLane / keeperPick→keeperLane / result. It computes **no**
  outcome, and the returned **audit summary still contains no player ids** (sorted
  numeric values + `playerCount` only).
- **Validated sent-summary.** `summarizeSentMessage` uses B6D1 `validateEnvelope`;
  only a fully-validated `PresentationEnvelope` contributes `matchInstanceId` +
  `sequence`. A malformed "versioned-looking" object (bad protocol version,
  invalid/negative sequence, malformed payload) receives **no** invented
  instance/sequence; legacy messages keep only a sanitized known event name.

## 16. Status

- **Runtime behavior is unchanged while the flag is off.**
- **No Unity C# change.**
- **This PR proves the versioned envelopes are BUILT, ORDERED, and DISPATCHED —
  it does NOT prove Unity has APPLIED `match_state_sync`** (that evidence belongs
  to a later gate).
- **B6D2B remains unauthorized. B6D3 remains unauthorized.**
- **Production remains NO-GO. Reproducibility remains BLOCKED.**
