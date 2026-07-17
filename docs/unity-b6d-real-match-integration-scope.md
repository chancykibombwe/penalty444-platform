# B6D REAL-MATCH UNITY INTEGRATION — SCOPE AND RISK BRIEF

> **Status: PROPOSAL / PLANNING ONLY.** This document authorizes no code, no
> deployment, and no production activation. It defines the scope, contract,
> gates, and risks for a *possible* future B6D. The only decision requested is in
> §14. Throughout, this brief labels each statement as one of: **[Current
> verified behavior]** (exists in the repo today, cited), **[Proposed B6D
> design]** (not built), or **[Future recommendation]**. Event/state names are
> quoted from the repository as of master `11f847a3f48fb2c0a91df6df7bb03d76ed2118db`.

---

## 1. EXECUTIVE SUMMARY

In plain terms:

- **B6C proved Unity can be built, deployed and tested safely.** The B6C
  staging-runtime gate is **PASS**: a versioned Unity WebGL release was built
  locally, deployed as an immutable Vercel *preview* artifact, served same-origin
  through the main app, driven with mock events, and confirmed isolated from
  Socket.IO/Supabase. (See `docs/unity-b6c-versioned-staging-delivery.md` §14.3.)
- **B6D would connect the Unity presentation to REAL Penalty444 matches** — so
  that when the server resolves a real round, Unity can *show* it — instead of
  only mock events.
- **Node.js / Socket.IO remains the sole gameplay authority.** The realtime
  server decides every outcome (GOAL/SAVE/DRAW, scores, winner, timeouts, sudden
  death, forfeits). B6D changes none of that.
- **Unity must remain presentation-only.** It renders what it is told and never
  computes or reports a result.
- **The current React renderer must remain available as fallback.** If Unity is
  missing, slow, or errors, the match continues in the existing React UI with no
  interruption.
- **B6D is preview / free-play only.** No production activation, no economy, no
  real money.
- **This document authorizes no production activation.** It is a brief, not an
  implementation.

---

## 2. CURRENT VERIFIED BASELINE

**[Current verified behavior]** The locked baseline this brief builds on:

- **master merge commit:** `11f847a3f48fb2c0a91df6df7bb03d76ed2118db`
- **B6C staging-runtime gate:** **PASS**
- **artifact release:** `b6b-local-fb840878-d`
- **Unity editor:** `6000.4.2f1`
- **B6C mock events proven** (React → Unity, `type: "PENALTY444_MATCH_EVENT"`):
  `staging_begin`, `round_result`, `match_end`, `reset`
  (`apps/web/src/components/match/MatchRenderer3D.tsx:73-89`).
- **Strict same-origin iframe bridge:** inbound handler requires
  `event.origin === window.location.origin` **and**
  `event.source === iframeRef.current?.contentWindow`
  (`MatchRenderer3D.tsx:296-297`); outbound `postMessage` always targets
  `window.location.origin`, never `"*"` (`:279`).
- **Exact iframe source validation:** as above (`event.source` must be the
  iframe's own `contentWindow`).
- **Ready/error inbound allowlist:** `validateUnityMessage` accepts only
  `PENALTY444_UNITY_EVENT` with event `ready`, `animation_complete` (finite
  numeric `round` required), or `error` (message coerced to string); everything
  else is silently ignored (`MatchRenderer3D.tsx:118-150`).
- **Route isolation from Socket.IO and Supabase:** the B6C staging verification
  route `/dev/unity-staging` mounts no realtime/auth components
  (`RouteAwareAppShell`), Socket Network filter verified empty at runtime.
- **Production staging route remains 404:** `/dev/unity-staging` returns
  `notFound()` when `VERCEL_ENV === "production"`.
- **Unity is not active in live matches.** In the live match, `MatchRenderer3D`
  is mounted as a **default-off shadow** in `MatchRoomPanel.tsx:3861`, fed only
  when **both** `NEXT_PUBLIC_UNITY_MATCH_ENABLED` and
  `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED` equal `"true"`
  (`MatchRoomPanel.tsx:1456-1457`, `:1744-1745`, `:1850-1851`); both default off.

> Note **[Current verified behavior]**: the `MatchRenderer3D.tsx` file header
> comment still says "PASSIVE RENDERER SHELL ONLY / NOT mounted" — that comment is
> **stale**; the component *is* mounted as a gated shadow. B6D docs should not
> rely on that comment.

---

## 3. B6D OBJECTIVE

**[Proposed B6D design]** Safely prove that the Unity presentation can consume
**authoritative real-match presentation events** while the existing web match,
server rules, scores, timers, reconnect behavior and lifecycle remain
**unchanged**. Unity becomes an optional *view* of the already-decided match; it
never becomes part of deciding the match.

---

## 4. NON-NEGOTIABLE ARCHITECTURE

**[Current verified behavior + B6D design constraint]** These rules are already
true today and must remain true in every B6D subphase:

- The **realtime server decides all gameplay outcomes** (`apps/realtime-server/`).
- **Unity never decides** GOAL, SAVE, DRAW, scores, winner, timeout, forfeit, or
  sudden death.
- **React / Next.js owns the Socket.IO connection** (`getSocket()` in
  `apps/web/src/lib/socket/client.ts`; consumed by `MatchRoomPanel.tsx`).
- **Unity must not connect directly to Socket.IO.**
- **Unity must not connect directly to Supabase.**
- **Unity receives sanitized presentation messages only** (same-origin
  `postMessage` from React; see §6).
- **`MatchRoomPanel` remains the gameplay/lifecycle authority on the client** —
  it owns timers, reveal timing, scores, reconnect countdown, and the match state
  machine.
- **Unity cannot write to match state** — the inbound allowlist accepts only
  `ready` / `animation_complete` / `error`, none of which carry results, picks,
  scores, or authority (`MatchRenderer3D.tsx:118-150`).
- **React renderer remains the fallback** and stays fully authoritative for
  display.
- **All activation remains feature-flagged**
  (`NEXT_PUBLIC_UNITY_MATCH_ENABLED`, `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED`, and
  any new B6D flag).
- **Production defaults to Unity off.**
- **Failure must fail open to the current React renderer** — on missing build,
  ready-timeout (`UNITY_READY_TIMEOUT_MS = 15_000`, `MatchRenderer3D.tsx:173`),
  iframe error, or a throwing `postMessage`, the iframe unmounts and React
  continues (`markUnavailable`, `:241`).

---

## 5. AUTHORITATIVE EVENT MAPPING

This maps the **real** current match events/state to a proposed Unity
presentation. **All event names below are [Current verified behavior] quoted from
the repo.** The "Proposed Unity message" column is **[Proposed B6D design]**.

**Key facts that shape the mapping [Current verified behavior]:**

- Server → client match events are string literals emitted at each call site;
  **there is no single shared typed event-contract module** — *Not yet defined*.
  `packages/shared/src/types.ts` contains an **older** `RoundResult`/`MatchResult`
  that does **not** match the live events (its `RoundResult.result` is
  `"GOAL" | "SAVE"` with **no `DRAW`**) — do not use it as the B6D contract.
- **Score atomicity — the round result is NOT self-scoring [Current verified
  behavior].** The server increments `room.scores[pointWinnerId]`
  (`apps/realtime-server/src/index.ts:1598`) **before** it emits `match:result`
  (`:1624`), and **`match:result` carries no scores / no phase / no maxRounds**
  (`index.ts:1614-1623`). The authoritative post-result scores arrive
  **separately** on a later `match:update` (`index.ts:720-739`). The existing
  Unity shadow copies `liveScoresRef.current` into its `round_result.scores`
  (`MatchRoomPanel.tsx:1470-1482`), and the source there **explicitly warns** that
  this snapshot "may be pre-result … no local score calc … Unity ignores scores".
  Therefore:
  - **The current shadow score field is NOT safe for a player-facing Unity
    scoreboard** — at the moment `round_result` is built, `liveScoresRef` may
    still hold the *pre-result* scores (the post-result `match:update` may not
    have arrived yet).
  - **B6D must never calculate the new score locally** from the result or lane
    data — the server is the only place a score changes.
  - **A `round_result` presentation must not claim a post-result score** unless a
    **correlated authoritative state update** (a `match:update` / `match:end`
    snapshot for that round) has actually been received.
  - **The exact score-correlation rule is a B6D1 contract decision** (see §6, §7),
    *not* something to be inferred from `match:result` alone. Merely "joining
    `match:result` with the latest `match:update`" is **not** a sufficient
    authoritative-score strategy, because the "latest" update may predate the
    increment.
- A **field-name mismatch** already exists and must be handled by the adapter:
  server sends `kickerPick` / `keeperPick`; the Unity `RoundResultPayload` uses
  `kickerLane` / `keeperLane` (mapped at `MatchRoomPanel.tsx:1471-1472`).
- Stable identifiers exist server-side: **`matchInstance: number`** (on
  `match:update`, `match:aborted`, `match:rejoinState`) and a server
  **`matchInstanceId`** rotated on rematch reset (`rematch.ts` `resetRoomForRematch`).
  Whether `matchInstanceId` is currently forwarded into any Unity payload is
  *Not yet defined* (today only the numeric `matchInstance` is exposed on
  `match:update`).

For **every** mapped event, B6D must specify: authoritative source · React
state/source location · proposed Unity message · required fields · fields never
trusted from Unity · duplicate/idempotency expectation · behavior if Unity is
unavailable. The table below records the current facts and the proposal; blanks
are *Not yet defined* and must be resolved in B6D1 review.

| Real match event/state (authoritative source) | React state / source location | Proposed Unity message **[B6D]** | Required fields | Fields NEVER trusted from Unity | Duplicate / idempotency | If Unity unavailable |
|---|---|---|---|---|---|---|
| **match ready / start** — `room:update` (`isReady`), `match:update` first emit (`index.ts:671`, `:740`) | `MatchRoomPanel` `match:update` handler; `isStaging`/`round` state | `staging_begin` (existing) + a proposed `match_start` | `matchInstanceId`, `round`, `maxRounds`, `phase` | all | dedupe by (matchInstanceId, event) | React renders staging/match normally |
| **staging begin** — `match:stagingBegin` `{ roomCode, startsAt, durationMs }` (`readiness.ts:161`) | `isStaging`, `stagingStartsAt`, `stagingDurationMs` (`MatchRoomPanel.tsx:584-586`) | `staging_begin` `{ startsAt }` (existing, `MatchRenderer3D.tsx:83`) | `startsAt` | all | one per staging; ignore stale | staging shown in React |
| **round number** — `match:update.round` / `match:interRound` (`index.ts:1831`) | `round`, `maxRounds` (`:497-498`) | field on `round_result` / proposed `round_begin` | `round`, `maxRounds` | all | monotonic per matchInstanceId | React scoreboard |
| **kicker lane locked** — server `picksLocked.KICKER` on `match:update` (`index.ts`) | `picksLocked`, `opponentPicked` (`:541`) | *Not yet defined* (proposed `pick_locked` presentation-only, **no lane value revealed pre-reveal**) | role only, never the lane | the lane value, the identity of the pick | one per role per round | React lock indicator |
| **keeper lane locked** — `picksLocked.KEEPER` on `match:update` | as above | as above | role only | lane value | one per role per round | React lock indicator |
| **reveal beginning** — client-timed: `RevealStage` → `REVEALING` (`matchPresentation.ts:17`; `MatchRoomPanel` reveal logic) | `revealStage`, `revealStageRef` (`:505`, `:628`) | `staging_begin` is currently reused for reveal staging in shadow mode; proposed dedicated `reveal_begin` | `round` | all | idempotent per (matchInstanceId, round) | React reveal animation |
| **authoritative round result GOAL/SAVE/DRAW** — `match:result` `{ round, kickerPick, keeperPick, result, statusMessage }` (`index.ts:1614-1623`) | built at `MatchRoomPanel.tsx:1470-1482` | **Proposed split (§6):** immediate `round_result` `{ round, kickerLane, keeperLane, result, statusMessage? }` — **no scores** (drives the shot animation only) | round, lanes, result | **result, lanes** from server, never Unity; **no score field here** | exactly once per (matchInstanceId, round); drop replays | React result overlay (`MatchResultOverlay`) |
| **current authoritative scores / phase** — `match:update.scores`/`phase`/`maxRounds` (`index.ts:720-739`), `match:end.scores` (`:1347`), `match:rejoinState` (`rooms.ts:464-484`) | `scores`, `displayScores`, `liveScoresRef` (`:493-494`) | **Proposed `match_state_sync` (§6)** `{ scores, round, maxRounds, phase, suddenDeathRound? }` — built **only** from an authoritative snapshot; drives the scoreboard/phase | `scores: Record<playerId,number>`, round, maxRounds, phase | scores/phase from server, never Unity; **React never infers a score increase** | last-write-wins by sequence per matchInstanceId; idempotent | React scoreboard |
| **normal phase** — `phase: "NORMAL"` on `match:update`/`match:status` | `phase` (`:499`) | `phase` field on payloads | `phase` | phase | idempotent | React |
| **sudden death phase** — `phase: "SUDDEN_DEATH"`, `match:status` sudden-death entry (`index.ts:1760`), `suddenDeathRound` | `phase`, `suddenDeathRound` (`:499-500`) | proposed `phase_change` + `phase` on `round_result` | `phase`, `suddenDeathRound` | phase | one per transition | React sudden-death UI |
| **timeout outcome** — pick timeout server-side (`PICK_TIMEOUT_MS = 10000`, `config.ts:15`); result still emitted as `match:result` | `timer`, `result` (`:531`, `:502`) | folded into `round_result` (server decides) | as round_result | result | once per round | React |
| **forfeit** — `match:forfeit` (C→S, `matchActions.ts:340`); server sets opponent score `maxScore+1` then `endMatch` (`disconnectGrace.ts:120-130`) | `match:end` handler | `match_end` `{ winnerId, isDraw }` | `winnerId`, `isDraw` | winner/draw | once per matchInstanceId | React end overlay |
| **early cancellation** — `match:aborted` `{ roomCode, abortedBy, matchInstance, reason:"early_cancel" }` (`index.ts:1474-1484`); `match:abortEarly` (C→S) | `matchAborted` (`:874`) | proposed `match_aborted` (or reuse `reset`) | `matchInstance`, `reason` | all | once | React abort UI |
| **opponent disconnect / reconnect** — `match:status` disconnect-grace armed `{ …, expiresAt }` (`disconnectGrace.ts:90`) and reconnect (`:234`) | `disconnectCountdown` (`:588`) | proposed `opponent_status` (presentation hint only) | `expiresAt` or remaining seconds | all | latest-wins | React countdown banner |
| **reconnect countdown** — `DISCONNECT_FORFEIT_MS = 39_000` (`disconnectGrace.ts:8`); client derives from `expiresAt` | `disconnectCountdown` | field on `opponent_status` | remaining seconds | all | latest-wins | React countdown |
| **resumed match** — `match:status` resume `{ …, isResume: true }` (`timers.ts:325`); `match:rejoinState` active (`rooms.ts:485`) | rejoin handler; `RESUME_FLOOR_MS = 1500` (`timers.ts:269`) | proposed `match_resume` / re-sync via `reset` + replay of current state | `round`, `phase`, `scores`, `matchInstanceId` | all | idempotent full-state resync | React resumes |
| **match end: victory / defeat / draw** — `match:end` `{ scores, tournamentId? }` (`index.ts:1347`); winner derived client-side | `getUnityMatchEndPresentation(scores)` → `{ winnerId, isDraw }` (`MatchRoomPanel.tsx:268-291`) | `match_end` `{ winnerId, isDraw }` (`MatchRenderer3D.tsx:80`) | `winnerId`, `isDraw` | winner/draw | once per matchInstanceId | React end overlay (`getPostMatchPresentation`) |
| **rematch accepted** — `match:rematch:accepted` (no payload, `rematch.ts:57`) | rematch handlers | `reset` (existing, `MatchRenderer3D.tsx:89`) | none | all | once per accepted | React resets |
| **rematch declined** — `match:rematch:declined` `{ declinedBy }` (`rematch.ts:287`) | `rematchDeclinedBy` (`:808`) | proposed `rematch_declined` or none | `declinedBy` (presentation only) | all | once | React shows declined |
| **rematch reset** — `resetRoomForRematch` bumps `matchInstance`/`matchInstanceId`, `round=1`, `phase=NORMAL`, `scores={}` (`rematch.ts:46-114`) | new `match:update` after reset | `reset` then fresh `staging_begin` | new `matchInstanceId` | all | new matchInstanceId invalidates prior | React fresh match |
| **room / match aborted** — `match:aborted` (`index.ts:1484`), `match:cancelled` `{ reason:"opponent_did_not_return" }` (`readiness.ts:347`) | `matchAborted`, `cancelledMessage` (`:874`, `:587`) | proposed `match_aborted` / `reset` | `reason` | all | once | React abort/cancel UI |

**Related client→server events (never sent to Unity, listed for completeness):**
`match:pick` `{ roomCode, lane, playerId, matchInstance?, clientEventId? }`
(`matchActions.ts:69`), `match:abortEarly`, `match:forfeit`, `match:rematch`,
`match:rematch:decline`, `room:create/join/cancel/leave`, `player:present/leave`.

**Current event-handler reality [Current verified behavior]** (corrected):

- **Handled by `MatchRoomPanel`** (in its `socket.on` set, `MatchRoomPanel.tsx:2113-2130`):
  `match:waitingForOpponent`, `match:stagingBegin`, `match:cancelled` (plus
  `match:update`, `match:result`, `match:status`, `match:interRound`, `match:end`,
  `match:aborted`, `match:rejoinState`, `match:rematch:update/accepted/declined`,
  `error:message`, `room:update`, `connect`, `disconnect`).
- **NOT registered by `MatchRoomPanel`:** `match:opponentReady`,
  `match:rematch:finalizing`, `match:rematch:still-finalizing`.
- **`match:opponentReady` is handled by the global readiness notification**
  (`MatchReadyNotification.tsx:119`, `socket.on("match:opponentReady", …)`), **not**
  by `MatchRoomPanel`, and it has **no** part in the Unity mapping.

The Unity presentation mapping for `match:opponentReady`,
`match:rematch:finalizing`, and `match:rematch:still-finalizing` is **Not yet
defined**; B6D1 must decide which (if any) need a Unity presentation and which are
React-only. (`match:rematch:still-finalizing` is emitted at `rematch.ts:217` but
is not consumed anywhere on the client today.)

---

## 6. PROPOSED B6D MESSAGE CONTRACT

**[Proposed B6D design — requires code review before implementation.]** A
versioned, presentation-only envelope, extending the existing
`PENALTY444_MATCH_EVENT` shape:

```
{
  "type": "PENALTY444_MATCH_EVENT",
  "protocolVersion": 1,
  "matchInstanceId": "<stable per-match presentation id>",
  "sequence": 1,
  "event": "<round_result | match_state_sync | match_end | staging_begin | reset | ...>",
  "emittedAt": 1730000000000,
  "payload": { }
}
```

Field definitions **[Proposed]**:

- **`protocolVersion`** — integer, starts at `1`. Lets Unity reject a payload it
  does not understand and lets React detect a version skew after a cache-stale
  Unity build. *Not currently present on any message — new in B6D.*
- **`matchInstanceId`** — a **stable identifier for the current match instance**.
  The server already rotates a `matchInstanceId` on rematch reset and exposes a
  numeric `matchInstance`; B6D would forward a stable string id (server
  `matchInstanceId`, or `matchInstance` coerced to string) so Unity can discard
  any message not belonging to the match currently on screen.
- **`sequence`** — a **monotonically increasing** integer per `matchInstanceId`,
  assigned by React when it sends to Unity. Unity ignores any `sequence` ≤ the
  last it applied for that `matchInstanceId`. *New in B6D.*
- **`event`** — one of the allowlisted presentation events (§5). Unknown events
  are ignored (as `validateUnityMessage` already does for inbound).
- **`payload`** — **sanitized** presentation data only (see the split below).
- **`emittedAt`** — optional epoch-ms timestamp for ordering diagnostics and
  stale detection.
- **Explicitly absent, always:** no auth token, no Supabase token/session, no
  Socket.IO credentials, no wallet/economy data, no raw player PII beyond the
  display fields already shown in the React UI.

### 6.1 Split presentation contract — result vs. state [Proposed; requires B6D1 review]

Because scores are **not** atomic with `match:result` (§5 score-atomicity), the
result animation and the scoreboard must be **decoupled** into two messages. This
is a **proposed design requiring B6D1 review**, not a decision already made.

**A. Immediate authoritative result — `event: "round_result"`**

- payload: `{ round, kickerLane, keeperLane, result, statusMessage? }`
- **Does NOT require or carry scores.** It drives the **shot animation** only.
- `result` and the lanes come only from the server `match:result`.

**B. Authoritative state snapshot — `event: "match_state_sync"`**

- payload: `{ scores, round, maxRounds, phase, suddenDeathRound? }` (include
  `suddenDeathRound` when `phase === "SUDDEN_DEATH"`).
- **May only be built from an authoritative snapshot** — a `match:update`
  (`index.ts:720-739`), a `match:rejoinState` (`rooms.ts:464-484`), or a
  `match:end` (`index.ts:1347`). It drives the **scoreboard / phase** presentation.

Both messages still carry **`protocolVersion`, `matchInstanceId`, and
`sequence`** (and optional `emittedAt`). Contract rules:

- **`round_result` drives the shot animation; `match_state_sync` drives the
  scoreboard/phase presentation.**
- **Unity must tolerate either message arriving first, or being repeated** (e.g.
  a `match_state_sync` may arrive before or after the `round_result` for the same
  round, and either may be re-sent).
- **`sequence` and `matchInstanceId` protections still apply** to both messages
  (drop stale/duplicate/foreign-instance messages).
- **React must never infer a score increase for Unity** — a score only ever
  reaches Unity by copying an authoritative server snapshot into
  `match_state_sync`; it is never computed from `result`/lane data.
- **The exact correlation rule** (when a `round_result` may be accompanied by, or
  must wait for, a `match_state_sync`; how Unity reconciles a result animation
  with a not-yet-updated scoreboard) is a **B6D1 deliverable** (see §7).

**Why match-instance + sequence protection is required [Proposed rationale]:**
Because the same iframe/tab survives across rounds, rematches, reconnects, and
reloads, a presentation layer with no instance/sequence guard can render the
wrong thing. Specifically it prevents:

- **stale events** — a delayed message applied after newer state (guard:
  `sequence`);
- **duplicate events** — the same round animated twice (guard: `sequence`
  dedupe; already partially done via `messageId` dedupe at
  `MatchRenderer3D.tsx:271-287`);
- **prior-match messages** — a message from a finished match applied to a new one
  (guard: `matchInstanceId`);
- **rematch contamination** — after `resetRoomForRematch` bumps the instance, old
  in-flight messages must be dropped (guard: `matchInstanceId` change);
- **reconnect replay errors** — resync/replay after `match:rejoinState` must not
  double-apply (guard: `sequence` + full-state resync);
- **iframe reload confusion** — a reloaded Unity build must re-request/receive a
  clean current-state snapshot rather than replaying history (guard:
  `matchInstanceId` + `sequence` reset on `ready`).

> **This contract is a PROPOSAL and requires code review before any
> implementation.** It is not yet built; no field here exists on a live event
> except where §5 cites an existing payload.

---

## 7. B6D DELIVERY SUBPHASES

**[Proposed B6D design.]** B6D is broken into small, individually-gated
subphases. **No subphase is authorized by this brief; each requires its own
review/gate.**

### B6D1 — Contract and adapter tests
- Define the **TypeScript event contract** (§6, incl. the §6.1 split
  `round_result` / `match_state_sync`) as a shared, typed module (today none
  exists — see §5 *Not yet defined*).
- Create a **sanitizing adapter** that maps real events → the Unity envelope,
  stripping any non-presentation field: `match:result` → `round_result` (no
  scores); an authoritative `match:update` / `match:rejoinState` / `match:end`
  snapshot → `match_state_sync`.
- **Unit-test** the mapping and **prohibited-field** rejection. Required test
  cases (at minimum):
  - `match:result` with **no** following state update (result animation only; no
    score change presented);
  - a state update arriving **after** `round_result` (score applied only then);
  - **duplicate result** (`round_result` not animated twice);
  - **duplicate state snapshot** (`match_state_sync` idempotent);
  - a **stale pre-result score snapshot** (older `sequence`/pre-increment scores
    must not be presented as the post-result score);
  - a **reconnect full-state snapshot** (`match:rejoinState`) resyncs cleanly;
  - **terminal `match:end` scores** applied as final;
  - **no local score computation** (adapter never derives a score from
    result/lane data);
  - **no Unity-supplied score accepted** (inbound stays `ready`/`animation_complete`/`error` only);
  - **no wallet / auth / socket fields** ever appear in any payload.
- **B6D1 must resolve the exact score-correlation rule** (§5 score-atomicity,
  §6.1) **before B6D2 is authorized.**
- **No Unity activation** — pure TypeScript + tests. **No server change in this
  planning PR or in B6D1's scope beyond the client-side adapter/contract.**

### B6D2 — Preview shadow mode
- The live match **continues using the React renderer**.
- Real authoritative events are **also** sent to a hidden / non-authoritative
  Unity preview (an extension of the existing default-off shadow feed).
- **Compare** event order and presentation state (React vs Unity) for
  correctness.
- **No player-facing Unity replacement.**

### B6D3 — Internal preview renderer
- Feature-flagged Unity renderer for **internal / test accounts** or a dedicated
  preview surface.
- **React remains the immediate fallback.**
- **Free-play only.**
- Validate normal rounds, sudden death, timeout, disconnect, and rematch.

### B6D4 — Failure and recovery validation
- missing build; Unity ready timeout; iframe error; iframe reload; duplicate
  event; out-of-order event; stale match instance; disconnect/reconnect; React
  fallback; **no gameplay interruption** in any case.

### B6D5 — B6D closeout
- documentation; preview runtime evidence; **no production activation**;
  recommendation for a *later* production-hardening phase.

> Do not authorize all subphases automatically. **Each subphase must require its
> own review/gate.**

---

## 8. RISK REGISTER

**[Proposed B6D design — planning table.]** Probability/impact are planning
estimates.

| # | Risk | Prob. | Impact | Detection | Mitigation | Rollback | Gate owner |
|---|---|---|---|---|---|---|---|
| 1 | Unity shows a **different result** than the server | Low | Critical | B6D2 side-by-side compare; per-round assertion vs `match:result` | Server is sole source; adapter derives result only from `match:result`+`match:update`; Unity never computes | Flag off → React only | B6D2 gate |
| 2 | **Duplicate round animations** | Med | Med | Compare render count vs round count | `sequence` dedupe + existing `messageId` dedupe (`MatchRenderer3D.tsx:271-287`) | Flag off | B6D1/B6D2 |
| 3 | **Out-of-order messages** | Med | High | Sequence monotonicity check | Reject `sequence ≤ last` per `matchInstanceId` | Flag off | B6D1 |
| 4 | **Stale messages after rematch** | Med | High | `matchInstanceId` mismatch counter | Drop messages whose `matchInstanceId` ≠ current | Flag off | B6D1 |
| 5 | **Reconnect replay mismatch** | Med | High | Post-`match:rejoinState` state diff | Full-state resync on resume; no history replay | Flag off | B6D3/B6D4 |
| 6 | **iframe not ready** when events arrive | High | Low | `ready` not received; 15s timeout | Queue-until-ready then flush (exists, `:271-287`); `UNITY_READY_TIMEOUT_MS` fail-open | React fallback | B6D4 |
| 7 | **Unity crash / memory failure** | Med | Med | `error` event; load failure | `markUnavailable` unmounts iframe (`:241`) | React fallback | B6D4 |
| 8 | **Mobile performance** (jank/heat) | High | Med | Device test matrix (§10) | Perf budget; gate B6D3 on threshold; keep React default | Flag off | B6D3 |
| 9 | **Large WebGL loading time** | High | Med | Load-time measurement | gzip build (B6B), immutable cache (B6C); lazy mount | React fallback | B6D3 |
| 10 | **Browser cache serving wrong version** | Med | High | `protocolVersion`/build-hash mismatch | Immutable versioned URLs (B6C); version check in envelope | Flag off; new version | B6D1/B6D3 |
| 11 | **Strict-origin regression** | Low | Critical | Automated origin/source test | Keep `event.origin`+`event.source` checks (`:296-297`); never `"*"` | Revert | B6D1 |
| 12 | **Accidental direct Socket.IO/Supabase access from Unity** | Low | Critical | Network inspection (0/34 baseline); code review | Unity is passive iframe; no socket/supabase in Unity build | Revert build | Every gate |
| 13 | **Unity accidentally becoming authoritative** | Low | Critical | Inbound allowlist audit | `validateUnityMessage` accepts only ready/animation_complete/error (`:118-150`) | Revert | B6D1 |
| 14 | **React state-machine regression** in `MatchRoomPanel` | Med | Critical | Full match test matrix; CI | Narrow, reviewed diffs only (§9); no timer/reveal logic change | Revert | Every gate |
| 15 | **Timer / reveal timing drift** | Med | High | Compare reveal timing vs React | React remains the sole sequencing source; Unity gets timing hints only | Flag off | B6D2 |
| 16 | **Production feature flag accidentally enabled** | Low | Critical | Env audit; prod defaults off | Server-gated flags default off; CI/env review | Flag off | Every gate |
| 17 | **Inability to rollback** | Low | Critical | Rollback rehearsal (B6D5) | Single-flag disable → React; documented steps | N/A (this is the rollback) | B6D5 |
| 18 | **Build non-determinism** | Known | Med | B6B two-build compare | Documented as BLOCKED; immutable versioned artifacts | Redeploy known-good version | B6D5 |
| 19 | **Local-only generated files committed** | Low | Med | `git ls-files` of ignored trees | `.gitignore` for WebGL + audit-artifacts; path-limited staging | Revert commit | Every gate |
| 20 | **Wallet/economy info leaking into Unity payloads** | Low | Critical | Adapter unit tests; payload schema | Envelope forbids economy fields; sanitizer strips them | Revert | B6D1 |
| 21 | **Unity displays a stale pre-result score** (scores not atomic with `match:result`; §5 score-atomicity) | Med | High | Compare Unity score with the authoritative `match:update` / `match:end` snapshot | Split `round_result` (no scores) from `match_state_sync` (authoritative snapshot only); React never infers a score increase | Unity flag off / React renderer only | B6D1 and B6D2 |

---

## 9. FILES THAT MUST NOT BE DISTURBED CASUALLY

**[Current verified behavior — sensitivity notes.]**

- **`apps/web/src/components/match/MatchRoomPanel.tsx`** — **owns timers,
  reveals, scores, reconnect, and the whole match lifecycle** (`socket.on` set at
  `:2113-2130`; reveal/score refs; `disconnectCountdown`; rematch state). **Any
  change here must be narrowly scoped and specifically reviewed** — a regression
  here breaks real matches for all players, Unity or not.
- **`apps/web/src/components/match/MatchRenderer3D.tsx`** — the Unity bridge and
  origin/source/allowlist/fallback logic. Changes risk the security boundary.
- **`apps/web/src/lib/socket/client.ts`** — the single Socket.IO singleton
  (`getSocket()`), lazy, auth-bound. Must remain the *only* socket owner; Unity
  must never import it.
- **realtime server match authority code** (`apps/realtime-server/src/gameplay/`,
  `room/`, `index.ts`, `state/`) — decides every outcome. B6D changes none of it.
- **Supabase schema / auth code** — untouched by B6D.
- **Unity generated release folders** (`apps/web/public/unity/penalty444/**`) —
  git-ignored build output; never commit.
- **`audit-artifacts/**`** — local deployment workspaces; never commit.
- **production Vercel variables** — B6D configures none; production stays Unity-off.

---

## 10. TEST MATRIX

**[Proposed B6D design.]** For each row, B6D must record: expected authoritative
match behavior · expected Unity presentation · expected fallback behavior ·
evidence required (screenshot / network capture / log). "Authoritative behavior"
is always **decided by the server and unchanged by Unity**.

| Scenario | Authoritative match behavior | Unity presentation (expected) | Fallback behavior | Evidence required |
|---|---|---|---|---|
| Desktop Chrome | Match plays normally | Renders round_result/end | React on flag off | Screen + network |
| Desktop Edge | Normal | Renders | React fallback | Screen + network |
| Android Chrome | Normal | Renders within perf budget | React fallback | Device capture + FPS |
| iPhone Safari | Normal | Renders within perf budget | React fallback | Device capture + FPS |
| Slow network | Normal (server-timed) | Delayed load; queue-until-ready | React if timeout | Throttled capture |
| iframe delayed ready | Normal | Flush queued on `ready` | React continues meanwhile | Log of queue flush |
| iframe never ready | Normal | none | `markUnavailable` → React (15s) | Timeout log |
| Unity error after ready | Normal | stops | `markUnavailable` → React | `error` capture |
| Normal GOAL | `match:result result=GOAL` | GOAL animation; score updates only from `match_state_sync` | React overlay | Round capture |
| **`match:result` arrives BEFORE the authoritative post-result state snapshot** | Server has incremented `room.scores` (`index.ts:1598`) but the post-result `match:update` has not yet reached the client | result animation **may run**; Unity scoreboard **does not invent or prematurely change** the score; a later `match_state_sync` applies the authoritative score | React unaffected (React uses its own state) | Ordered capture of `round_result` then `match_state_sync`; scoreboard value before/after |
| Normal SAVE | `result=SAVE` | SAVE animation | React overlay | Round capture |
| DRAW / both timeout | `result=DRAW` | DRAW animation | React overlay | Round capture |
| Kicker timeout | Server resolves round (PICK_TIMEOUT) | result animation | React | Timeout log |
| Keeper timeout | Server resolves round | result animation | React | Timeout log |
| Sudden death | `phase=SUDDEN_DEATH`, `suddenDeathRound++` | phase change shown | React sudden-death UI | Phase capture |
| Forfeit | `match:forfeit`→`endMatch` opp `maxScore+1` | `match_end` winner | React end overlay | End capture |
| Cancellation | `match:aborted reason=early_cancel` | `match_aborted`/reset | React abort UI | Abort capture |
| Disconnect < 39 s | grace armed (`DISCONNECT_FORFEIT_MS=39000`), reconnect | countdown hint, then resume | React countdown | Grace capture |
| Disconnect expiry | forfeit at 39 s | `match_end` | React end | Expiry log |
| Resume | `match:rejoinState`/`isResume:true` | full-state resync | React resumes | Resync capture |
| Match end | `match:end {scores}` | `match_end {winnerId,isDraw}` | React end overlay | End capture |
| Rematch | `match:rematch:accepted` | `reset`+`staging_begin` | React fresh match | Rematch capture |
| Repeated rematch | new `matchInstanceId` each time | old messages dropped | React fresh | Instance-id capture |
| Stale event rejection | n/a | message with old sequence dropped | React unaffected | Sequence log |
| Duplicate event rejection | n/a | duplicate not animated | React unaffected | Dedupe log |
| Fallback React renderer | Normal | none | React fully drives match | Flag-off capture |

---

## 11. B6D ENTRY CRITERIA

**[Proposed gate.]** Before **B6D1 coding** may begin:

- B6C remains **merged and stable** on master.
- master **CI green** (Web + Realtime typecheck/build).
- **Production Unity off** (flags default off; no prod env set).
- **Free-play-only policy unchanged** (no economy/real money).
- The **proposed contract (§6) reviewed** and accepted.
- **Exact B6D1 file scope approved** in advance.
- **Rollback strategy documented** (single-flag disable → React).
- **No unresolved critical realtime gameplay defect.**
- **No local generated-artifact contamination**
  (`git ls-files "apps/web/public/unity/penalty444/**"` and
  `git ls-files "audit-artifacts/**"` empty).

---

## 12. B6D EXIT CRITERIA

**[Proposed gate.]** B6D can only close when **all** hold:

- Real authoritative events are **mapped correctly** (verified vs server).
- **Unity never controls gameplay** (inbound allowlist audited).
- **Duplicate / stale / out-of-order protections pass** (§8 #2–#4).
- **Reconnect / rematch flows pass** (§10).
- **React fallback works** in every failure mode (§10).
- The **live match completes when Unity fails** (no interruption).
- **Mobile / browser testing meets the agreed threshold** (§10).
- **No Socket.IO / Supabase connection originates from Unity** (network verified).
- **Production remains off.**
- **Runtime evidence and rollback instructions are documented.**

---

## 13. OUT OF SCOPE

**[Explicitly excluded from B6D.]**

- final stadium / art polish; final player models; complete animation polish;
- production rollout;
- real money; wallet changes; paid stakes; deposits / withdrawals; KYC;
- new games; tournament redesign; changing Penalty444 rules;
- replacing Node.js authority;
- removing the React renderer.

---

## 14. DECISION REQUIRED

| Item | Status |
|---|---|
| B6D planning brief | **Proposed** |
| B6D1 contract/adapter work | **Not yet authorized** |
| B6D2 shadow mode | **Not authorized** |
| B6D3 internal Unity renderer | **Not authorized** |
| B6D production activation | **Prohibited** |
| Economy | **Not authorized** |
| Real money | **Not authorized** |

**The next approval, if granted, should authorize B6D1 only** (contract +
sanitizing adapter + unit tests; no Unity activation). Every later subphase
requires its own separate review and gate. This brief changes no code, activates
nothing, and leaves the production decision **NO-GO**.
