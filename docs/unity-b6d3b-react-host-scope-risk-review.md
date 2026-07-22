# B6D3B — ISOLATED REACT LIFECYCLE HOST: SCOPE AND RISK REVIEW

> **Status: PLANNING / STATIC REPOSITORY REVIEW ONLY.** This document authorizes
> no code, no test, no CI, no feature flag, no cohort gate, no environment
> variable, no Protocol v1 change, no Unity activation, no real match, and no
> deployment. It does not modify `MatchRoomPanel.tsx`, `MatchRenderer3D.tsx`, any
> runtime/test/server/Unity file, or `ProjectSettings.asset`. It defines the
> smallest safe implementation boundary, the exact integration seams, a proposed
> lifecycle host, fail-open contract, flag/cohort design, phase split, tests,
> risks, and gates for a *possible, separately-authorized* B6D3B step — and asks
> for a single GO / GO-WITH-CONDITIONS / HOLD decision in §21.

Evidence labels used throughout:

- **[Verified]** — exists in the repository at the baseline SHA below; cited by
  file and line.
- **[Contract]** — stated in a merged design doc (`docs/unity-b6d3a-*`,
  `docs/unity-b6d3-*`) at the baseline SHA.
- **[Proposed B6D3B]** — a design for a future, separately-authorized subphase;
  not built here.
- **[Recommendation]** — this review's recommendation.

No payload field, event, flag, or file is invented; where something does not
exist it is marked *not present*.

---

## 1. Executive decision

**[Recommendation] GO WITH CONDITIONS** for a *separately-authorized* B6D3B
implementation of an **isolated React lifecycle / fail-open presentation host**,
default-off, non-production, mock-driven only, with **no real match**.

The repository is in an unusually favourable state for this step:

- The **whole React→Unity presentation stack already exists and is default-off**:
  a versioned Protocol v1 (`unityPresentationProtocol.ts`), a sanitizing adapter
  (`unityPresentationAdapter.ts`), a pure shadow coordinator/queue
  (`unityPresentationShadow.ts`), a passive renderer that already fails open
  (`MatchRenderer3D.tsx`), and — merged in B6D3A — the two contract modules a
  player-facing host needs (`unityPresentationIdentity.ts`,
  `unityPresentationCorrelation.ts`). **[Verified]**
- Unity is **never player-facing today**; it is a shadow gated behind three
  build-time flags that are all unconfigured, mounted in a *secondary* panel that
  never replaces React controls (`MatchRoomPanel.tsx:4025-4100`). **[Verified]**
- B6D3A's identity/correlation contracts are **pure, tested (226/226), and not
  yet wired** — exactly the consumables a host needs. **[Contract; Verified]**

The conditions that keep this from an unconditional GO are unchanged design
blockers (not code defects): a **separate player-facing flag** and a
**server-side, non-client-selectable cohort gate** must be designed and accepted,
the **fail-open host lifecycle** must be accepted, and — critically — the
**match route is a client component (`"use client"` + `RequireAuth`), not a
server component** (`app/match/[roomCode]/page.tsx:1-16`), so the "server-side
cohort" cannot be enforced by simply reading auth in the existing page. That
architectural fact shapes the entire recommendation (see §12). B6D3B
implementation remains **NOT AUTHORIZED**; B6D3C/B6D3D remain **NOT AUTHORIZED**;
production remains **NO-GO**.

---

## 2. Scope and non-goals

### In scope (this document)

- Static, repository-grounded review of the exact current integration seams.
- A design (not an implementation) for an isolated lifecycle host, its fail-open
  contract, the player-facing flag, and the server-side cohort gate.
- A precise B6D3B / B6D3C / B6D3D boundary, test matrix, risk register, and gates.
- Exactly one new document (this file) and, optionally, a status/link-only edit to
  the main planning doc.

### Explicit non-goals (not done here, not authorized here)

React implementation; Unity mounting changes; runtime integration; feature-flag
creation or configuration; environment-variable changes; cohort-gate
implementation; server changes; preview-route changes; Unity C# changes; WebGL
rebuilds; real-match testing; manual deployment; production activation; any change
to `MatchRoomPanel.tsx`, `MatchRenderer3D.tsx`, any TS runtime/test file,
`package.json`/lockfiles, `apps/web/src/app/dev/unity-staging/**`,
`apps/realtime-server/**`, `packages/shared/**`, Unity assets/scenes/prefabs/
`ProjectSettings`, `.github/**`, middleware, route handlers, Supabase, Vercel/
Railway config, env files, generated WebGL output, or `audit-artifacts/**`.

---

## 3. Exact baseline SHA

- **Repository:** `chancykibombwe/penalty444-platform`
- **Protected source of truth:** `master`
- **`origin/master` at review time:**
  `092f4fc126398c00cf435674a6210663ff0d4d91` (PR #212 merged — B6D3A
  identity/correlation contracts).
- **Review branch:** `docs/unity-b6d3b-host-scope-risk-review`, created from that
  exact commit in a **separate clean worktree**
  (`C:\Users\EL GADO\Desktop\penalty444-b6d3b-review`).
- The Windows main checkout's locally-modified protected file
  `unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` was **never
  touched** by this review (a separate worktree was used precisely so it cannot
  be). No stash/reset/restore/clean/skip-worktree/assume-unchanged was applied.

---

## 4. Repository-verified current architecture

### 4.1 Runtime map (Socket.IO → React → adapter → envelope → dispatch → Unity → fallback)

All items below are **[Verified]** at the baseline SHA.

1. **Authority — Node.js / Socket.IO.** The realtime server decides every
   outcome, score, phase, winner, timer, and sudden-death progression
   (`apps/realtime-server/`; responsibility matrix in
   `docs/unity-b6d3-player-facing-integration-scope.md` §5.1). Scores are **not**
   atomic with `match:result`: the server increments `room.scores` **before**
   emitting `match:result`, and `match:result` carries **no** scores; the
   authoritative post-result scoreboard arrives on a later `match:update`
   (documented in `unityPresentationCorrelation.ts:6-9` and the B6D3 scope doc §6).
2. **React match state — `MatchRoomPanel.tsx`.** Owns the single Socket.IO
   subscription, the match state machine, timers, reveal pacing, scores, phase,
   `matchInstance`, reconnect, rematch. This is the **highest-sensitivity file**
   (≈4100 lines).
3. **Presentation adapter — `unityPresentationAdapter.ts`.** Pure, exception-safe,
   field-by-field mapping of raw authoritative payloads → Protocol v1 envelopes
   (`buildRoundResultEnvelope`, `buildMatchStateSyncEnvelope`,
   `buildTerminalStateSyncEnvelope`). Maps `kickerPick→kickerLane`,
   `keeperPick→keeperLane`; never carries scores on `round_result`; returns `null`
   on malformed input; never spreads raw payloads.
4. **Protocol v1 envelope — `unityPresentationProtocol.ts`.**
   `PRESENTATION_TYPE = "PENALTY444_MATCH_EVENT"`, `PROTOCOL_VERSION = 1`, events
   `round_result | match_state_sync` (`:23-26`); `validateEnvelope`,
   `sanitizeScores` (prototype-pollution guard), `deriveMatchInstanceId`
   (`<ROOMCODE>:<INSTANCE>`, `:305-317`), `PresentationSequenceEmitter` (sender,
   resets to 1 per instance, `:326-346`), `PresentationSequenceGate` (receiver
   reference logic, `:359-405`).
5. **Shadow coordinator + queue — `unityPresentationShadow.ts`.**
   `UnityPresentationShadowCoordinator` owns the active instance, the sequence,
   and the last complete snapshot; commits **atomically only after a successful
   build** (a malformed payload consumes no sequence, `:181-302`). Also provides
   the FIFO `ShadowDispatchQueue` (dedup + hard cap 32, `:324-369`), sanitized
   audit summaries (score **values** only, never id keys, `:70-96`), and the
   pure pending-UNSENT buffer helpers (`appendPending`/`acknowledgePending`/
   `replacePending`/`pendingForInstance`/`isEnvelopeForActiveInstance`,
   `:447-499`).
6. **Renderer — `MatchRenderer3D.tsx`.** Passive iframe shell. Reads only
   `NEXT_PUBLIC_UNITY_MATCH_ENABLED` (`:249`) and `NEXT_PUBLIC_UNITY_BUILD_URL`
   (`:250`); opens no socket, reads no auth. Strict inbound checks:
   `event.origin === window.location.origin` **and**
   `event.source === iframe.contentWindow` (`:374-375`); outbound `postMessage`
   always targets `window.location.origin`, never `"*"` (`:332`, `:355`); inbound
   allowlist is only `ready | animation_complete | error` (`validateUnityMessage`,
   `:132-164`). `UNITY_READY_TIMEOUT_MS = 15_000` (`:187`); `markUnavailable`
   unmounts the iframe and fails open to React (`:294-309`, `:506-526`). Supports
   `deliveryMode="fifo"` with an `activeMatchInstanceId` prop that clears the
   queue on instance change (`:425-457`).
7. **Unity acknowledgement/failure.** Unity → React emits only
   `ready`/`animation_complete`/`error`; a Unity `error`, a load failure, or a
   readiness timeout all route to `markUnavailable`. The Unity-side parser/gate
   (B6D2B) enforces sequence/instance and carries **numeric score values only** in
   acks (`docs/unity-b6d2b-unity-consumption-runtime.md`; summarized in the B6D3
   scope doc §2).
8. **React fallback.** React is always the authoritative renderer; the shadow is
   an **additive secondary panel** (`MatchRoomPanel.tsx:4025-4100`). If Unity is
   missing/slow/errors, the panel shows an "unavailable" card and the React match
   is unaffected.

### 4.2 Ownership (who owns each value) — [Verified]

| Value | Owner | Notes |
|---|---|---|
| Outcome / score / phase / winner / sudden death | Node realtime server | sole authority |
| Socket.IO subscription, timers, reveal timing, `matchInstance`, reconnect/rematch | `MatchRoomPanel.tsx` | single subscription; client reveal timing |
| Protocol instance id + sequence | `UnityPresentationShadowCoordinator` (`unityPresentationShadow.ts`) | `deriveMatchInstanceId`, `PresentationSequenceEmitter` |
| Pending-UNSENT buffer / active-instance mirror | `MatchRoomPanel.tsx` state (`unityB6D2Pending`, `unityB6D2ActiveInstanceRef`, `:901-908`) | replaced on instance change / ready |
| Readiness, iframe lifecycle, fail-open | `MatchRenderer3D.tsx` (`readyRef`, `markUnavailable`) | 15 s timeout |
| Identity/visual-side & correlation (contract only) | `unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts` | **not wired** |

- **Sequences are created** in `PresentationSequenceEmitter.next()`
  (`unityPresentationProtocol.ts:331-341`), driven by the coordinator's
  `commit()` (`unityPresentationShadow.ts:181-188`).
- **Instance changes are handled** synchronously in `publishB6D2Shadow` via
  `unityB6D2ActiveInstanceRef` and `replacePending` (`MatchRoomPanel.tsx:935-945`)
  and, in the renderer, by the `activeMatchInstanceId` reset effect
  (`MatchRenderer3D.tsx:425-431`).
- **Readiness is handled** by `handleIframeLoad`/`armReadyTimeout` and the
  `ready` message branch (`MatchRenderer3D.tsx:367-478`), with the parent
  publishing a fresh `ready_resync` in `handleB6D2Ready`
  (`MatchRoomPanel.tsx:967-987`).
- **Pending messages are buffered** as UNSENT-only (never replayable history);
  acknowledged on delivery (`handleB6D2Sent`, `:998-1006`).
- **Unity availability is tracked** in the renderer (`unavailableRef`/`status`)
  and mirrored into a sanitized audit (`unityB6D2Audit.unityStatus`).

### 4.3 Is React always rendered beneath Unity today? — [Verified] Yes.

Unity mounts **only** inside the `unityShadowEnabled` secondary `<section>`
(`MatchRoomPanel.tsx:4025`), which is *below* the arena and "never obscures or
replaces lane controls, scoreboard, timer, reveal, disconnect, or match-end UI"
(comment `:4018-4024`). React is the primary renderer at all times; Unity is
strictly additive. There is **no code path today that promotes the shadow to a
visible/primary renderer** — the three flags only feed a shadow, and no flag
swaps React out.

### 4.4 Could current code accidentally promote shadow Unity to visible mode? — [Verified] No.

`unityB6D2ShadowEnabled` requires all three flags true (`:889-891`) and only
changes the *delivery contract* (legacy vs versioned) into the same secondary
panel; it never changes layout/visibility or unmounts React. The renderer returns
`null` when `NEXT_PUBLIC_UNITY_MATCH_ENABLED !== "true"` (`MatchRenderer3D.tsx:486`).
Promotion to a player-facing renderer would require **new** code — which is
precisely the B6D3B work under review.

---

## 5. Current Unity flags and activation path

Three build-time **public** flags, all required, all default-off/unconfigured
(**[Verified]**):

1. `NEXT_PUBLIC_UNITY_MATCH_ENABLED === "true"` — mounts the optional iframe
   (`MatchRenderer3D.tsx:249`; `MatchRoomPanel.tsx:861`).
2. `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED === "true"` — feeds the live shadow
   (`unityShadowEnabled`, `MatchRoomPanel.tsx:860-862`).
3. `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED === "true"` — switches to versioned
   Protocol v1 envelopes (`unityB6D2ShadowEnabled`, `:889-891`).

A separate, server-gated staging route (`app/dev/unity-staging/page.tsx`) is
gated by **server-only** vars `UNITY_STAGING_ROUTE_ENABLED` and
`UNITY_STAGING_ARTIFACT_ORIGIN` and returns `notFound()` when
`VERCEL_ENV === "production"` (`:39-49`). This is the repository's reference
pattern for a *server-side, non-`NEXT_PUBLIC_*` gate* and a *production hard
block*.

**Proof the flags are shadow-oriented today.** Even with all three `"true"`,
Unity renders only in the additive secondary panel and receives shadow envelopes;
nothing swaps React out. Therefore the existing flags are, by construction,
**insufficient to make Unity player-facing** — a new gate is required (see §11).
`NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` remains **UNCONFIGURED**.

---

## 6. Integration-seam comparison

Goal: the **narrowest** seam that can make Unity the *visible* renderer for a
cohort while React stays mounted and authoritative underneath, without moving
gameplay state, adding a socket subscription, duplicating timers/reveal logic, or
remounting React gameplay state.

| # | Option | Files changed | State/props | Timers/socket impact | Fallback | Testability | Recommendation |
|---|---|---|---|---|---|---|---|
| 1 | **Wrapper around existing renderer + iframe** (a new `UnityPresentationHost` that composes `MatchRenderer3D`) | New host + host tests; **no** `MatchRenderer3D` edit | Host owns only presentation lifecycle; consumes the same `messages`/`activeMatchInstanceId`/`onReady`/`onError`/`onMessageSent` the panel already produces | None — reuses the existing renderer's single `message` listener; adds no socket, no timer | Reuses `markUnavailable`; host adds a visible↔hidden decision | **High** — pure component; deterministic mock props | **Recommended** |
| 2 | New sibling component mounted by the match page | Match page (currently `"use client"`, `app/match/[roomCode]/page.tsx`) + new host | Sibling would need match state it does not have | Would require a **second** source of match state or prop-drilling from the panel → risk of divergence | Weaker (state not co-located) | Medium | Not recommended |
| 3 | **Minimal bounded integration inside `MatchRoomPanel`** (swap the secondary `<section>` for a host in a player-facing branch) | `MatchRoomPanel.tsx` (HIGHEST sensitivity) + host | Reuses existing `unityB6D2Pending`/`activeInstance`/handlers already present (`:4043-4051`) | None new **if** additive; risk of touching lifecycle | Reuses existing fail-open | Medium (must guard the giant file) | Acceptable **only** as a minimal, additive mount-point swap |
| 4 | Extend `MatchRenderer3D` itself to own visibility | `MatchRenderer3D.tsx` (security boundary) | Mixes transport + visibility concerns | None new | Same | Lower (couples concerns) | Not recommended — keep the renderer a pure transport/fail-open shell |

**Key architectural constraint [Verified].** The match page is a **client
component** wrapped in client-side `RequireAuth` (`app/match/[roomCode]/page.tsx:1-16`),
and `MatchRoomPanel` already *owns and produces* everything a host needs
(`unityB6D2Pending`, `unityB6D2ActiveInstance`, `handleB6D2Ready/Error/Sent`,
`:4043-4051`). That is why **Option 1 (a wrapper), mounted at the exact existing
mount point, is strictly narrower than Option 2**: the sibling option would have
to re-source match state that only the panel holds.

---

## 7. Recommended isolated host boundary

**[Recommendation]** Implement B6D3B as a new, self-contained presentation host
component (working name `UnityPresentationHost`) that:

- **Composes** `MatchRenderer3D` (does **not** replace or edit it) and consumes
  the *already-produced* FIFO props (`messages`, `activeMatchInstanceId`,
  `onReady`, `onError`, `onMessageSent`).
- Owns **only presentation-lifecycle** state (visible vs React-only vs failed),
  never match/gameplay state, never a socket, never a timer that affects gameplay,
  never reveal logic.
- Is mounted at the **single existing mount point** in `MatchRoomPanel.tsx`
  (`:4043-4051`) behind a **new player-facing branch**; the change to the panel is
  a **minimal, additive mount-point swap** (render the host instead of the bare
  renderer when the player-facing gate is on) — no change to timers, reveals,
  scores, reconnect, or the socket handler.
- Keeps **React mounted and authoritative** at all times; "player-facing" means
  the host visually *overlays/reveals* Unity above the already-present React
  renderer and *hides* (never unmounts) React, so a fail-open is instantaneous.

### 7.1 Does `MatchRoomPanel.tsx` have to change? — [Recommendation] Minimally, yes.

It is *not* strictly untouchable, because the mount point lives inside it
(`:4043-4051`) and the new player-facing gate must decide what to render there.
The recommended change is the **smallest possible additive edit**: introduce a
`playerFacingEnabled` boolean (from the new flag + cohort signal) and, when true,
render `<UnityPresentationHost …/>` in place of the current bare renderer at the
existing mount point, passing the **same** props already computed. **No** timer,
reveal, score, socket, reconnect, or state-machine logic may change. If a
future design can inject the host purely via composition without any panel edit,
that is preferable — but this review does not assume the panel can remain
byte-for-byte untouched, and it explicitly flags any panel edit as HIGHEST
sensitivity requiring line-by-line review.

### 7.2 Does `MatchRenderer3D.tsx` have to change? — [Recommendation] No.

The renderer already provides FIFO delivery, strict origin/source checks,
same-origin `postMessage`, the inbound allowlist, the 15 s readiness timeout, and
`markUnavailable` fail-open. B6D3B should **treat it as a stable transport/
fail-open boundary and not edit it**. Visibility is a *host* concern layered
above it. (The B6D3 scope doc's earlier note about an "additive render-mode prop"
on the renderer, §14.2, is superseded by this review's recommendation to keep the
renderer untouched and put visibility in the host.)

---

## 8. Proposed lifecycle state machine

**[Proposed B6D3B]** Host-owned presentation lifecycle only (no gameplay state).
Suggested states, using repository naming conventions
(`UnityRendererStatus = loading|ready|unavailable` already exists in the
renderer, `MatchRenderer3D.tsx:190`):

- `DISABLED` — player-facing gate off or cohort denied → host renders nothing
  extra; React only.
- `REACT_ONLY` — gate on, but Unity not yet visible (pre-ready or intentionally
  hidden); React visible and authoritative.
- `UNITY_LOADING` — iframe mounted, awaiting `ready` (bounded by the renderer's
  15 s timeout).
- `UNITY_READY_VISIBLE` — `ready` received; Unity revealed above React; React
  hidden (mounted) beneath.
- `UNITY_FAILED_REACT_FALLBACK` — any failure; Unity hidden/unmounted; React
  revealed; terminal for the current match instance (fail-open).

Design rules the host must honour (**[Proposed B6D3B]**, all presentation-only):

- **Keep React mounted at all times**; never unmount the React renderer to show
  Unity.
- **Hide, don't unmount, React** while Unity is visible (CSS visibility/layering),
  so fallback is instantaneous and needs no state refetch.
- **Prevent input interception**: a hidden or failed iframe must not receive
  pointer/keyboard focus; when React is the visible layer it must own pointer
  events (`pointer-events` discipline; the loading overlay is already
  `pointer-events-none`, `MatchRenderer3D.tsx:543`).
- **Reset lifecycle on a new `matchInstanceId`** (reuse the existing
  `activeMatchInstanceId` reset path, `MatchRenderer3D.tsx:425-431`).
- **Treat iframe reload as a new ready lifecycle** (reuse `handleIframeLoad` +
  `handleB6D2Ready` → fresh `ready_resync`, no history replay).
- **Discard pending presentation messages** that predate a ready/instance change
  (already the behaviour: `replacePending`, `fifoQueueRef.reset()`).
- **Permanently fail open for the current instance after a fatal Unity error**
  (mirror `markUnavailable`'s idempotent, no-resurrect rule,
  `MatchRenderer3D.tsx:296-297`, `:382`); recovery is allowed only on a new
  instance/reload, not by resurrecting a failed session.

This review **does not implement** the state machine.

---

## 9. Fail-open and fallback contract

**[Proposed B6D3B]** For every failure category: what happens to Unity, whether
React stays interactive, whether the match continues, whether retry is allowed,
permitted sanitized telemetry, and what must never be logged. The fail-open path
requires **no server intervention** and must **never** interrupt gameplay.

| Failure | Unity | React interactive? | Match continues? | Retry? | Sanitized telemetry allowed | Never log |
|---|---|---|---|---|---|---|
| iframe load failure | unmount (`handleIframeError`) | Yes | Yes | Only on new instance/reload | reason code, counter | payloads/ids |
| readiness timeout (15 s) | unmount (`markUnavailable`) | Yes | Yes | New lifecycle only | reason, elapsed bucket | ids/tokens |
| malformed acknowledgement | ignored (`validateUnityMessage`→null) | Yes | Yes | n/a | event name only | raw ack |
| rejected message (foreign/stale/duplicate) | not applied | Yes | Yes | n/a | reject reason (enum) | ids/scores-by-id |
| sequence/instance rejection | not applied (gate) | Yes | Yes | n/a | instance id + reason | player ids |
| `postMessage` exception | fail open (`markUnavailable`) | Yes | Yes | New lifecycle only | reason | error object w/ payload |
| Unity render/runtime `error` | fail open | Yes | Yes | New lifecycle only | "unity_error" | Unity's raw message verbatim |
| iframe reload | fresh ready lifecycle | Yes | Yes | Yes (bootstrap) | "reload" | history |
| navigation / unmount | host tears down | Yes (until nav) | Yes | n/a | none required | — |
| rematch / new instance | reset + bootstrap | Yes | Yes | Yes | new instance id | old-instance data |
| missing / unavailable artifact | placeholder / unmount | Yes | Yes | n/a | "artifact_missing" | origin secrets |
| cohort / flag revocation | hide Unity → React | Yes | Yes | n/a | "revoked" | cohort membership details |

All of the above **reuse existing, tested mechanisms** in `MatchRenderer3D.tsx`
and the coordinator; B6D3B's host only adds the *visible↔hidden* decision on top.
Telemetry must be **identity-free** (numeric score values / counts only, mirroring
`buildAuditSummary`, `unityPresentationShadow.ts:70-96`).

---

## 10. B6D3A identity / correlation consumption

The two merged B6D3A modules are the intended consumables (**[Contract; Verified]**):

- `buildViewerIdentityContext(input)` → `ViewerIdentityContext`
  (`unityPresentationIdentity.ts:196-290`): viewer-relative `SELF/OPPONENT`,
  visual side `SELF→LEFT`, `OPPONENT→RIGHT` (`:255-263`), verbatim score
  projection (no arithmetic, §7 of the contract), optional all-or-nothing
  `KICKER/KEEPER` roles (`:218-234`), optional authoritative outcome (never
  derived from scores, `:236-252`), optional bounded display label with
  raw-id-containment defence-in-depth (`sanitizeDisplayLabel` + `labelIsFreeOfRawIds`,
  `:111-167`, `:270-278`).
- `correlateResultToStateSync(result, stateSync)` → typed
  `CorrelationResult` (`unityPresentationCorrelation.ts:110-168`): accepts only
  when both validate, same `matchInstanceId`, `stateSync.sequence > result.sequence`,
  and round delta ∈ {0 (terminal), 1 (continuation)}; **only `match_state_sync`
  is score-bearing** (`isScoreBearingEvent`, `:73-75`).

**Consumption design [Proposed B6D3B]:**

- **Where raw ids may exist:** only *inside React* — `MatchRoomPanel` already
  receives `scores` keyed by internal `playerId`, `kickerPlayerId`,
  `keeperPlayerId`, and knows the viewer. Raw ids are passed **into**
  `buildViewerIdentityContext` and **discarded** in its output.
- **Where they must be discarded:** at the host boundary. The host consumes only
  the sanitized `ViewerIdentityContext` / `CorrelationSummary`; **no raw id ever
  reaches the host or a Unity payload**. (Note: legacy `getUnityMatchEndPresentation`
  returns a `winnerId` that **is** a raw score-map key,
  `MatchRoomPanel.tsx:278-301`; it is legacy-shadow-only and must **never** feed
  the player-facing path.)
- **SELF/OPPONENT → LEFT/RIGHT:** taken directly from the identity context.
- **Role changes / score projection / when a `round_result` animation runs vs
  when the scoreboard updates:** governed by the correlation rule — the animation
  is driven by `round_result`; the **scoreboard updates only on the correlated
  `match_state_sync`** (never inferred from `match:result`). Terminal (equal round)
  vs continuation (next round) is distinguished by the round-delta rule.
- **Rematch instance separation:** enforced by `matchInstanceId` equality in both
  modules; a new instance is a new context.

**Recommended approach:** **Keep Protocol v1 unchanged and consume identity/
correlation only inside React (host + adapter layer); do NOT send display labels
to Unity in B6D3B** (labels remain omittable and unshipped, matching B6D3A §9).
Rationale: it preserves every wire-shape invariant, requires no protocol version
bump, keeps the sanitizer as the single choke point, and defers any additive
presentation contract (display labels crossing the boundary) to a *separately
authorized* protocol phase only if a real product need appears. This is the
lowest-risk path and fully reuses the already-tested contracts.

---

## 11. Separate player-facing flag design

**[Proposed B6D3B] — designed, not created.**

- **Proposed flag:** `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED` (build-time public,
  default-off), consistent with existing `NEXT_PUBLIC_UNITY_*` naming.
- **Why the three existing flags are insufficient:** they only ever feed a
  *shadow* into an additive panel (§4.3–§4.4); none swaps React out. A distinct
  flag guarantees that turning the shadow on can **never** promote Unity to the
  player-facing renderer.
- **Required combination:** player-facing mode requires **all three existing
  flags AND the new flag AND a server-side cohort grant** (§12). The public flag
  is necessary but **not sufficient**.
- **Single disable → React for everyone:** turning off the new flag (or any of
  the three shadow flags) instantly reverts every session to React, because the
  host only reveals Unity when every gate is satisfied.
- **Production hard block:** the player-facing surface must return `notFound()` /
  be inert when `VERCEL_ENV === "production"`, mirroring the staging route
  (`app/dev/unity-staging/page.tsx:39-41`).
- **Build-time public flag vs server cohort:** a `NEXT_PUBLIC_*` flag is baked
  into the client bundle and is globally on/off; it can gate *whether the feature
  exists in a build*, but it **cannot** decide *which authenticated session* is in
  the cohort. Cohort membership must be a server decision (§12).
- **Why browser-editable state cannot grant access:** any client-only value
  (localStorage, a public flag, a query param) is attacker-controlled; it must
  never be sufficient to make Unity player-facing.

No flag is created, configured, or enabled by this document.

---

## 12. Server-side cohort design

**[Proposed B6D3B] — designed, not implemented.** Goal: a cohort that **cannot be
self-selected from browser JavaScript**.

**Critical repository fact [Verified].** The match route is a **client
component** (`app/match/[roomCode]/page.tsx:1-16`, `"use client"` +
`useParams` + client `RequireAuth`); there is **no middleware** in the repo
(none found under `apps/web`), and `MatchRoomPanel` is a client component. So a
cohort decision cannot be made by "reading auth in the existing server page" —
there isn't one for the match route. The repository *does* have a proven
**server-only allowlist pattern**: the `/api/admin/*` routes read a server-only
`ADMIN_EMAILS`, verify the JWT with `admin.auth.getUser(token)` (service role),
and **return only a boolean** (`app/api/admin/me/route.ts:7-67`).

| Option | Trust boundary | Required files (new) | Supabase server auth? | Middleware? | Client-bypass risk | Local dev | Preview | Production | Revocation |
|---|---|---|---|---|---|---|---|---|---|
| **A. Server route handler cohort check** (`/api/unity-cohort/me`, mirrors `/api/admin/me`) | Server verifies JWT + server-only allowlist; returns boolean only | new route handler + host consumption | Yes (`admin.auth.getUser`) | No | **Low** (list never sent; boolean only) | Needs `SUPABASE_SERVICE_ROLE_KEY` (absent locally per root `AGENTS.md`) → treat as not-in-cohort | Works on protected preview | `notFound()`/inert via `VERCEL_ENV` | flip server env var |
| B. Server-only signed cookie/session claim | Cookie set server-side, verified server-side | route(s) to mint/verify | Optional | Likely | Low if signed + httpOnly | Cookie plumbing needed | Works | Blocked | expire/rotate cookie |
| C. Convert match route to a server component + server gate | Server decides before render | large refactor of `match/[roomCode]/page.tsx` | Yes | No | Low | Same service-role caveat | Works | Blocked | env/allowlist |
| D. Middleware allowlist | Edge/server before route | new `middleware.ts` | limited (edge) | Yes | Low | new infra | Works | Blocked | env/allowlist |

**Recommended [Recommendation]: Option A** — a new **server route handler** that
mirrors the audited `/api/admin/me` pattern (server-only allowlist env, JWT
verified via service role, returns only `{ inCohort: boolean }`). The client host
calls it and reveals Unity only if `inCohort === true` **and** the public flag is
on **and** `VERCEL_ENV !== "production"`. It reuses an existing, reviewed trust
boundary, adds no middleware, changes no schema/RLS, and degrades safely (no
service-role key locally ⇒ treated as not-in-cohort ⇒ React only). **Note:** even
Option A requires a **new route handler**, which is **out of scope for this
review and for any un-authorized subphase**; it is listed as B6D3B design to be
approved before implementation.

No database schema, Supabase policy, middleware, route, or server code is created
or changed by this document.

---

## 13. Protocol, security and privacy boundaries

**Current protections [Verified].**

- **Same-origin only** inbound (`origin` **and** `source` check,
  `MatchRenderer3D.tsx:374-375`); outbound always `window.location.origin`, never
  `"*"` (`:332`, `:355`).
- **Inbound allowlist** `ready|animation_complete|error` (`:132-164`); Unity has
  no authority.
- **Sanitizing adapter/protocol**: field-by-field build; prototype-pollution
  guard; finite non-negative integer scores; returns null, never throws
  (`unityPresentationProtocol.ts:100-251`, `unityPresentationAdapter.ts`).
- **No identity in acks/audit**: numeric score **values** + counts only
  (`unityPresentationShadow.ts:70-96`); B6D3A output proven id-free by tests.
- **Iframe policy**: `allow="autoplay; fullscreen"` (`MatchRenderer3D.tsx:539`);
  no `sandbox` attribute is set today.
- **Production route safety**: staging route `notFound()` in production
  (`app/dev/unity-staging/page.tsx:39-41`).

**Proposed protections [Proposed B6D3B].**

- Route all player-facing identity through `buildViewerIdentityContext`;
  **never** forward a raw score-map key (guard against the legacy
  `getUnityMatchEndPresentation` winnerId, `MatchRoomPanel.tsx:278-301`).
- Add an explicit **iframe `sandbox`/`allow`** review for the player-facing host
  (least privilege) and a **CSP** review so the iframe can reach only the
  same-origin artifact rewrite (plus any explicitly hardened engine endpoint noted
  in B6D2B).
- Keep **auth/session isolation**: the host reads no token and passes none to
  Unity (renderer already enforces this).
- **Wallet/economy exclusion**: no wallet/economy data anywhere near the boundary
  (unchanged invariant).
- **No Protocol v1 change** and **no new event** in B6D3B (§10 recommendation).

---

## 14. B6D3B / B6D3C / B6D3D phase split

**[Proposed / Contract]**

- **B6D3B — isolated React lifecycle / fail-open host.** New host component +
  the player-facing flag design + the server-side cohort gate design + fail-open
  fallback logic; **mock/deterministic events only, no real match, no flag
  configuration**; non-production, `notFound()`/inert in production; minimal
  additive mount-point change in `MatchRoomPanel.tsx` only where unavoidable;
  automated/unit/component tests. **Entry:** this review merged; file scope,
  host, flag, cohort, fallback, and test plans approved; no unresolved critical
  risk. **Exit:** host merged; 226+ tests green; new host/fallback tests green;
  `tsc`+`next build` green; no runtime activation.
- **B6D3C — protected-preview mock/runtime proof.** Drive the host with
  deterministic mock Protocol v1 events on a protected (SSO) preview; verify
  lifecycle transitions, ordering, instance/reload/bootstrap, and React fallback;
  **no real match**. **Entry:** B6D3B merged; protected preview available;
  production route 404 verified; deterministic mock procedure approved. **Exit:**
  documented mock proof passes; identity-free evidence captured.
- **B6D3D — controlled two-user real-match staging proof.** **Requires separate
  explicit real-match authorization.** Internal free-play accounts only; server-
  gated cohort; validate normal rounds, sudden death, timeout, disconnect/
  reconnect, rematch, abort, match end, and every fallback path; rollback
  (single-flag disable → React) rehearsed. **Entry:** B6D3C passed + explicit
  authorization. **Exit:** all scenarios pass; rollback proven; production remains
  NO-GO.

---

## 15. Test and evidence strategy

**[Proposed B6D3B]** Host tests are **unit/component-level** (no real match). What
belongs to B6D3B vs the B6D3C runtime proof is marked.

B6D3B (automated):

- Host lifecycle unit tests for each state transition (§8).
- **React remains mounted** in every state incl. `UNITY_FAILED_REACT_FALLBACK`.
- Readiness timeout → fallback; iframe load failure → fallback; `postMessage`
  failure → fallback; Unity `error` → fallback.
- Malformed / rejected acknowledgements ignored; foreign/stale/duplicate sequence
  dropped (reuse existing gate coverage).
- New-instance reset; rematch separation; pending discarded on ready/instance.
- Flag disabled → `DISABLED`; cohort denied → React only; production hard-block
  (`VERCEL_ENV`) → inert.
- **Hidden/failed iframe cannot intercept pointer or keyboard input**; fail-open
  preserves React controls.
- **No socket subscription duplication; no timer duplication; no raw-id leakage**
  (assert host props/outputs are id-free).
- **Existing 226 Unity-presentation tests remain green**; `tsc --noEmit` and
  `next build` regression guards; realtime `build` regression guard.

B6D3C (runtime proof, not B6D3B): deterministic mock Protocol v1 drive on a
protected preview; ordered/instance/reload/bootstrap/fallback evidence; identity-
free capture. Two-browser real-match evidence is **B6D3D only**.

The `test:unity-presentation` script already runs 5 files (adapter, shadow,
identity, correlation, staging) = **226 tests** (`apps/web/package.json:13`); new
host tests would be registered there in B6D3B (a `package.json` script-only edit —
out of scope here).

---

## 16. Performance, UX and accessibility bounds

**[Proposed B6D3B] — budgets to be met in later subphases; not measured here.**

- **Unity readiness timeout:** reuse `UNITY_READY_TIMEOUT_MS = 15_000`
  (`MatchRenderer3D.tsx:187`); below-threshold → React.
- **Fallback transition latency:** instantaneous (React already mounted/hidden);
  target a single frame with no state refetch.
- **Max iframe remounts per match instance:** bounded; reload = fresh lifecycle;
  fatal error is terminal for the instance (no resurrection).
- **React interaction availability:** 100% — React controls always usable.
- **Layout-shift tolerance:** reveal/hide must not shift React gameplay controls
  (host overlays; does not reflow the arena).
- **Memory/CPU observation:** required in B6D3D on a device matrix (desktop
  Chrome/Edge, Android Chrome, iOS Safari); artifact is ≈10.7 MB (B6D2B).
- **Reduced-motion / accessibility:** respect `prefers-reduced-motion`; keep the
  existing `role="status"`/`aria-live` fail-open card (`MatchRenderer3D.tsx:508-526`);
  ensure focus and keyboard ownership stay with the visible (React or Unity)
  layer; a hidden layer must be `inert`/not focusable.

No claim is made that current player-facing performance has been measured (it has
not).

---

## 17. Proposed future changed-file list

**[Proposed B6D3B] — classification only; no authorization implied.**

| File | Class | Reason |
|---|---|---|
| `apps/web/src/components/match/UnityPresentationHost.tsx` (new) | **likely new** | isolated lifecycle/fail-open host that composes the renderer |
| `apps/web/src/components/match/UnityPresentationHost.test.ts(x)` (new) | **likely new** | host lifecycle/fallback unit/component tests |
| `apps/web/src/components/match/MatchRoomPanel.tsx` | **minimal modification** | additive mount-point swap + player-facing gate wiring at `:4043-4051` **only**; no timer/reveal/score/socket/reconnect change |
| `apps/web/src/app/api/unity-cohort/me/route.ts` (new) | **likely new** | server-only cohort boolean (mirrors `/api/admin/me`) |
| `apps/web/package.json` | **minimal modification** | register host test in `test:unity-presentation` (no dependency/lockfile change) |
| `apps/web/src/components/match/unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts` | **inspect only** | consumed as-is; not modified |
| `apps/web/src/components/match/unityPresentationProtocol.ts`, `unityPresentationAdapter.ts`, `unityPresentationShadow.ts` | **inspect only** | reused unchanged |
| `apps/web/src/components/match/MatchRenderer3D.tsx` | **inspect only** | stable transport/fail-open boundary; not modified (§7.2) |
| `apps/web/src/app/dev/unity-staging/**` | **inspect only / prohibited to edit** | reference pattern only |
| middleware / other server-auth files | **inspect only** | reference; no new middleware recommended (Option A) |
| `apps/realtime-server/**`, `packages/shared/**` | **prohibited** | server/shared untouched |
| Unity C# (`*.cs`), scenes, prefabs, assets, `ProjectSettings.asset` | **prohibited** | consumption already done (B6D2B); no Unity change |
| env/config, `.github/**`, Vercel/Railway, lockfiles, generated WebGL, `audit-artifacts/**` | **prohibited** | no config/artifact change |

Listing a file grants **no** implementation authorization.

---

## 18. Risk register

Likelihood × impact; current mitigation (**[Verified]**) vs proposed
(**[Proposed B6D3B]**); evidence needed; phase that must clear it; blocking status.

| # | Risk | Lk | Impact | Current mitigation | Proposed mitigation | Evidence | Clears in | Blocking |
|---|---|---|---|---|---|---|---|---|
| 1 | React remount/state loss | Low | Critical | React is primary today; shadow additive (`:4025`) | Host hides (never unmounts) React; additive mount swap only | host unit tests | B6D3B | Yes for B6D3B |
| 2 | Duplicate socket listeners | Low | High | Single subscription in panel; renderer opens none | Host adds no subscription (composition only) | code review + test | B6D3B | Yes |
| 3 | Duplicate timers | Low | High | Timers owned by panel; renderer timeout is presentation-only | Host adds no gameplay timer | test | B6D3B | Yes |
| 4 | Reveal timing divergence | Med | High | React owns reveal; Unity presentation-only | Correlation rule: scoreboard only on `match_state_sync` | correlation tests (exist) | B6D3B/C | Managed |
| 5 | Unity steals input | Med | High | Loading overlay `pointer-events-none` (`:543`) | `inert`/pointer discipline on hidden layer | input tests | B6D3B | Yes |
| 6 | Unity visible before authoritative bootstrap | Med | High | Coordinator requires complete `match_state_sync` first | Host stays `REACT_ONLY` until ready+bootstrap | lifecycle tests | B6D3B/C | Managed |
| 7 | Stale result animation after reset | Med | High | `replacePending`/queue reset; no history replay | Host resets on instance/reload | tests | B6D3B/C | Managed |
| 8 | Old-instance messages cross rematch boundary | Med | High | `matchInstanceId` gates (adapter, coordinator, correlation) | Host reuses `activeMatchInstanceId` reset | tests | B6D3B/C | Managed |
| 9 | Identity reversal (SELF/OPPONENT) | Low | High | Deterministic key-match in `buildViewerIdentityContext` | Consume context verbatim | identity tests (exist) | B6D3B | Managed |
| 10 | Raw-id / PII leakage | Low | Critical | Sanitizer + id-free audit; B6D3A tests | Host consumes sanitized output only; never forward legacy `winnerId` | leakage tests | B6D3B | Yes |
| 11 | Client-selectable cohort bypass | Med | High | Staging route server-gate pattern exists | Server route boolean (Option A); public flag insufficient alone | server-gate test | B6D3B | Yes |
| 12 | Production accidental activation | Low | Critical | `VERCEL_ENV` production `notFound()` pattern | Separate flag + cohort + `VERCEL_ENV` block | 200/404 capture | every subphase | Managed |
| 13 | iframe origin mismatch | Low | Critical | strict `origin`+`source` checks (`:374-375`) | Keep checks; CSP/sandbox review | origin tests | B6D3B | Managed |
| 14 | Readiness deadlock | Low | High | 15 s timeout → fail open | Host honours timeout | timeout test | B6D3B | Managed |
| 15 | Fallback flicker | Med | Med | — | React pre-mounted/hidden; single-frame swap | visual/latency check | B6D3C | Non-blocking B6D3B |
| 16 | Hidden Unity resource usage | Med | Med | shadow off by default | Perf budget; unmount on fatal | mem/CPU capture | B6D3D | Non-blocking B6D3B |
| 17 | Mobile performance | High | Med | React default | Perf budget as gate | device matrix | B6D3D | Non-blocking B6D3B |
| 18 | Accessibility regression | Med | Med | `role/aria-live` card exists | reduced-motion, focus/inert rules | a11y checks | B6D3B/C | Managed |
| 19 | Artifact reproducibility | Known | Med | immutable versioned artifacts; redeploy-known-good | unchanged | — | B6D3E | **BLOCKED** (non-blocking for B6D3B) |
| 20 | `MatchRoomPanel` regression | Med | Critical | additive-only history | smallest additive mount swap; line-by-line review | full match test matrix | B6D3B/D | Managed |

---

## 19. Authorization gates

**Before B6D3B implementation authorization:** this planning PR reviewed and
merged; exact implementation file scope approved (§17); host lifecycle design
approved (§8); player-facing flag design approved (§11); server cohort design
approved (§12); fail-open and test plan approved (§9, §15); no unresolved
critical risk (§18).

**Before B6D3C:** B6D3B implementation merged; all automated checks pass (226+
tests, `tsc`, `next build`, realtime build); protected preview available;
deterministic mock proof procedure approved; **no real match**.

**Before B6D3D:** B6D3C proof passes; **separate explicit real-match
authorization**; controlled internal free-play accounts only; test script and
rollback approved; **production remains blocked**.

Standing gates (every subphase): B6D2B/B6D3A remain merged and stable; master CI
green; production Unity off; free-play-only policy unchanged; no local generated-
artifact contamination; `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` UNCONFIGURED.

---

## 20. Remaining blockers

1. **Player-facing flag not yet designed-and-accepted** (§11) — blocks B6D3B.
2. **Server-side cohort gate not yet designed-and-accepted; requires a NEW server
   route handler** because the match route is a client component with no server
   gate and no middleware (§12) — blocks B6D3B.
3. **Fail-open host lifecycle not yet accepted** (§8–§9) — blocks B6D3B.
4. **`MatchRoomPanel` mount-point edit is unavoidable and HIGHEST sensitivity**
   (§7.1, §17) — must be pre-approved as minimal/additive — blocks B6D3B.
5. **No controlled real-match evidence** for the player-facing path — blocks
   B6D3D only (not B6D3B).
6. **Artifact reproducibility BLOCKED** — blocks B6D3E only.
7. **Local dev cohort caveat:** no `SUPABASE_SERVICE_ROLE_KEY` locally ⇒ Option A
   treats sessions as not-in-cohort (React only) — a design note, not a blocker.

---

## 21. Final recommendation

**GO WITH CONDITIONS** — recommend proceeding to a *separately-authorized* B6D3B
implementation of an isolated React lifecycle / fail-open host, **conditioned on**
resolving blockers 1–4 in §20 (accepted player-facing flag design, accepted
server-side cohort design incl. the new route handler, accepted fail-open host
lifecycle, and pre-approval of the minimal additive `MatchRoomPanel` mount-point
edit), with **no real match, no flag configuration, non-production only, mock-
driven, and React kept mounted and authoritative throughout**.

The recommended seam is a **new `UnityPresentationHost` wrapper (Option 1)** that
composes the existing, already-fail-open `MatchRenderer3D` and consumes the
already-produced FIFO props; `MatchRenderer3D.tsx` needs **no change**;
`MatchRoomPanel.tsx` needs a **minimal, additive mount-point change only**.
Protocol v1 stays unchanged; identity/correlation are consumed inside React only;
display labels are not shipped to Unity in B6D3B.

This document authorizes **no** implementation. B6D3B implementation remains
**NOT AUTHORIZED**; B6D3C and B6D3D remain **NOT AUTHORIZED**; production remains
**NO-GO**.

---

## 22. Final authorization status

```
B6D3A IMPLEMENTATION: COMPLETE AND LOCKED
B6D3B PLANNING REVIEW: COMPLETE / IN REVIEW
B6D3B IMPLEMENTATION: NOT AUTHORIZED
B6D3C PROTECTED-PREVIEW PROOF: NOT AUTHORIZED
B6D3D REAL-MATCH UNITY TESTING: NOT AUTHORIZED
PLAYER-FACING UNITY: NOT AUTHORIZED
PRODUCTION UNITY: NO-GO
NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED: UNCONFIGURED
```

This review changed no runtime code, no test, no Protocol v1 wire shape, no
feature flag, no environment, no server, and no Unity file; it ran no Unity, no
real match, and no deployment. `MatchRoomPanel.tsx`, `MatchRenderer3D.tsx`, and
`unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` were untouched.
