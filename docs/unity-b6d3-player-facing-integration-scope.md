# B6D3 — CONTROLLED PLAYER-FACING UNITY INTEGRATION: SCOPE AND RISK REVIEW

> **Status: PLANNING / DOCUMENTATION ONLY.** This document authorizes no code,
> no test, no CI, no configuration, no environment variable, and no deployment.
> It does not run Unity, does not enable any flag, and does not activate any
> preview. It defines the scope, invariants, mapping, gates, and risks for a
> *possible, tightly-controlled* first player-facing Unity step (B6D3) and asks
> for a single GO/HOLD decision in §18.
>
> Every statement is labelled as one of: **[Verified]** (exists in the repo today
> at the baseline commit, cited), **[Runtime-verified]** (confirmed by the
> authenticated post-merge runtime proof recorded in §2), **[Proposed B6D3]**
> (design not built), or **[Recommendation]**. Event, state, field, and flag names
> are quoted verbatim from the repository as of master
> `be2baeb6d8bae90f1229bf41fda0b5c4897967cc` (B6D2B merged). No payload field is
> invented; where a field does not exist it is marked *Not present*.

---

## 1. EXECUTIVE SUMMARY

- **What exists today [Verified].** The Unity presentation prototype is wired
  into the live match room as a **default-off, non-authoritative shadow**. Three
  build-time public flags must *all* equal `"true"` before any Unity message is
  produced: `NEXT_PUBLIC_UNITY_MATCH_ENABLED`,
  `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED`, and
  `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED`
  (`MatchRoomPanel.tsx:860-862`, `:889-891`). None is configured in production.
  Unity is never player-facing today; React is the sole player-facing renderer.
- **What B6D1/B6D2A/B6D2B already proved [Verified + Runtime-verified].** A
  versioned, presentation-only Protocol v1 (`round_result` + `match_state_sync`),
  an exception-safe sanitizing adapter, a sequence/instance gate, a pure
  React→Unity shadow coordinator, and a Unity-side parser/gate that consumes the
  envelopes as **identity-neutral** presentation (numeric score values only,
  player-id keys discarded). 119 web unit tests + 149 with the staging harness
  suite; Unity editor validation 57/57. **The authenticated same-origin
  `/dev/unity-staging` harness route was subsequently driven end-to-end and passed
  11/11** (see §2) — the compiled WebGL artifact consumes Protocol v1 correctly in
  the sanctioned harness.
- **What B6D3 would add [Proposed B6D3].** A **controlled, opt-in, free-play-only**
  step in which the Unity presentation is shown *to a restricted set of consenting
  internal/test sessions* as a **view of an already-decided real match**, with the
  React renderer remaining the immediate, always-available fallback. Node/Socket.IO
  stays the sole gameplay authority; Unity stays presentation-only and never
  authoritative.
- **What still gates B6D3 [Verified].** The principal *design* problem is that a
  **player-facing identity / visual-side model does not yet exist** — the Unity
  scoreboard is identity-neutral only (§7). A **separate player-facing flag +
  server-side cohort gate** must be designed before any lifecycle host work (§9),
  and **controlled real-match evidence** is required before real-match runtime
  testing (§13). None of these blocks the pure, test-only first subphase.
- **Recommendation [Recommendation].** **GO for B6D3A only** — a pure
  TypeScript + unit-test identity/visual-side and correlation contract, with **no
  Unity activation, no real match, no `MatchRoomPanel`/`MatchRenderer3D`/server/
  Unity-C# change, no environment change, and no deployment**. **HOLD** on B6D3B
  and every later player-facing or real-match subphase. This document still
  authorizes no implementation; B6D3A is *proposed for separate implementation
  authorization*. See §18.

---

## 2. VERIFIED BASELINE

**[Verified]** The locked baseline this review builds on:

- **master base commit:** `be2baeb6d8bae90f1229bf41fda0b5c4897967cc` (B6D2B merged).
- **Unity editor:** `6000.4.2f1`; WebGL build target; IL2CPP.
- **B6D1 contract (presentation-only), STANDALONE:**
  `apps/web/src/components/match/unityPresentationProtocol.ts` — envelope
  constants `PRESENTATION_TYPE = "PENALTY444_MATCH_EVENT"`,
  `PRESENTATION_PROTOCOL_VERSION = 1`, event names
  `"round_result" | "match_state_sync"` (`:23-26`); exception-safe validators
  (`validateEnvelope`, `sanitizeScores`, `isPlainRecord`), `deriveMatchInstanceId`
  (`:305-317`, format `<UPPERCASE_ALNUM_ROOMCODE>:<POSITIVE_MATCH_INSTANCE>`),
  `PresentationSequenceEmitter` / `PresentationSequenceGate`.
- **B6D1 adapter, STANDALONE:**
  `apps/web/src/components/match/unityPresentationAdapter.ts` — `match:result` →
  `round_result` (maps `kickerPick → kickerLane`, `keeperPick → keeperLane`,
  never carries scores, `:62-97`); a **complete** authoritative snapshot →
  `match_state_sync` (`:109-138`); terminal combiner `buildTerminalStateSyncEnvelope`
  (`:152-190`). Every function returns a controlled `null` on malformed input and
  never throws.
- **B6D2A pure shadow coordinator:**
  `apps/web/src/components/match/unityPresentationShadow.ts` —
  `UnityPresentationShadowCoordinator`, `ShadowDispatchQueue`, `makeShadowMessageId`,
  `buildAuditSummary` (sorted numeric `scoreValues` only, never keyed by player id,
  `:42-55`, `:64-80`), `compareEnvelopeToSource`. Pure TypeScript: no React, no
  Socket.IO, no Supabase, no browser APIs.
- **B6D2A live-shadow wiring in the match room:** `MatchRoomPanel.tsx` gates the
  versioned path behind the three-flag `unityB6D2ShadowEnabled` (`:889-891`);
  `publishB6D2Shadow` builds envelopes and maintains a **pending-UNSENT** buffer
  (`:929-962`); `handleB6D2Ready` discards pre-ready history and resyncs from
  current authoritative state (`:964-972`); `MatchRenderer3D` is mounted with
  `deliveryMode="fifo"` (`:4045`).
- **Unity-side consumption (B6D2B) [Verified from docs/unity-b6d2b-unity-consumption-runtime.md]:**
  `UnityPresentationProtocolV1.cs` (bounded, exception-safe parser: 16 KiB max,
  depth 8, ≤16 score entries, rejects dangerous keys / duplicate keys /
  fractional-negative-non-finite scores), `UnityBridgeReceiver.cs`
  (`PresentationInstanceGate`, atomic commit only after successful apply, legacy
  path preserved), `PenaltySceneController.cs`
  (`ShowRoundResultVersioned`, `ApplyMatchStateSyncVersioned` — displays supplied
  result, never derives result/score/winner). Ack schema `presentation_applied` /
  `presentation_rejected` carries **numeric score VALUES only, never player-id
  keys** (B6D2B §8, §8.1); outbound `postMessage` targets `window.location.origin`,
  never `"*"`.
- **Strict same-origin iframe bridge [Verified]:** inbound handler requires
  `event.origin === window.location.origin` **and**
  `event.source === iframeRef.current?.contentWindow`; outbound `postMessage`
  always targets `window.location.origin`, never `"*"`; inbound allowlist accepts
  only `PENALTY444_UNITY_EVENT` with `ready` / `animation_complete` / `error`
  (`MatchRenderer3D.tsx`, cited in `docs/unity-b6d-real-match-integration-scope.md`
  §2). `UNITY_READY_TIMEOUT_MS = 15_000`; `markUnavailable` fails open to React.
- **Staging route isolation [Verified]:** `/dev/unity-staging`
  (`apps/web/src/app/dev/unity-staging/page.tsx`) is server-gated by
  `UNITY_STAGING_ROUTE_ENABLED === "true"` **and** a configured
  `UNITY_STAGING_ARTIFACT_ORIGIN`, and returns `notFound()` when
  `VERCEL_ENV === "production"` (`:39-49`). It is **never** a `NEXT_PUBLIC_*`
  gate and never loads live match state.

### 2.1 Authenticated harness-route runtime proof [Runtime-verified]

The following is **later authenticated runtime evidence, verified after the
B6D2B document was merged**. It supersedes, for the purposes of this B6D3 review,
the historical SSO-blocked wording in `docs/unity-b6d2b-unity-consumption-runtime.md`
(that document was written when the sanctioned route could not be driven
non-interactively because Vercel SSO returned HTTP 302; that wording is now
**historical and superseded** — this review does **not** rely on the old B6D2B
document containing the 11/11 result).

- **Deployment:** `dpl_CJkFCw9HLrFB7FctuGHeEcetiAu9`
- **Release:** `b6d2b-5226d3c1-a`
- **Source commit:** `5226d3c125f3a274fc7d8589f3aa77642a3c5991`
- **Unity:** `6000.4.2f1`
- **Authenticated same-origin `/dev/unity-staging` route proof: 11/11 PASSED.**

The 11/11 authenticated run confirmed, through the actual harness UI on the
protected same-origin route:

1. Unity **ready** lifecycle received.
2. Authoritative **state bootstrap** (initial `match_state_sync`) applied to the
   scoreboard/round/phase.
3. `round_result` **does not increment the score locally** (result animation only).
4. Authoritative **score sync** — the scoreboard changes only on `match_state_sync`.
5. **Duplicate sequence** rejected (`stale_or_duplicate`).
6. **Stale/lower sequence** rejected (`stale_or_duplicate`).
7. **Match-instance protection** — a foreign/old-instance message rejected
   (`foreign_instance`); a valid higher instance resets and applies.
8. **Sudden-death** state (`phase = SUDDEN_DEATH`, `suddenDeathRound`) presented
   exactly as supplied; no local progression computed.
9. **iframe reload** produces a fresh `ready` lifecycle.
10. **Post-reload bootstrap** with a `sequence` **greater than 1** accepted as a
    complete snapshot; no historical `round_result` replayed.
11. **Sanitized evidence only** — no player IDs and no raw JSON in the harness
    evidence table or acknowledgements (numeric `scoreValues` + `playerCount` only).

**Distinction of evidence classes.** Items in §2 (bullets) are
**repository-verified facts** read from source at the baseline commit. Items in
§2.1 are **later authenticated runtime evidence** from the deployment above. The
sanctioned harness-route run is therefore **complete and PASSED**, not blocked,
deferred, or an open blocker.

- **Production posture [Verified]:** production homepage HTTP 200;
  production `/dev/unity-staging` HTTP 404; no production Unity iframe;
  `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` unconfigured. **Production is NO-GO.**
- **Artifact reproducibility [Verified — BLOCKED]:** deterministic two-build
  reproducibility remains **BLOCKED**; mitigated by immutable versioned artifacts
  and redeploy-known-good (see §16).

---

## 3. PROPOSED OBJECTIVE

**[Proposed B6D3]** Safely prove that the Unity presentation can be shown *as a
player-facing view* of a **real, already-decided** Penalty444 match to a **small,
explicitly-controlled, opt-in, free-play-only** audience (internal / test
sessions on a dedicated non-production surface), while:

- the realtime server remains the **sole** authority for every outcome, score,
  timer, phase, winner, timeout, forfeit, and sudden-death decision;
- React / `MatchRoomPanel` remains the **authoritative client renderer and the
  immediate, always-available fallback**;
- Unity remains **presentation-only** and never computes, reports, or influences
  a result or score;
- activation stays **flag-gated and default-off**, with a **single-flag disable
  → React** rollback.

B6D3 turns Unity into an optional *view* of an already-decided match for a
controlled cohort. It never makes Unity part of deciding the match, and it never
touches production, economy, or real money.

> This objective is a **proposal**. Nothing in it is authorized here.

---

## 4. EXPLICIT NON-GOALS

**[Proposed B6D3 — explicitly excluded.]**

- **No production activation** of any Unity flag or surface. Production stays
  Unity-off, NO-GO.
- **No change to the realtime server** — no gameplay, scoring, timer, phase,
  reconnect, forfeit, sudden-death, or event-emission change.
- **No change to Supabase schema, auth, or data access.**
- **No economy / wallet / real-money / stakes / deposits / withdrawals / KYC.**
- **No new authoritative path for Unity** — the inbound allowlist stays
  `ready` / `animation_complete` / `error`; Unity never writes match state.
- **No removal of the React renderer** and no change that makes Unity a hard
  dependency of a live match.
- **No new game, no rule change, no tournament redesign.**
- **No raw internal player IDs / user UUIDs / emails / tokens / socket data /
  wallet data in any Unity-bound payload** (see §7, §11).
- **No enabling of `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` in production**, and no
  configuration of any production Vercel variable.
- **No art / model / animation final polish** (out of scope for a controlled
  integration step).
- **No B6D3 implementation, no real-match Unity testing, and no runtime
  activation performed by this document.**

---

## 5. ARCHITECTURE INVARIANTS

**[Verified today + B6D3 constraint]** These are true at the baseline commit and
must remain true in every B6D3 subphase.

- The **realtime server decides all gameplay outcomes** (`apps/realtime-server/`).
- **Unity never decides** GOAL / SAVE / DRAW, scores, winner, timeout, forfeit,
  or sudden death (enforced Unity-side in `PenaltySceneController.cs`; B6D2B §4-5).
- **React / Next.js owns the Socket.IO connection** and the match state machine
  (`MatchRoomPanel.tsx`); Unity must never import the socket singleton or connect
  to Socket.IO / Supabase.
- **Unity receives sanitized presentation messages only** via same-origin
  `postMessage`, built field-by-field by the adapter (never spreading raw
  payloads).
- **Unity cannot write to match state** — inbound allowlist is
  `ready` / `animation_complete` / `error` only.
- **React renderer remains the fallback** and stays fully authoritative for
  display; the live match completes if Unity is missing, slow, or errors.
- **All activation stays flag-gated and default-off**; production defaults Unity
  off.
- **Failure fails open to React** (`markUnavailable`, 15 s ready-timeout).

### 5.1 Responsibility matrix

| Concern | Node.js realtime server | React (`MatchRoomPanel`) | Unity (WebGL iframe) |
|---|---|---|---|
| Decide GOAL/SAVE/DRAW | **OWNS** (authority) | Consumes `match:result` | **Never** — displays supplied result |
| Scores / increments | **OWNS** (`room.scores`) | Consumes authoritative snapshot | **Never** — displays supplied numeric values |
| Round / phase / sudden death | **OWNS** | Consumes; drives reveal timing | **Never** — displays supplied round/phase |
| Winner / match end | **OWNS** (`match:end`) | Classifies for presentation only | **Never** — displays supplied end state |
| Timers / timeouts / grace | **OWNS** | Owns client reveal/countdown timing | **Never** |
| Socket.IO connection | Server endpoint | **OWNS** the single client socket | **Never connects** |
| Supabase / auth | **OWNS** | Reads via app auth | **Never connects** |
| Presentation envelope build | — | **OWNS** (adapter, sanitized) | Consumes + validates + gates |
| Sequence / instance protection | — | Emits (`sequence`, `matchInstanceId`) | Enforces (parser + gate) |
| Player identity / order | (internal IDs only) | **Must map to non-identifying labels** (§7) | Identity-neutral only today |
| Fallback rendering | — | **OWNS** (always available) | Optional; unmount → React |

---

## 6. CURRENT LIVE EVENT MAPPING

**[Verified — no payload field is invented.]** Field names are quoted from the
repo; where a field is absent it is marked *Not present*. Line references follow
`docs/unity-b6d-real-match-integration-scope.md` §5 (cited against the same
codebase) and the adapter's own repo-fact comments
(`unityPresentationAdapter.ts:99-108`, `:140-151`).

**Key facts that shape the mapping [Verified]:**

- **There is no single shared typed server→client event contract.** Events are
  string literals emitted at each call site. `packages/shared/src/types.ts`
  contains an **older** `RoundResult`/`MatchResult` whose `result` is
  `"GOAL" | "SAVE"` with **no `DRAW`** — it does **not** match the live events and
  must not be used as the contract.
- **Scores are NOT atomic with `match:result`.** The server increments
  `room.scores[pointWinnerId]` (`index.ts:1598`) **before** it emits
  `match:result` (`index.ts:1624`), and **`match:result` carries no scores / no
  phase / no maxRounds** (`index.ts:1614-1623`). Authoritative post-result scores
  arrive **separately** on a later `match:update` (`index.ts:720-739`).
- **Field-name mismatch is handled by the adapter:** server sends `kickerPick` /
  `keeperPick`; the Unity `RoundResultPayload` uses `kickerLane` / `keeperLane`
  (mapped in `unityPresentationAdapter.ts:70-71`).
- **The authoritative payloads carry raw player IDs that the adapter drops.**
  `match:result` also carries `roomCode`, `kickerPlayerId`, `keeperPlayerId`
  (`index.ts:1614-1623`); `match:update` also carries `matchInstance`, `matchType`,
  `picksLocked`, `isResolving`, etc. (`index.ts:720-740`). The adapter extracts
  **only** the presentation fields in the table below and never spreads these raw
  ID fields into a Unity payload.
- **`match:rejoinState` (`rooms.ts:358-370`, `:474-485`) does NOT carry `scores`
  or `maxRounds`** — the adapter therefore rejects a raw `rejoinState` as a state
  snapshot (`unityPresentationAdapter.ts:99-108`); the complete reconnect snapshot
  must come from the `match:update` the server also emits.

| Authoritative source (event → fields) [Verified] | React source location | Unity message [Verified B6D1] | Required fields | Score included? |
|---|---|---|---|---|
| `match:result` `{ round, kickerPick, keeperPick, result, statusMessage }` (`index.ts:1614-1623`) | built in `MatchRoomPanel.tsx` shadow path | `round_result` `{ round, kickerLane, keeperLane, result, statusMessage? }` | round, lanes, result | **No** — drives shot animation only |
| `match:update` `{ scores, round, maxRounds, phase, suddenDeathRound?, matchInstance }` (`index.ts:720-740`) — a **complete** snapshot | `scores`, `maxRounds`, `phase`, `matchInstance` state | `match_state_sync` `{ scores, round, maxRounds, phase, suddenDeathRound? }` | scores, round, maxRounds, phase | **Yes** — authoritative snapshot only |
| `match:end` `{ scores, tournamentId? }` (`index.ts:1347`), then a full `match:update` (`:1355`) | `getUnityMatchEndPresentation(scores)` (`MatchRoomPanel.tsx:278-301`) | terminal `match_state_sync` (via `buildTerminalStateSyncEnvelope`) or the authoritative post-end `match:update` | scores (final) | **Yes** — final authoritative |
| `match:rejoinState` (active) (`rooms.ts:474-485`) — **no `scores`, no `maxRounds`** | rejoin handler | *rejected as a raw state snapshot*; resync comes from the following `match:update` | n/a | *Not present in rejoinState* |
| `matchInstance: number` (on `match:update`, `match:aborted`, `match:rejoinState`) | `matchInstance` state (`MatchRoomPanel.tsx:853`, `:1265-1266`) | `matchInstanceId = deriveMatchInstanceId(roomCode, matchInstance)` | `<ROOMCODE>:<matchInstance>` | n/a |

**Not-yet-mapped events [Verified as unmapped].** `staging_begin`, reveal-stage
timing, `pick_locked`, `opponent_status`/disconnect countdown, `match:aborted`,
`match:cancelled`, rematch lifecycle (`match:rematch:accepted/declined`), and
`match:opponentReady` (handled outside `MatchRoomPanel`) have **no versioned
Protocol v1 mapping** — the protocol supports only `round_result` and
`match_state_sync`. Any B6D3 need for these is a **B6D3 design decision**, not an
existing field, and must not be invented into a payload.

> The versioned protocol carries **only** `round_result` and `match_state_sync`.
> Legacy `staging_begin` / `match_end` / `reset` exist only on the legacy Unity
> path and are rejected if sent with `protocolVersion` (B6D2B §7).

---

## 7. PLAYER IDENTITY & SCOREBOARD MAPPING

**[Verified today]** The Unity scoreboard is **identity-neutral**. Score keys are
used only to compute a deterministic order (sorted by sanitized key, ordinal
comparison), then **discarded**; only numeric values are displayed, e.g.
`Scores: 0 / 1` (B6D2B §5.1). The applied ack carries `scoreValues` (numeric,
ordered) and `playerCount` and **no player-id keys, usernames, email, auth, or
wallet fields** (B6D2B §8.1;
`app/dev/unity-staging/unityStagingProtocol.ts:132-144`, `:251-308`). The 11/11
authenticated harness proof (§2.1, item 11) confirmed no player IDs and no raw
JSON in the runtime evidence.

**[Verified — the principal B6D3A design problem]** `match_state_sync.scores` is a
`Record<string, number>` keyed by the server's **internal auth `playerId`** (the
same keys `room.scores` uses — `types/room.ts:41`; `scores` keys on
`match:update` `index.ts:726` and `match:end` `index.ts:1347-1348`). Raw
`playerId` is pervasive across the live wire contract
(`scores`/`roles` map keys, `kickerPlayerId`/`keeperPlayerId`,
`room:update.players`). Today Unity discards those keys, so no identity leaks.
**But a player-facing scoreboard needs to know which visual side is which
player** — and that identity/visual-side mapping does **not** exist yet (B6D2B
§5.1). Note also that the legacy shadow `getUnityMatchEndPresentation` returns a
`winnerId` that **is** a raw score-map key (`MatchRoomPanel.tsx:278-301`); that
value is legacy-shadow-only and must **never** be forwarded on the versioned
player-facing path. Resolving this mapping (privacy-safe, deterministic) is the
central deliverable of the recommended first subphase, **B6D3A**.

**[Proposed B6D3 — requires review before implementation]** A player-facing
identity model that introduces **no raw internal player ID / user UUID** into any
Unity-bound payload:

- React (which already knows the local player and the opponent for display) maps
  the two authoritative score keys to **non-identifying, per-match presentation
  labels** — e.g. a stable **seat/side** token (`SELF` / `OPPONENT`, or
  `SIDE_A` / `SIDE_B`) plus an already-displayed **display name** string — and
  builds the Unity payload **field-by-field** from those, never from the raw key.
- The mapping is **per-`matchInstanceId`** and rebuilt on instance change so no
  identity survives a rematch/reconnect boundary.
- Unity continues to receive **ordered numeric values** for scoring; any name it
  shows is a display string already visible in the React UI, never an internal
  identifier, and never a token/email/wallet field.
- The exact label scheme, whether names are sent at all, and the sanitizer rules
  that guarantee no raw ID/PII crosses the boundary are **B6D3A deliverables**
  requiring code review (see §13, §14).

> **Invariant [Proposed B6D3]:** no raw internal player ID, user UUID, email,
> auth/session/token, socket data, or wallet/economy field may ever appear in a
> Unity-bound payload. The scoreboard identity model must be verified by unit
> tests before any player-facing activation.

---

## 8. LIFECYCLE & STATE MACHINE

**[Verified today]** The relevant lifecycle guards already implemented:

- **Sender (React):** `PresentationSequenceEmitter` — `sequence` starts at 1 per
  `matchInstanceId`, increases monotonically in send order, resets to 1 on a new
  instance (`unityPresentationProtocol.ts:326-346`).
- **Coordinator (React):** `publishB6D2Shadow` maintains a **pending-UNSENT**
  buffer; an instance transition drops all old-instance pending messages and keeps
  only the new one; same-instance dispatches append (dedup + bounded, 33rd is an
  explicit overflow, renderer fails open) (`MatchRoomPanel.tsx:929-962`).
- **Ready / reload (React):** `handleB6D2Ready` discards pre-ready pending history
  and replaces the buffer with a single fresh `ready_resync` from current
  authoritative state — **never replays an earlier `round_result`**
  (`MatchRoomPanel.tsx:964-972`).
- **Receiver (Unity):** `PresentationInstanceGate.Evaluate` never mutates state;
  `Commit` runs only after a successful scene apply (atomic). Rules (B6D2B §6):
  fresh receiver bootstraps from a **complete** `match_state_sync` at any positive
  sequence; same instance requires `sequence > lastSequence`; `round_result`
  before an active state is rejected (`no_active_instance`); a new instance
  replaces the active one **only** when it is a complete `match_state_sync`, the
  room-code prefix matches, the numeric suffix is strictly greater, and
  `sequence == 1`. **All of these were exercised and PASSED in the 11/11
  authenticated harness proof (§2.1).**

**[Proposed B6D3 — player-facing state machine]** For a controlled player-facing
view, the following transitions must be specified and tested (all presentation-only):

1. **Enter match (opt-in cohort):** React mounts Unity as the *primary* visible
   renderer for the cohort **and** keeps React mounted/ready as fallback; Unity
   receives an initial `match_state_sync` bootstrap before any `round_result`.
2. **Round resolve:** `round_result` drives the shot animation; the scoreboard
   changes only on the correlated authoritative `match_state_sync`.
3. **Reveal timing** stays owned by React; Unity receives no authority over
   pacing.
4. **Sudden death:** `phase = "SUDDEN_DEATH"` with `suddenDeathRound` applied
   exactly; no local progression computed.
5. **Reconnect / resume:** full-state resync from the post-`rejoinState`
   `match:update`; no history replay.
6. **Rematch:** new `matchInstanceId` invalidates all prior in-flight messages;
   scene reset then fresh bootstrap.
7. **Any Unity failure at any transition:** immediate, seamless fallback to the
   already-mounted React renderer (see §10) with no gameplay interruption.

The **exact correlation rule** between `round_result` and the following
`match_state_sync` (when the scoreboard may change) is a **B6D3A deliverable**
building on the B6D1 split contract — it must not be inferred from `match:result`
alone.

---

## 9. FEATURE-FLAG & ROLLOUT DESIGN

**[Verified today]** Activation is governed by three build-time public flags, all
required, all default-off:

1. `NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true"` — mounts the optional Unity iframe.
2. `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true"` — feeds the live shadow
   (`unityShadowEnabled`, `MatchRoomPanel.tsx:860-862`).
3. `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED === "true"` — switches to the versioned
   B6D1 envelopes (`unityB6D2ShadowEnabled`, `MatchRoomPanel.tsx:889-891`).

All three are **UNCONFIGURED** in production. The versioned path runs **only**
when all three are exactly `"true"`.

**[Proposed B6D3 — rollout design, requires review]**

- **A new, separate gate for player-facing mode.** The three existing flags keep
  Unity as a *shadow* (non-visible). Making Unity *player-facing* must require a
  **distinct additional flag** (e.g. a proposed
  `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED`, **not created here**) so that turning
  on the shadow can never, by itself, promote Unity to the player-facing renderer.
  **This separate player-facing flag + cohort design must be accepted before
  B6D3B.**
- **Cohort restriction is server-side, not `NEXT_PUBLIC_*`.** Which sessions are
  in the controlled cohort must be decided by a **server-gated** condition
  (mirroring the `/dev/unity-staging` server-gate pattern), never by a
  client-only public flag, so the cohort cannot be self-selected in the browser.
- **Non-production surface only.** Like `/dev/unity-staging`, the player-facing
  view returns `notFound()` / is inert when `VERCEL_ENV === "production"`.
- **Default-off and single-flag disable.** Disabling the player-facing flag (or
  any of the three shadow flags) instantly reverts every session to React.
- **Staged progression:** mock/preview runtime proof → controlled two-user
  real-match staging proof (separate authorization) → (later, separate
  authorization) any wider cohort. Production remains NO-GO throughout B6D3.

> No flag is created, enabled, or configured by this document. All flags remain
> default-off; `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` stays **UNCONFIGURED**.

---

## 10. FAILURE & FALLBACK BEHAVIOUR

**[Verified today]**

- **Missing build / load failure / iframe error / throwing `postMessage`:**
  `markUnavailable` unmounts the iframe and React continues.
- **Unity never ready:** `UNITY_READY_TIMEOUT_MS = 15_000` → `markUnavailable`
  → React.
- **Malformed / stale / duplicate / foreign message:** dropped by the adapter
  (returns `null`), the React sequence/instance guards, and the Unity parser/gate
  — no sequence consumed, no instance change, no scene apply (B6D2B §6E;
  duplicate/stale/foreign rejection **PASSED** in the 11/11 proof, §2.1).
- **Overflow:** the pending-UNSENT buffer cap is an explicit overflow; the
  renderer fails open.

**[Proposed B6D3 — player-facing fallback must be seamless]**

- For the cohort, **React must remain mounted and ready underneath Unity** so that
  any Unity failure swaps to React **without a gameplay interruption and without
  re-fetching match state** — the match is already fully driven by React state.
- **Fallback must be observable** (a sanitized, identity-free audit/log line and a
  counter) so B6D3 evidence can show how often Unity fell back and that the match
  continued.
- **No failure mode may block, delay, or alter the authoritative match** — Unity
  is strictly additive to what React already renders.
- **A ready-timeout or error during a live cohort match** must fall back silently
  to React (no player-visible error surface that implies the match is broken).

---

## 11. SECURITY / PRIVACY / ISOLATION

**[Verified today]**

- **Same-origin only:** inbound requires `event.origin === window.location.origin`
  **and** `event.source === iframe.contentWindow`; outbound targets
  `window.location.origin`, never `"*"` (React side and Unity `.jslib` side,
  B6D2B §8).
- **Inbound allowlist:** only `PENALTY444_UNITY_EVENT` `ready` /
  `animation_complete` / `error`; Unity carries no authority.
- **Sanitizing adapter:** builds every field explicitly, never spreads a raw
  payload, strips prototype-pollution keys (`__proto__`, `prototype`,
  `constructor`), rejects non-plain-records / arrays / hostile & revoked Proxies,
  and enforces finite non-negative integer scores
  (`unityPresentationProtocol.ts:100-192`).
- **No identity in acks:** Unity → React acks carry numeric `scoreValues` +
  `playerCount` only — no player-id keys, usernames, email, auth/session/token,
  socket, or wallet fields (B6D2B §8.1; **confirmed at runtime**, §2.1 item 11).
- **No network from Unity:** the runtime proof recorded **0** Socket.IO /
  WebSocket / Railway / Supabase / auth / wallet requests (B6D2B §15A).

**[Verified — residual hardening item]**

- **Unity engine default diagnostics endpoints** (`cdp.cloud.unity3d.com`,
  `config.uca.cloud.unity3d.com`) were observed at runtime; they carry no
  project/player/auth/wallet data but are **flagged for B6D3 hardening** (B6D2B
  §15 network evidence). A player-facing step should **disable/verify** these.
  (Disabling requires `ProjectSettings` changes handled in a dedicated, separately
  reviewed change — the local `ProjectSettings.asset` must never be touched by
  planning work.)

**[Proposed B6D3 — additional isolation requirements]**

- The **identity model (§7)** must be unit-tested to prove no raw ID/PII crosses
  the boundary before any player-facing activation.
- The **cohort gate** must be server-side and must not expose which sessions are
  selected to the client beyond what is needed to render.
- **CSP / iframe sandbox** for the player-facing surface should be reviewed so the
  Unity iframe cannot reach any origin other than the same-origin artifact rewrite
  (plus any explicitly-approved, hardened engine endpoint).

---

## 12. PERFORMANCE & COMPATIBILITY

**[Verified today]** The artifact is gzip-compressed with immutable versioned
caching (B6C); total artifact ≈ 10.7 MB, 17 files (B6D2B §12-13). The shadow path
adds no render/timing cost when off (mirrors run only while enabled,
`MatchRoomPanel.tsx:874-881`).

**[Proposed B6D3 — must be measured, not assumed]**

- **Device matrix:** Desktop Chrome/Edge, Android Chrome, iPhone Safari — measure
  load time, FPS, memory, and thermals for a full match including sudden death.
- **Perf budget as a gate:** B6D3 player-facing activation for a cohort must be
  gated on meeting an agreed load-time / FPS / memory threshold; below threshold →
  React only.
- **Slow-network behaviour:** delayed load / queue-until-ready; ready-timeout →
  React fallback (§10).
- **Cache correctness:** immutable versioned URLs (B6C) + `protocolVersion` skew
  detection prevent a stale build from mis-rendering.
- **No regression to React:** the React renderer path must be unchanged and
  independently benchmarked to confirm Unity’s presence (mounted underneath) adds
  no measurable cost when Unity is healthy or when it falls back.

---

## 13. PROPOSED IMPLEMENTATION SPLIT (B6D3A–B6D3E)

**[Proposed B6D3 — each subphase requires its own separate review/gate. None is
authorized here.]** The order is strictly prerequisite-before-dependent: the pure
contract precedes the lifecycle host, which precedes mock/runtime proof, which
precedes any real-match testing.

- **B6D3A — Identity/visual-side & correlation contract (TypeScript + unit tests
  ONLY).** Define the non-identifying player/seat/visual-side label model (§7) and
  the exact `round_result` ↔ `match_state_sync` correlation rule (§8); pure
  TypeScript + unit tests proving **no raw ID/PII** crosses the boundary and no
  local score/result derivation. **No Unity activation, no real match, no
  `MatchRoomPanel` change, no `MatchRenderer3D` change, no server change, no Unity
  C# change, no environment change, no deployment.** Permitted files: the three
  standalone TS modules + their tests + this doc (§14). Real matches: **No.**
  Production: **NO-GO.**
- **B6D3B — Isolated React lifecycle host & fail-open fallback logic
  (default-off, dev surface).** Build an isolated host component + the separate
  player-facing flag design + **server-side cohort gate** design (§9) and the
  fail-open fallback logic, mounting Unity as the visible renderer for the cohort
  **with React mounted underneath as fallback**. **No real match and no flag
  configuration in this subphase** — driven by mock/deterministic events only.
  Non-production only; `notFound()`/inert in production. Minimal, additive,
  lifecycle-safe changes to `MatchRoomPanel.tsx` only where unavoidable (§14).
  Real matches: **No.** Production: **NO-GO.**
- **B6D3C — Protected-preview mock/runtime proof.** On a protected (SSO) preview
  surface, drive the lifecycle host with deterministic mock Protocol v1 events and
  capture identity-free evidence (ordering, instance, reload/bootstrap, fallback),
  extending the sanctioned `/dev/unity-staging` model. Still **no real match**.
  Real matches: **No.** Production: **NO-GO.**
- **B6D3D — Controlled two-user real-match staging proof (separate explicit
  authorization required).** Only after B6D3C passes and a **separate explicit
  real-match testing authorization** is granted: with the player-facing flag on
  for **internal free-play test accounts only**, render a real two-user match to
  opted-in viewers, React fallback always available; validate normal rounds,
  sudden death, timeout, disconnect/reconnect, rematch, abort, match end, and
  every failure/fallback path (§10, §15). Real matches: **Yes — free-play only,
  internal accounts only, separately authorized.** Production: **NO-GO.**
- **B6D3E — Closeout & production-readiness decision.** Documentation, runtime
  evidence, perf/device results, isolation verification, rollback rehearsal, and a
  **recommendation for a separate future production-hardening phase**. Real
  matches: N/A (decision only). Production: **remains NO-GO** until a separate,
  explicit authorization.

> Prerequisite ordering: **B6D3C protected-preview mock/runtime proof** is an
> **entry gate** for the real-match subphase (B6D3D); player-facing runtime
> activation is never described as happening before its prerequisite mock/preview
> evidence.

---

## 14. EXACT PROPOSED FILE SCOPE

**[Proposed B6D3 — file-level scope for review. No file is edited by this
document.]** Sensitivity is marked; anything touching `MatchRoomPanel.tsx` must be
**narrow, additive, lifecycle-safe, and specifically reviewed**.

### 14.1 First recommended subphase (B6D3A) — permitted files

| File | Role in B6D3A | Sensitivity |
|---|---|---|
| `apps/web/src/components/match/unityPresentationProtocol.ts` | Additive types for non-identifying labels/visual-side — additive only | Medium (shared contract) |
| `apps/web/src/components/match/unityPresentationAdapter.ts` | Identity/visual-side + correlation mapping — new pure functions | Medium |
| `apps/web/src/components/match/unityPresentationShadow.ts` | Correlation/audit support — pure | Medium |
| `apps/web/src/components/match/*.test.ts` | New identity-model + correlation-rule unit tests | Low |
| `apps/web/package.json` | **Only** to register a new test file in `test:unity-presentation` (no dependency change; lockfile unchanged) | Low |
| `docs/unity-b6d3-player-facing-integration-scope.md` (+ a new B6D3A design doc) | Documentation | Low |

### 14.2 Files requiring special review (later subphases, NOT B6D3A)

| File | Proposed role | Sensitivity |
|---|---|---|
| `apps/web/src/components/match/MatchRenderer3D.tsx` | Player-facing render mode wiring (B6D3B) — additive prop; keep origin/source/allowlist/fallback intact | **High** (security boundary) |
| `apps/web/src/components/match/MatchRoomPanel.tsx` | **Sensitive** — owns timers, reveals, scores, reconnect, and the whole match lifecycle. Any B6D3 change here must be **minimal, additive, lifecycle-safe, and specifically reviewed**; must not alter timer/reveal/score/reconnect logic | **HIGHEST** (real-match regression risk for all players) |
| New player-facing surface (proposed, dev/preview only) | Server-gated route/component mirroring `/dev/unity-staging` isolation | Medium |

### 14.3 Prohibited files (all B6D3 subphases unless separately authorized)

| File | Status |
|---|---|
| Unity C# (`UnityPresentationProtocolV1.cs`, `UnityBridgeReceiver.cs`, `PenaltySceneController.cs`) | **No change** for B6D3A/B; consumption already implemented (B6D2B) |
| `apps/realtime-server/**` | **No change** — server is untouched |
| Supabase schema / auth, `packages/shared/**` | **No change** |
| `unity/Penalty444Client/ProjectSettings/**` incl. `ProjectSettings.asset` | **Untouched** — never staged/reset/normalized |
| `.github/**`, `next.config.*`, Vercel/Railway config, production env | **No change** |
| Generated WebGL output, `audit-artifacts/**` | Never committed |

> **`MatchRoomPanel.tsx` is the highest-sensitivity file.** It owns the live match
> state machine; a regression breaks real matches for every player, Unity or not.
> B6D3 edits here must be the smallest possible additive, lifecycle-safe change and
> must be reviewed line-by-line.

---

## 15. TEST & EVIDENCE MATRIX

**[Proposed B6D3.]** For each row: authoritative behaviour (server-decided,
unchanged) · Unity presentation · fallback · required evidence. "Allowed before
real-match authorization" = permissible in B6D3A–C (TS/mock/preview only);
"Requires later explicit authorization" = B6D3D+ (real matches).

| Scenario | Authoritative behaviour | Unity presentation (expected) | Evidence | When allowed |
|---|---|---|---|---|
| Identity/visual-side mapping | server keys internal | non-identifying label/seat only; **no raw ID/PII** | Unit test + payload capture | B6D3A (now) |
| Correlation rule (result↔state) | `room.scores` incremented pre-`match:result` | scoreboard changes only on `match_state_sync` | Unit test + ordered capture | B6D3A (now) |
| Hostile-input / prototype-pollution | n/a | adapter/parser return null; no throw | Unit test | B6D3A (now) |
| Duplicate / stale / foreign | n/a | dropped, not animated | Sequence/instance log | B6D3A unit + B6D3C mock |
| Instance transition / rematch | new `matchInstance` | old messages dropped; reset + bootstrap | Instance-id capture | B6D3A unit + B6D3C mock |
| Bootstrap before result | `match:update` snapshot | `match_state_sync` applied first | Ordered capture | B6D3C mock |
| Reload / post-reload bootstrap (seq>1) | n/a | fresh ready; complete snapshot; no replay | Reload capture | B6D3C mock |
| Fallback (ready-timeout / error) | normal | none; `markUnavailable` → React | Timeout/error log | B6D3B unit + B6D3C mock |
| Web production build | n/a | n/a | CI build green | B6D3A (now) |
| Realtime build (regression guard) | unchanged | n/a | CI build green | B6D3A (now) |
| Sudden death | `phase=SUDDEN_DEATH`, `suddenDeathRound` | applied exactly; no local progression | Phase capture | B6D3C mock; B6D3D real |
| Reconnect / resume | post-`rejoinState` `match:update` | full-state resync; no replay | Resync capture | B6D3D real |
| Two-browser real match | server-decided | side-by-side vs React | Two-browser capture | **B6D3D — requires authorization** |
| Mobile / browser compatibility | normal | within agreed budget | FPS/mem/load capture | **B6D3D — requires authorization** |
| Cohort gating | server-side | player-facing only for cohort | Gate audit | **B6D3D — requires authorization** |
| No-auth/no-wallet/no-player-ID leakage | normal | 0 prohibited requests; no PII | Network + payload inventory | B6D3A unit + B6D3D real |
| Production route safety | n/a | `notFound()` in production | 200/404 capture | every subphase |

**Web unit tests [Verified today]:** `npm run test:unity-presentation` runs
`unityPresentationAdapter.test.ts`, `unityPresentationShadow.test.ts`, and
`unityStagingProtocol.test.ts` — **149 pass** (B6D2B §10); enforced by the CI Web
job before the TypeScript check. B6D3A must add identity-model and correlation-rule
tests to this suite before any player-facing activation.

---

## 16. RISKS & BLOCKERS REGISTER

**[Proposed B6D3 — planning estimates.]** "Blocks" indicates the earliest subphase
a risk gates; a risk that gates B6D3D does **not** block the pure B6D3A
TypeScript/test subphase.

| # | Risk / Blocker | Prob. | Impact | Mitigation | Blocks | Status |
|---|---|---|---|---|---|---|
| C1 | **Sanctioned `/dev/unity-staging` harness-route run** | — | — | Authenticated same-origin route driven end-to-end, **11/11 PASSED** (§2.1) | — | **CLEARED** |
| 1 | **Identity/visual-side mapping** absent (identity-neutral only) — principal B6D3A design problem | Known | High | B6D3A non-identifying label/visual-side model + unit tests | B6D3A design (resolved *by* B6D3A) | Open (B6D3A deliverable) |
| 2 | **Separate player-facing flag + server-side cohort gate** not yet designed | Known | High | Design + accept before B6D3B | **B6D3B** | Open |
| 3 | **No controlled real-match evidence** for the player-facing path | Known | High | B6D3D two-user real-match staging proof (after B6D3C) | **B6D3D and later** (not B6D3A) | Open |
| 4 | **Unity engine diagnostics endpoints** active | Known | Med | Disable/verify in the player-facing build (dedicated ProjectSettings change) | B6D3D | Open (non-blocking for B6D3A) |
| 5 | Unity shows a **different result** than the server | Low | Critical | Result comes only from `match:result`; Unity never computes; **PASSED** at runtime (§2.1) | — | Mitigated |
| 6 | **Raw player ID / PII leaks** into a Unity payload | Low | Critical | §7 sanitizer + unit tests; field-by-field build; **runtime-confirmed clean** (§2.1) | B6D3A verifies | Mitigated |
| 7 | **`MatchRoomPanel` regression** breaks real matches | Med | Critical | Minimal additive lifecycle-safe diffs only (§14); full match test matrix; CI | B6D3B/D | Managed |
| 8 | **Stale pre-result score** shown (scores not atomic) | Med | High | Split `round_result`/`match_state_sync`; never infer a score; **PASSED** at runtime (§2.1) | — | Mitigated |
| 9 | Duplicate / out-of-order / rematch contamination | Med | High | Existing sequence + instance guards (React + Unity); **PASSED** at runtime (§2.1) | — | Mitigated |
| 10 | **Player-facing failure interrupts the match** | Low | Critical | React mounted underneath; seamless fallback; Unity strictly additive | B6D3B/D | Managed |
| 11 | **Production flag accidentally enabled** | Low | Critical | Separate player-facing flag; server-side cohort gate; `notFound()` in prod; env audit | every subphase | Managed |
| 12 | **Mobile performance** (jank/heat) | High | Med | Perf budget as a gate (§12); React default | B6D3D | Open (non-blocking for B6D3A) |
| 13 | **Strict-origin / allowlist regression** | Low | Critical | Keep `event.origin`+`event.source` checks; never `"*"`; allowlist audit | B6D3B | Managed |
| 14 | **Cohort self-selection** from the client | Low | High | Cohort decided server-side, never a `NEXT_PUBLIC_*` flag | B6D3B | Managed |
| 15 | **Artifact reproducibility** (documented BLOCKED) | Known | Med | Immutable versioned artifacts; redeploy known-good | B6D3E | **BLOCKED** |

**Production remains NO-GO.**

---

## 17. AUTHORIZATION GATES

**[Proposed gates — this document authorizes none of them.]** Gates are separated
by subphase so the pure test-only first subphase is not blocked by real-match
prerequisites.

### Before B6D3A implementation authorization
- This **planning PR merged**.
- **Exact B6D3A file scope reviewed** and approved (§14.1).
- **Pure TypeScript / test-only scope accepted** — no runtime path, no Unity
  activation, no `MatchRoomPanel`/`MatchRenderer3D`/server/Unity-C# change.
- **No environment or flag changes** of any kind.

### Before B6D3B
- **B6D3A merged and reviewed.**
- **Separate player-facing flag + server-side cohort design accepted** (§9).
- **Lifecycle host + fail-open fallback design accepted** (§8, §10).
- Still non-production, mock-driven only.

### Before B6D3C
- **B6D3B merged and reviewed.**
- Protected (SSO) preview surface available; production route 404 verified.

### Before B6D3D (real-match staging)
- **Protected-preview mock/runtime proof (B6D3C) passed.**
- **Explicit, separate real-match testing authorization granted.**
- **Controlled free-play test accounts only**; internal cohort gated server-side.
- **No production.** Rollback (single-flag disable → React) rehearsed.

### Before production-readiness review (B6D3E)
- All above + perf/device thresholds met + isolation verified + rollback
  rehearsed. **Production remains NO-GO until a separate, explicit authorization.**

> Standing gates for every subphase: B6D2B remains merged and stable; master CI
> green (Web + Realtime); production Unity off; free-play-only policy unchanged; no
> local generated-artifact contamination
> (`git ls-files "apps/web/public/unity/penalty444/**"` and `audit-artifacts/**`
> empty). Each subphase (B6D3A–B6D3E) requires its own separate review/gate.

---

## 18. RECOMMENDATION (GO / HOLD)

**Recommendation: GO for B6D3A only.**

B6D3A is **planning-approved as the recommended first bounded subphase, proposed
for separate implementation authorization**:

- pure TypeScript;
- unit tests;
- identity / visual-side contract;
- correlation contract;
- **no Unity activation;**
- **no real match;**
- **no `MatchRoomPanel` change;**
- **no `MatchRenderer3D` change;**
- **no server change;**
- **no Unity C# change;**
- **no environment change;**
- **no deployment.**

The central design problem it resolves is the **player-identity → visual-side
mapping** (§7), which today does not exist; it can be designed and unit-tested
with **zero runtime risk**, reusing the already-verified B6D1 adapter/protocol
patterns and the now-**CLEARED** authenticated harness proof (§2.1, 11/11 PASSED).

- **GO for B6D3A as the next subphase proposed for separate implementation
  authorization.**
- **HOLD on B6D3B and every later player-facing or real-match phase** until B6D3A
  is merged and reviewed, the separate player-facing flag + cohort design is
  accepted (before B6D3B), and — for real-match testing — B6D3C passes and a
  separate real-match authorization is granted (before B6D3D).

This document itself **authorizes no implementation**: it changes no code, enables
no flag, configures no environment, activates no runtime, and leaves the
production decision **NO-GO**.

---

```
B6D3 IMPLEMENTATION: NOT AUTHORIZED
REAL-MATCH UNITY TESTING: NOT AUTHORIZED
PLAYER-FACING UNITY: NOT AUTHORIZED
PRODUCTION UNITY: NO-GO
NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED: UNCONFIGURED
```
