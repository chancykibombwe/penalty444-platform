# B6D3B — ISOLATED REACT LIFECYCLE HOST: SCOPE AND RISK REVIEW

> **Status: PLANNING / STATIC REPOSITORY REVIEW ONLY.** This document authorizes
> no code, no test, no CI, no feature flag, no cohort gate, no environment
> variable, no Protocol v1 change, no Unity activation, no real match, and no
> deployment. It does not modify `MatchRoomPanel.tsx`, `MatchRenderer3D.tsx`, any
> runtime/test/server/Unity file, or `ProjectSettings.asset`. It defines the
> smallest safe implementation boundary, the exact integration seams, a proposed
> lifecycle host, fail-open contract, a **two-layer** flag/cohort design, phase
> split, tests, risks, and gates for a *possible, separately-authorized* B6D3B
> step — and asks for a single GO / GO-WITH-CONDITIONS / HOLD decision in §21.
>
> **This revision (hardening pass)** corrects five design points versus the first
> draft: (1) the cohort **boolean is convenience-only, not an enforcement
> boundary** — enforcement is a server-verified capability/session protecting the
> Unity entry route *and* the artifact; (2) Unity may overlay **only the cinematic
> visual arena viewport**, never the React lane controls / timer / scoreboard, and
> the current arena subtree **intermixes** visuals with controls so a mount-swap at
> lines 4043–4051 is **not** sufficient; (3) the full sanitized B6D3A
> identity/correlation dataflow is specified with a hard host boundary; (4)
> production denial and iframe input isolation are made explicit; (5) the risk
> register, gates, and file scope are updated accordingly.

Evidence labels: **[Verified]** (exists at the baseline SHA; cited by file/line),
**[Contract]** (stated in a merged design doc at the baseline SHA),
**[Proposed B6D3B]** (future, separately-authorized design; not built here),
**[Recommendation]**. No payload field, event, flag, or file is invented.

---

## 1. Executive decision

**[Recommendation] GO WITH CONDITIONS** for a *separately-authorized* B6D3B
implementation of an **isolated React lifecycle / fail-open presentation host**,
default-off, non-production, mock-driven only, with **no real match**.

Why the repository is favourable **[Verified]**: the whole React→Unity
presentation stack already exists and is default-off (`unityPresentationProtocol.ts`,
`unityPresentationAdapter.ts`, `unityPresentationShadow.ts`, the fail-open
`MatchRenderer3D.tsx`), plus the merged, tested-but-unwired B6D3A contracts
(`unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts`, 226/226).
Unity is never player-facing today; it is a shadow in a *secondary* panel that
never replaces React controls (`MatchRoomPanel.tsx:4025-4100`).

Why it is **conditional** (design blockers, not defects), corrected in this
revision:

1. **Cohort enforcement.** A client-consumed boolean is **not** a security
   boundary. Enforcement must be a **server-verified capability/session** that
   protects the player-facing Unity **entry route and artifact**; the boolean is
   convenience UI only (§12).
2. **Visual viewport only.** Unity may overlay only the **cinematic arena
   viewport**. The current arena `<section>` (`MatchRoomPanel.tsx:3745-3877`)
   **intermixes** the cinematic pitch visuals with the **interactive lane-button
   grid** (`:3837-3874`); the scoreboard is a separate node (`:3449-3464`).
   Therefore a mount swap at `:4043-4051` is **insufficient** — a bounded
   extraction of the cinematic subtree into a relative wrapper is required (§7).
3. **Sanitized identity boundary.** Raw ids may live only inside React;
   `UnityPresentationHost` must receive only the sanitized `ViewerIdentityContext`
   / `CorrelationSummary` (§10).
4. **Server production hard-block + iframe input isolation** must be accepted (§11,
   §13).

`MatchRoomPanel` is **HIGHEST sensitivity**; any edit is minimal, additive,
lifecycle-safe, and line-by-line reviewed. B6D3B/B6D3C/B6D3D remain **NOT
AUTHORIZED**; production remains **NO-GO**.

---

## 2. Scope and non-goals

### In scope (this document)

Static, repository-grounded review of the exact integration seams; a *design*
(not an implementation) for the isolated host, its fail-open contract, the
player-facing flag, the **two-layer** cohort enforcement, the visual-viewport
boundary, and the sanitized identity dataflow; the B6D3B/C/D boundary, test
matrix, risk register, and gates. Exactly one new document (this file) plus a
minimal status/link note in the main planning doc.

### Non-goals (not done, not authorized here)

React implementation; Unity mounting changes; runtime integration; feature-flag
creation/configuration; environment changes; cohort-gate/capability/route
implementation; server/route/middleware changes; preview-route changes; Unity C#
changes; WebGL rebuilds; real-match testing; deployment; production activation;
any change to `MatchRoomPanel.tsx`, `MatchRenderer3D.tsx`, any TS runtime/test
file, `package.json`/lockfiles, `apps/web/src/app/dev/unity-staging/**`,
`next.config.ts`, `apps/realtime-server/**`, `packages/shared/**`, Unity assets/
scenes/prefabs/`ProjectSettings`, `.github/**`, middleware, route handlers,
Supabase, Vercel/Railway config, env files, generated WebGL output, or
`audit-artifacts/**`.

---

## 3. Exact baseline SHA

- **Repository:** `chancykibombwe/penalty444-platform`; protected branch `master`.
- **`origin/master`:** `092f4fc126398c00cf435674a6210663ff0d4d91` (PR #212, B6D3A
  merged).
- **Review branch:** `docs/unity-b6d3b-host-scope-risk-review`, worked in a
  **separate clean worktree** (`C:\Users\EL GADO\Desktop\penalty444-b6d3b-review`).
- **ProjectSettings:** the remote PR contains **no** `ProjectSettings.asset`
  change; the clean review worktree **did not touch** `ProjectSettings`; the main
  Windows checkout's pre-existing `ProjectSettings.asset` modification remains
  **untouched** (no stash/reset/restore/clean/skip-worktree/assume-unchanged).

---

## 4. Repository-verified current architecture

### 4.1 Runtime map — all **[Verified]**

1. **Authority — Node.js / Socket.IO.** Server decides every outcome/score/phase/
   winner/timer/sudden-death (`apps/realtime-server/`). Scores are **not** atomic
   with `match:result`: `room.scores` increments **before** `match:result` (which
   carries **no** scores); the authoritative scoreboard arrives on a later
   `match:update` (`unityPresentationCorrelation.ts:6-9`; B6D3 scope §6).
2. **React state — `MatchRoomPanel.tsx`** (≈4135 lines). Owns the single
   Socket.IO subscription, match state machine, timers, reveal pacing, scores,
   phase, `matchInstance`, reconnect, rematch. **HIGHEST sensitivity.**
3. **Adapter — `unityPresentationAdapter.ts`.** Pure, field-by-field mapping to
   Protocol v1; `round_result` never carries scores; returns `null` on malformed
   input; never spreads raw payloads.
4. **Protocol v1 — `unityPresentationProtocol.ts`.** `PENALTY444_MATCH_EVENT`,
   version 1, events `round_result|match_state_sync` (`:23-26`);
   `validateEnvelope`, `sanitizeScores`, `deriveMatchInstanceId` (`:305-317`),
   `PresentationSequenceEmitter` (`:326-346`), `PresentationSequenceGate`
   (`:359-405`).
5. **Coordinator + queue — `unityPresentationShadow.ts`.** Owns instance/sequence/
   last-snapshot; commits atomically only after a successful build (`:181-302`);
   FIFO queue (dedup + cap 32, `:324-369`); id-free audit (`:70-96`); pure
   pending-buffer helpers (`:447-499`).
6. **Renderer — `MatchRenderer3D.tsx`.** Passive iframe shell. Reads only
   `NEXT_PUBLIC_UNITY_MATCH_ENABLED` (`:249`) + `NEXT_PUBLIC_UNITY_BUILD_URL`
   (`:250`). Strict `event.origin===location.origin` **and**
   `event.source===iframe.contentWindow` (`:374-375`); outbound `postMessage`
   always same-origin, never `"*"` (`:332`, `:355`); inbound allowlist
   `ready|animation_complete|error` (`:132-164`); `UNITY_READY_TIMEOUT_MS=15_000`
   (`:187`); `markUnavailable` fails open (`:294-309`, `:506-526`); FIFO mode with
   `activeMatchInstanceId` reset (`:425-457`); loading overlay is
   `pointer-events-none` (`:543`).
7. **Ack/failure.** Unity emits only `ready/animation_complete/error`; any error/
   load-failure/timeout → `markUnavailable`. Unity-side acks carry numeric score
   **values** only (B6D2B).
8. **Fallback.** React is always the authoritative renderer; the shadow is an
   additive secondary panel (`:4025-4100`).

### 4.2 Current render subtree (exact JSX boundaries) — **[Verified]**

Within the main panel container, in order:

- **Scoreboard** — a standalone `<div className="shrink-0">` wrapping
  `<MatchScoreboard …/>` at **`:3449-3464`** (names, scores, roles, turn counter).
- **Sudden-death banner** — `<section>` **`:3434-3447`**.
- **Match-end / outcome / rematch / leave controls** — `<section>` **`:3466-3743`**.
- **Play/arena `<section>`** (`!matchEnded`) **`:3745-3877`** — **intermixes**
  cinematic pitch-lane dividers (`:3748`), the pick-locked overlay (`:3749-3765`),
  the pick-status headers, **and the interactive lane-button grid `:3837-3874`**
  (`onClick={() => pick(lane)}`).
- **Result/reveal cinematic `<section>`** (`!matchEnded`) **`:3879-4007`** — the
  result headline, reveal/tension countdown, and kicker/keeper result cards
  (largely presentation).
- **Unity shadow secondary section** **`:4025-4100`**, with the renderer mounted at
  **`:4043-4051`**.

**Consequence:** there is **no cleanly isolated cinematic-viewport node today**.
The lane controls live inside the same `<section>` as the arena visuals, so Unity
cannot overlay "the arena" without covering the controls unless the cinematic
subtree is first extracted (§7).

### 4.3 Ownership — **[Verified]**

| Value | Owner |
|---|---|
| Outcome/score/phase/winner/sudden-death | Node realtime server |
| Socket subscription, timers, reveal, `matchInstance`, reconnect/rematch, `pick()` | `MatchRoomPanel.tsx` |
| Protocol instance id + sequence | `UnityPresentationShadowCoordinator` |
| Pending buffer / active-instance mirror | `MatchRoomPanel` state (`:901-908`) |
| Readiness, iframe lifecycle, fail-open | `MatchRenderer3D.tsx` |
| Identity/visual-side & correlation (contract) | `unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts` (**not wired**) |

### 4.4 Is React always beneath Unity today, and can the shadow be promoted? — **[Verified]** Yes / No.

React is always the primary renderer; Unity mounts only in the additive secondary
panel (`:4025`), which "never obscures or replaces lane controls, scoreboard,
timer, reveal, disconnect, or match-end UI" (`:4018-4024`). No current flag or
code path promotes the shadow to a visible/primary renderer; promotion needs
**new** code — the B6D3B work under review.

---

## 5. Current Unity flags and activation path

Three build-time **public** flags, all required, all default-off/unconfigured
(**[Verified]**): `NEXT_PUBLIC_UNITY_MATCH_ENABLED` (`MatchRenderer3D.tsx:249`;
`MatchRoomPanel.tsx:861`), `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED` (`:860-862`),
`NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` (`:889-891`).

The staging route (`app/dev/unity-staging/page.tsx`) is gated by **server-only**
vars `UNITY_STAGING_ROUTE_ENABLED` + `UNITY_STAGING_ARTIFACT_ORIGIN` and returns
`notFound()` when `VERCEL_ENV === "production"` (`:39-49`). **Important
[Verified]:** the staging *artifact* itself is served by an **unauthenticated
Next.js rewrite** `/unity/penalty444/staging/:path* → ${ARTIFACT_ORIGIN}/:path*`
(`next.config.ts:229-235`). A rewrite performs **no per-request auth**, so a raw
artifact URL is directly fetchable by anyone who knows it — acceptable for staging
(server-gated *route*, `notFound()` in production, not `NEXT_PUBLIC`), but **not an
enforcement boundary** for a player-facing cohort. This directly shapes §12.

**Proof the flags are shadow-oriented:** even all-`"true"`, Unity renders only in
the additive secondary panel; nothing swaps React out. The existing flags are, by
construction, **insufficient** to make Unity player-facing.
`NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` remains **UNCONFIGURED**.

---

## 6. Integration-seam comparison

Goal: the narrowest seam that overlays Unity on **only the cinematic arena
viewport** while React lane controls, timer, scoreboard, disconnect/reconnect,
and match-end/rematch controls stay mounted, visible, interactive, and
authoritative — without moving gameplay state, adding a socket subscription, or
duplicating timers/reveal.

| # | Option | Files changed | Timers/socket | Fallback | Testability | Recommendation |
|---|---|---|---|---|---|---|
| 1 | **`UnityPresentationHost` wrapper layered inside an extracted cinematic-viewport subtree** | new host + host tests; **bounded extraction inside** `MatchRoomPanel` (§7) | none new (composition) | reuse `markUnavailable`; host toggles visible↔hidden on the *viewport only* | High | **Recommended** |
| 2 | Sibling component mounted by the match page | match page (client) + host | needs re-sourced match state | weaker | Medium | Not recommended |
| 3 | Mount-swap only at `:4043-4051` | `MatchRoomPanel` | none new | — | — | **Rejected** — that node is the secondary shadow panel, not the arena viewport; it cannot make Unity the arena without covering lane controls |
| 4 | Extend `MatchRenderer3D` to own visibility | renderer (security boundary) | none new | same | Lower | Not recommended — keep renderer a pure transport/fail-open shell |

**Explicit correction:** changing only the shadow mount at `:4043-4051` is **not
sufficient** for a player-facing viewport, because (a) that node is the additive
*shadow* panel below the arena, and (b) the real arena visuals and the interactive
lane grid share one `<section>` (`:3745-3877`). Option 1 requires a **bounded
relative wrapper around the cinematic/arena presentation subtree**, with the lane
grid, scoreboard, and timer kept **outside/above** that wrapper.

---

## 7. Recommended isolated host boundary and visual viewport

**[Recommendation]** Implement B6D3B as `UnityPresentationHost` that **composes**
`MatchRenderer3D` (does not edit it) and consumes the already-produced FIFO props
(`messages`, `activeMatchInstanceId`, `onReady`, `onError`, `onMessageSent`). It
owns **only presentation-lifecycle + viewport-visibility** state — never match
state, socket, gameplay timer, reveal logic, or scoreboard.

### 7.1 Visual viewport boundary (Correction 2)

- Unity may **replace or overlay only the cinematic visual arena viewport**.
- **React remains mounted and authoritative**, with all of the following **outside
  or above** the Unity overlay and always visible + interactive: **lane controls**
  (`:3837-3874`), **timer**, **scoreboard** (`:3449-3464`), **disconnect/reconnect
  state** (pick-locked/abort-countdown UI), **match-end/rematch/leave controls**
  (`:3466-3743`), and **accessibility output** (`aria-live` regions).
- **Unity receives no gameplay input**; the iframe receives **no pointer or
  keyboard input** during B6D3B (§13).
- **Fail-open restores only the React visual viewport**; no gameplay state, timer,
  socket listener, control, or scoreboard is remounted.

### 7.2 Exact subtree that must later be wrapped/extracted — **[Verified] boundary**

The **cinematic/visual presentation subtree** must be separated from the
interactive controls before Unity can overlay it. Concretely, a future B6D3B
would introduce a **relative wrapper** around the arena's *visual* region and host
`UnityPresentationHost` inside it, while **lifting the lane-button grid out of the
overlaid region**:

- The visual region to wrap: the cinematic content of the play `<section>`
  (`:3745-3877`) — pitch-lane dividers (`:3748`), pick-locked/disconnect overlay
  (`:3749-3765`), and the reveal/result cinematic (`:3879-4007`).
- The controls to keep **outside/above** the wrapper: the **lane-button grid**
  (`:3837-3874`), the **scoreboard** node (`:3449-3464`), and the **timer**.
- Because the lane grid currently sits *inside* the same `<section>` as the arena
  visuals, this is a **bounded structural extraction** (move the visual subtree
  into a `relative` wrapper; keep/relocate the lane grid as a sibling outside the
  overlay), **not** a mount swap. It must not change `pick()`, timers, reveal, the
  socket handler, scores, or reconnect logic.

### 7.3 Does `MatchRoomPanel.tsx` change? — **[Recommendation] Yes, minimally but structurally.**

Unlike the first draft's "mount-point swap", the correct minimal change is a
**bounded relative wrapper + cinematic-subtree extraction** at the arena region
(§7.2) plus the player-facing gate. This is larger than a one-line swap and is
**HIGHEST sensitivity**; it must be additive/lifecycle-safe and reviewed
line-by-line. No timer/reveal/score/socket/reconnect logic may change.

### 7.4 Does `MatchRenderer3D.tsx` change? — **[Recommendation] No, if isolation holds.**

Keep the renderer as a stable transport/fail-open boundary. It changes **only if**
the host cannot reliably enforce iframe pointer/focus/`inert` isolation from
outside (§13); in that case a minimal security-prop change is added to the future
file scope. Visibility remains a host concern.

---

## 8. Proposed lifecycle state machine

**[Proposed B6D3B]** Host-owned, presentation + viewport-visibility only:

- `DISABLED` — gate off / cohort capability absent → host renders nothing extra;
  React arena visible.
- `REACT_ONLY` — gated on, Unity not yet visible (pre-ready / intentionally
  hidden); React arena visible + authoritative.
- `UNITY_LOADING` — iframe mounted, awaiting `ready` (bounded by the 15 s
  timeout).
- `UNITY_READY_VISIBLE` — `ready` received; Unity revealed **over the cinematic
  viewport only**; React arena visual hidden (mounted) beneath; **controls/timer/
  scoreboard remain visible**.
- `UNITY_FAILED_REACT_FALLBACK` — any failure; Unity hidden/unmounted; React
  arena visual restored; terminal for the current instance.

Rules: keep React mounted always; **hide, never unmount** the React arena visual;
never hide controls/timer/scoreboard; prevent hidden/failed-iframe input (§13);
reset on new `matchInstanceId` (reuse `activeMatchInstanceId`,
`MatchRenderer3D.tsx:425-431`); iframe reload = fresh ready lifecycle; discard
pre-ready/old-instance pending (`replacePending`, `fifoQueueRef.reset()`);
permanent fail-open per instance after a fatal error (mirror `markUnavailable`
idempotency, `:296-297`, `:382`). Not implemented here.

---

## 9. Fail-open and fallback contract

**[Proposed B6D3B]** Fail-open needs **no server intervention** and never
interrupts gameplay; it restores **only the React visual viewport**.

| Failure | Unity | React controls/timer/scoreboard | Match continues? | Retry? | Sanitized telemetry | Never log |
|---|---|---|---|---|---|---|
| iframe load failure | unmount | stay visible/interactive | Yes | new instance/reload | reason, counter | payloads/ids |
| readiness timeout (15 s) | unmount | visible | Yes | new lifecycle | reason, elapsed bucket | ids/tokens |
| malformed ack | ignored | visible | Yes | n/a | event name | raw ack |
| rejected/foreign/stale/duplicate | not applied | visible | Yes | n/a | reject reason (enum) | ids/scores-by-id |
| sequence/instance rejection | not applied | visible | Yes | n/a | instance id + reason | player ids |
| postMessage exception | fail open | visible | Yes | new lifecycle | reason | error w/ payload |
| Unity runtime `error` | fail open | visible | Yes | new lifecycle | "unity_error" | Unity raw message |
| iframe reload | fresh lifecycle | visible | Yes | yes (bootstrap) | "reload" | history |
| navigation/unmount | teardown | visible until nav | Yes | n/a | none | — |
| rematch/new instance | reset+bootstrap | visible | Yes | yes | new instance id | old-instance data |
| missing/unavailable artifact | placeholder/unmount | visible | Yes | n/a | "artifact_missing" | origin secrets |
| cohort/capability revoked/expired | hide Unity → React | visible | Yes | n/a | "revoked" | cohort/capability contents |

All reuse existing tested mechanisms; the host adds only the *viewport visible↔
hidden* decision. Telemetry is identity-free (values/counts, mirroring
`buildAuditSummary`, `unityPresentationShadow.ts:70-96`).

---

## 10. B6D3A identity / correlation consumption (complete dataflow)

**[Contract; Verified]** Modules: `buildViewerIdentityContext`
(`unityPresentationIdentity.ts:196-290`) and `correlateResultToStateSync`
(`unityPresentationCorrelation.ts:110-168`). **These modules are not modified by
B6D3B.**

### 10.1 Identity flow (Correction 3)

- **Raw authoritative ids may exist only inside `MatchRoomPanel` (or another
  trusted React-side adapter/hook).** There, a pure builder calls
  `buildViewerIdentityContext({ matchInstanceId, viewerPlayerId, scores,
  kickerPlayerId?, keeperPlayerId?, winnerPlayerId?, isDraw?, displayNames? })`.
- The output `ViewerIdentityContext` is **sanitized**: viewer-relative
  `SELF/OPPONENT`, visual side `SELF→LEFT` / `OPPONENT→RIGHT` (`:255-263`),
  verbatim score projection (no arithmetic), optional all-or-nothing
  `KICKER/KEEPER` role (`:218-234`), optional authoritative outcome (never derived
  from scores, `:236-252`), optional bounded label with raw-id-containment defence
  (`:111-167`, `:270-278`).
- **Only the sanitized context may cross into `UnityPresentationHost`.** The host
  must **never** receive: `viewerPlayerId`, raw score-map keys, `kickerPlayerId`,
  `keeperPlayerId`, `winnerPlayerId`, email, auth/session/token data, socket data,
  or wallet/economy data.
- Guard: the legacy `getUnityMatchEndPresentation` returns a `winnerId` that **is**
  a raw score-map key (`MatchRoomPanel.tsx:278-301`); it is legacy-shadow-only and
  must **never** feed the player-facing path.

### 10.2 Correlation flow (Correction 3)

- **Store the last accepted sanitized `round_result`.**
- On the later authoritative `match_state_sync`, evaluate
  `correlateResultToStateSync(result, stateSync)`.
- **Accept** equal-round terminal correlation (`round delta 0`) and exactly-next-
  round continuation (`delta 1`); **reject** stale/duplicate
  (`sequence ≤ result.sequence`), foreign-instance (different `matchInstanceId`),
  and invalid-round-order (`unityPresentationCorrelation.ts:131-149`).
- **Reset** correlation on a new `matchInstanceId`.
- **Only `match_state_sync` is score-bearing** (`isScoreBearingEvent`,
  `:73-75`).

### 10.3 Visible scoreboard decision (Correction 3)

- **Keep the existing React scoreboard, timer, and controls visible and
  authoritative** (`MatchScoreboard`, `MatchRoomPanel.tsx:3449-3464`).
- **Unity renders only the cinematic visual arena.**
- **Update the visible scoreboard only from authoritative React match state or the
  accepted `match_state_sync` — never from the `round_result` event.**
- **Do not send display labels or identity fields to Unity.**
- **Do not create a Unity-owned scoreboard in B6D3B.**
- Any viewer-relative HTML overlay stays **React-owned** and receives only the
  sanitized `ViewerIdentityContext`.

### 10.4 Recommended approach

**Keep Protocol v1 unchanged; consume identity/correlation only inside React; do
not ship display labels to Unity in B6D3B.** Lowest risk: no wire-shape change, no
version bump, the sanitizer stays the single choke point, and any additive
presentation contract is deferred to a separately authorized protocol phase only
if a real need appears.

---

## 11. Separate player-facing flag design

**[Proposed B6D3B] — designed, not created.**

- **Proposed flag:** `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED` (build-time public,
  default-off). **This is a build/UX gate only — not a production security
  boundary** (Correction 4).
- **Why the three existing flags are insufficient:** they only feed a shadow into
  an additive panel (§4.4); none swaps React out.
- **Required combination:** player-facing mode requires all three existing flags
  **AND** the new flag **AND** a valid **server capability/session** (§12) **AND**
  `VERCEL_ENV !== "production"`. The public flag is necessary, never sufficient.
- **Single disable → React for everyone:** turning off the new flag (or any shadow
  flag) instantly reverts every session to React.
- **Client-side checks are not the boundary:** browser state, public flags,
  JavaScript, query params, localStorage, and intercepted fetch responses are
  untrusted; none may make the protected Unity resource load. Production denial and
  cohort enforcement happen **server-side** (§12, §13).

No flag is created, configured, or enabled here.

---

## 12. Server-side cohort design (two-layer enforcement)

**[Proposed B6D3B] — designed, not implemented.** The cohort must be
**impossible to self-select from browser JavaScript**. This revision splits the
design into a **convenience status layer** and an **actual enforcement layer**
(Correction 1).

**Repository facts [Verified].** The match route is a **client component**
(`app/match/[roomCode]/page.tsx:1-16`, `"use client"` + client `RequireAuth`);
there is **no middleware** in `apps/web`; the staging artifact is served by an
**unauthenticated rewrite** (`next.config.ts:229-235`). A proven server-only
allowlist pattern exists: `/api/admin/*` verifies the JWT via
`admin.auth.getUser(token)` and returns **only a boolean**, never the list
(`app/api/admin/me/route.ts:7-67`).

### A. Convenience status endpoint (NOT the boundary)

- May return `{ inCohort: boolean }` for normal UI flow only.
- `false`, error, or unavailable ⇒ **React-only**.
- **Explicitly not an enforcement boundary.** Client state, fetch responses,
  localStorage, and query params are **untrusted**; tampering with this boolean
  must not grant Unity.

### B. Actual enforcement boundary (server-verified capability/session)

- Server verifies the **authenticated user** against a **server-only allowlist**.
- Server **issues/validates a short-lived signed capability** or **HttpOnly cohort
  session** (not readable/forgeable by client JS).
- The **player-facing Unity entry route** and the **artifact/manifest resource**
  are protected **server-side** by that capability/session; unauthorized access
  returns **404 / equivalent denial**.
- **Production always denies server-side** via `VERCEL_ENV === "production"`.
- **No client-side change** (browser state, public flags, JS, query params,
  intercepted responses) can make the protected Unity resource load.
- **Revocation:** remove the user from the allowlist, expire the capability, or
  rotate the signing secret.

### Options evaluated

| Option | Trust boundary | Bypass risk | Local dev | Preview | Production | Revocation |
|---|---|---|---|---|---|---|
| Status route only (A) | none (UI hint) | high if trusted | ok | ok | must still deny in B | — |
| **A + signed short-lived capability / HttpOnly cohort cookie (B)** | server mint+verify; httpOnly/signed | **low** | needs service-role (absent locally ⇒ deny) | protected preview | `VERCEL_ENV` deny | expire/rotate/allowlist |
| Convert match route to server component + gate | server pre-render | low | large refactor | ok | deny | allowlist/env |
| Middleware allowlist | edge/server pre-route | low | new infra | ok | deny | allowlist/env |

**Recommended [Recommendation]: A + B.** A convenience status route
(`/api/unity-cohort/status`) for UI, **plus** a server-verified capability/session
that protects (i) a **same-origin protected Unity entry route** and (ii) the
**artifact/manifest** behind the same server boundary. The unauthenticated
`next.config.ts` rewrite is **not** reused for the player-facing artifact; the
player-facing artifact is served/validated by a **route handler** that checks the
capability and returns `notFound()` on failure and in production. Degrades safely
locally (no `SUPABASE_SERVICE_ROLE_KEY` ⇒ deny ⇒ React-only, per root `AGENTS.md`).

### Likely future files (Correction 1) — **[Proposed B6D3B], not implemented**

- `apps/web/src/app/api/unity-cohort/status/route.ts` (new) — convenience
  `{ inCohort: boolean }` (mirrors `/api/admin/me`; NOT the boundary).
- `apps/web/src/lib/unity-cohort/capability.ts` (new) — sign/verify the short-lived
  capability (server-only secret).
- `apps/web/src/app/api/unity-cohort/session/route.ts` (new) — verify user +
  server-only allowlist; mint the signed HttpOnly cohort cookie / capability.
- `apps/web/src/app/unity-arena/[roomCode]/route.ts` (or protected page) (new) —
  **protected same-origin Unity entry** that validates the capability; `notFound()`
  on failure and in production.
- `apps/web/src/app/api/unity-arena/artifact/[...path]/route.ts` (new) —
  **protected artifact/manifest** access behind the same server boundary
  (supersedes the unauthenticated rewrite for the player-facing path).
- (Alternative, not recommended) `apps/web/middleware.ts` (new) — only if a
  middleware gate is preferred over route handlers.

No route, capability, secret, schema, RLS, middleware, or `next.config.ts` change
is created here.

---

## 13. Protocol, security and privacy boundaries

**Current protections [Verified].** Same-origin inbound (`origin`+`source`,
`MatchRenderer3D.tsx:374-375`); outbound same-origin only (`:332`, `:355`);
inbound allowlist (`:132-164`); sanitizing adapter/protocol (prototype-pollution
guard, finite non-negative integer scores, null-not-throw); id-free audit
(`unityPresentationShadow.ts:70-96`); iframe `allow="autoplay; fullscreen"`
(`:539`), **no `sandbox` set today**; staging route `notFound()` in production
(`app/dev/unity-staging/page.tsx:39-41`); staging artifact rewrite is
**unauthenticated** (`next.config.ts:229-235`).

**Production hard-block design [Proposed B6D3B] (Correction 4).**

- `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED` is a **build/UX gate only**;
  client-side checks are **not** a production security boundary.
- **Production denial occurs in the protected server route/resource** via
  `VERCEL_ENV === "production"` — the capability is never issued and the entry
  route/artifact return 404 in production. The server capability + protected
  resource are the enforcement boundary.

**Iframe input isolation [Proposed B6D3B] (Correction 4).**

- **Recommended rule:** keep `MatchRenderer3D` unchanged **only if**
  `UnityPresentationHost` can reliably apply `pointer-events: none`, focus
  exclusion, and `inert` to the iframe subtree so **Unity receives no pointer or
  keyboard input** and **React controls retain keyboard + pointer ownership**.
- **Future component tests must prove** the iframe cannot receive focus or pointer
  input.
- **Sandbox/CSP changes are a separately reviewed hardening decision** unless
  implementation inspection proves a renderer change is necessary.
- **If reliable isolation cannot be achieved by the host wrapper**, include a
  **minimal `MatchRenderer3D` security-prop change** in the future file scope
  (§17).

**Other proposed protections.** Route all player-facing identity through
`buildViewerIdentityContext`; never forward a raw score-map key; keep auth/session
isolation (host reads no token); exclude wallet/economy entirely; no Protocol v1
change and no new event in B6D3B.

---

## 14. B6D3B / B6D3C / B6D3D phase split

**[Proposed / Contract]**

- **B6D3B — isolated React lifecycle / fail-open host.** New host + player-facing
  flag design + **two-layer server cohort enforcement** design + fail-open logic +
  **cinematic-viewport extraction**; mock/deterministic events only, **no real
  match**, **no flag/capability configuration**; non-production; minimal additive
  `MatchRoomPanel` viewport-wrapper change (HIGHEST sensitivity); automated/unit/
  component tests. **Entry:** this review merged; all §19 items approved.
  **Exit:** host merged; 226+ tests green; new host/fallback/isolation/identity
  tests green; `tsc`+`next build`+realtime build green; no runtime activation.
- **B6D3C — protected-preview mock/runtime proof.** Deterministic mock Protocol v1
  on a protected (SSO) preview; verify lifecycle transitions, ordering, instance/
  reload/bootstrap, React fallback, and **controls-stay-visible**; **no real
  match**.
- **B6D3D — controlled two-user real-match staging proof.** **Separate explicit
  real-match authorization required**; internal free-play accounts only; server-
  gated capability; validate all rounds/sudden-death/timeout/disconnect/reconnect/
  rematch/abort/match-end/fallback; rollback (single disable → React) rehearsed;
  production NO-GO.

---

## 15. Test and evidence strategy

**[Proposed B6D3B]** Unit/component-level; no real match.

B6D3B (automated): host lifecycle transitions (§8); **React controls/timer/
scoreboard remain visible + interactive in every state incl. fail-open**;
readiness timeout / load failure / postMessage failure / Unity error → fallback
restores only the visual viewport; malformed/rejected/foreign/stale/duplicate
dropped; new-instance reset; rematch separation; flag disabled → `DISABLED`;
**cohort capability absent/invalid → React-only** (boolean tampering does not grant
Unity); **production `VERCEL_ENV` → protected resource denies**; **hidden/failed
iframe cannot receive pointer or keyboard focus**; **no raw-id/PII crosses into the
host** (assert host props are id-free); no socket/timer duplication; existing 226
Unity-presentation tests remain green; `tsc --noEmit`, `next build`, realtime
`build` regression guards.

B6D3C (runtime proof, not B6D3B): deterministic mock drive on a protected preview;
ordered/instance/reload/bootstrap/fallback + controls-visible evidence; identity-
free capture. Two-browser real-match evidence is **B6D3D only**. Server-capability
enforcement (unauthorized → 404; production → 404) is proven at the route level in
B6D3C/D.

The `test:unity-presentation` script runs 5 files = **226 tests**
(`apps/web/package.json:13`); new host tests would be registered there in B6D3B (a
script-only edit — out of scope here).

---

## 16. Performance, UX and accessibility bounds

**[Proposed B6D3B] — budgets for later subphases; not measured here.** Readiness
timeout reuses `15_000` ms (`MatchRenderer3D.tsx:187`). Fallback transition
instantaneous (React arena pre-mounted/hidden; no state refetch). Bounded iframe
remounts per instance; fatal error terminal. **React interaction availability
100%** — controls always usable. Layout-shift: revealing/hiding Unity must not
shift the lane controls/timer/scoreboard (host overlays the viewport only).
Memory/CPU on a device matrix in B6D3D (artifact ≈10.7 MB). Respect
`prefers-reduced-motion`; keep the `role="status"`/`aria-live` fail-open card
(`:508-526`); a hidden layer must be `inert`/not focusable; keyboard/focus
ownership stays with the visible React controls. No claim is made that
player-facing performance has been measured (it has not).

---

## 17. Proposed future changed-file list

**[Proposed B6D3B] — classification only; no authorization implied.**

| File | Class | Reason |
|---|---|---|
| `apps/web/src/components/match/UnityPresentationHost.tsx` (new) | **likely new** | isolated lifecycle/fail-open + viewport-visibility host; composes the renderer |
| `apps/web/src/components/match/UnityPresentationHost.test.ts(x)` (new) | **likely new** | lifecycle/fallback/isolation/controls-visible tests |
| `apps/web/src/components/match/useViewerPresentation.ts` (new, working name) | **likely new** | pure hook/helper: builds the sanitized `ViewerIdentityContext` + correlation view inside React and passes only sanitized data to the host |
| `apps/web/src/components/match/MatchRoomPanel.tsx` | **minimal modification** | bounded relative wrapper + cinematic-viewport extraction (§7.2) + player-facing gate; **no** timer/reveal/score/socket/reconnect change — HIGHEST sensitivity |
| `apps/web/src/app/api/unity-cohort/status/route.ts` (new) | **likely new** | convenience boolean (NOT the boundary) |
| `apps/web/src/lib/unity-cohort/capability.ts` (new) | **likely new** | sign/verify short-lived capability |
| `apps/web/src/app/api/unity-cohort/session/route.ts` (new) | **likely new** | verify user + allowlist; mint HttpOnly capability |
| `apps/web/src/app/unity-arena/[roomCode]/route.ts` (new) | **likely new** | protected same-origin Unity entry (capability-gated; prod 404) |
| `apps/web/src/app/api/unity-arena/artifact/[...path]/route.ts` (new) | **likely new** | protected artifact/manifest behind the server boundary |
| `apps/web/src/components/match/MatchRenderer3D.tsx` | **inspect only → conditional minimal modification** | keep unchanged if host-side pointer/focus/`inert` isolation is reliable; else a minimal security prop (§13) |
| `apps/web/src/components/match/unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts` | **inspect only** | consumed as-is; **not modified** |
| `unityPresentationProtocol.ts`, `unityPresentationAdapter.ts`, `unityPresentationShadow.ts` | **inspect only** | reused unchanged |
| `apps/web/src/app/dev/unity-staging/**`, `next.config.ts` | **inspect only / prohibited to edit** | staging pattern reference only; player-facing artifact must not reuse the unauthenticated rewrite |
| `middleware` | **inspect only** | not recommended (route handlers preferred) |
| `apps/realtime-server/**`, `packages/shared/**` | **prohibited** | untouched |
| Unity C#/scenes/prefabs/assets/`ProjectSettings.asset` | **prohibited** | no Unity change |
| env/config, `.github/**`, Vercel/Railway, lockfiles, generated WebGL, `audit-artifacts/**` | **prohibited** | no config/artifact change |

Listing a file grants **no** implementation authorization.

---

## 18. Risk register

Likelihood × impact; current mitigation (**[Verified]**) vs proposed
(**[Proposed B6D3B]**); evidence; phase that clears it; blocking status.

| # | Risk | Lk | Impact | Current mitigation | Proposed mitigation | Evidence | Clears in | Blocking |
|---|---|---|---|---|---|---|---|---|
| 1 | **Client tampering with the cohort boolean grants Unity** | Med | Critical | none (boolean not yet used) | boolean is convenience-only; enforcement via server capability/session (§12) | route test: tampered boolean → still denied | B6D3B design / B6D3C proof | **Yes** |
| 2 | **Direct access to an unprotected Unity artifact URL** | Med | Critical | staging rewrite is unauthenticated (`next.config.ts:229-235`) | player-facing artifact served behind capability-gated route handler; not via the rewrite | route test: no-capability → 404 | B6D3B design / B6D3C | **Yes** |
| 3 | **Client-side production-gate bypass** | Med | Critical | staging `notFound()` prod pattern | production denial in the server route/resource via `VERCEL_ENV`; public flag never sufficient | prod 404 capture | every subphase | **Yes** |
| 4 | **Unity overlay hides React lane controls** | Med | Critical | arena+controls share one `<section>` (`:3745-3877`) | overlay the cinematic viewport only; lane grid extracted outside the wrapper (§7) | component test: controls visible+clickable in `UNITY_READY_VISIBLE` | B6D3B | **Yes** |
| 5 | **Unity overlay hides the scoreboard or timer** | Med | High | scoreboard is a separate node (`:3449-3464`) | keep scoreboard/timer outside/above the overlay | component test | B6D3B | **Yes** |
| 6 | **No visible viewer-relative scoreboard** | Med | High | React scoreboard exists | keep React scoreboard authoritative/visible; no Unity scoreboard; optional React-owned overlay from sanitized context (§10.3) | UX review | B6D3B | Managed |
| 7 | **Raw ids cross into `UnityPresentationHost`** | Low | Critical | sanitizer + id-free audit; B6D3A tests | host receives only sanitized context; id-free prop assertions; never forward legacy `winnerId` | leakage test (`JSON.stringify` host props) | B6D3B | **Yes** |
| 8 | **Host mounted in the wrong MatchRoomPanel subtree** | Med | High | — | host layered inside the extracted cinematic wrapper only (§7.2) | code review + snapshot test | B6D3B | **Yes** |
| 9 | **iframe receives pointer or keyboard focus** | Med | High | loading overlay `pointer-events-none` (`:543`) | host applies `pointer-events:none`+`inert`+focus exclusion; renderer prop only if needed (§13) | focus/pointer isolation test | B6D3B | **Yes** |
| 10 | **Capability leakage, replay, or expiry mishandling** | Med | High | none yet | short-lived signed HttpOnly capability; expiry + rotation; server verify each request | capability unit/route tests (expired/replayed → deny) | B6D3B design / B6D3C | **Yes** |
| 11 | **Production resource accidentally returns 200** | Low | Critical | staging prod 404 pattern | explicit `VERCEL_ENV` deny in entry route + artifact route; test both | prod 200/404 capture | every subphase | **Yes** |
| 12 | React remount / state loss | Low | Critical | React primary; shadow additive | hide-not-unmount arena; additive wrapper | host tests | B6D3B | Yes |
| 13 | Duplicate socket listeners / timers | Low | High | single subscription; renderer opens none | host adds none (composition) | code review + test | B6D3B | Yes |
| 14 | Reveal timing divergence / stale result animation | Med | High | React owns reveal; scoreboard only on `match_state_sync` | correlation rule; reset on instance | correlation tests (exist) + host tests | B6D3B/C | Managed |
| 15 | Old-instance messages cross rematch boundary | Med | High | instance gates everywhere | host reuses `activeMatchInstanceId` reset | tests | B6D3B/C | Managed |
| 16 | iframe origin mismatch | Low | Critical | strict `origin`+`source` (`:374-375`) | keep checks; CSP/sandbox review | origin tests | B6D3B | Managed |
| 17 | Fallback flicker | Med | Med | — | React arena pre-mounted/hidden; single-frame swap | latency check | B6D3C | Non-blocking B6D3B |
| 18 | Hidden Unity resource usage / mobile perf | High | Med | shadow off by default | perf budget; unmount on fatal | device matrix | B6D3D | Non-blocking B6D3B |
| 19 | Accessibility regression | Med | Med | `role/aria-live` card | reduced-motion; focus/`inert`; controls keep focus | a11y checks | B6D3B/C | Managed |
| 20 | Artifact reproducibility | Known | Med | immutable versioned artifacts | unchanged | — | B6D3E | **BLOCKED** (non-blocking B6D3B) |
| 21 | `MatchRoomPanel` regression | Med | Critical | additive-only history | smallest additive wrapper/extraction; line-by-line review; full match matrix | test matrix | B6D3B/D | Managed |

---

## 19. Authorization gates

**Before B6D3B implementation authorization, require approval of:**

- **exact server-protected resource/capability design** (§12 — entry route +
  artifact behind a server-verified short-lived capability/session; boolean is
  convenience-only);
- **exact visual viewport subtree** to extract/wrap (§7.2);
- **exact `MatchRoomPanel` diff boundary** (additive wrapper + extraction only;
  HIGHEST sensitivity);
- **sanitized B6D3A identity/correlation dataflow** (§10; host id-free);
- **React scoreboard/timer/control visibility contract** (§7.1, §10.3);
- **iframe focus and pointer isolation** (§13);
- **lifecycle / fail-open state machine** (§8–§9);
- **player-facing public flag design** (§11);
- **complete automated test plan** (§15);
- **no unresolved critical risk** (§18: risks 1–5, 7–11 are blocking).

**B6D3C** remains protected-preview mock/runtime proof only (no real match).
**B6D3D** remains the separately-authorized two-user real-match staging proof
(internal free-play accounts only; rollback rehearsed; production NO-GO).

Standing gates (every subphase): B6D2B/B6D3A merged and stable; master CI green;
production Unity off; free-play-only policy unchanged; no local generated-artifact
contamination; `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` UNCONFIGURED.

---

## 20. Remaining blockers

1. **Two-layer server cohort enforcement not yet designed-and-accepted** — the
   convenience boolean is not a boundary; a server capability/session protecting
   the entry route **and** artifact (new route handlers) is required (§12) —
   blocks B6D3B.
2. **Visual-viewport extraction not yet accepted** — the arena subtree intermixes
   controls with visuals; a bounded cinematic-subtree extraction is required (§7)
   — blocks B6D3B.
3. **Sanitized identity dataflow + host id-free boundary not yet accepted** (§10)
   — blocks B6D3B.
4. **Iframe pointer/focus/`inert` isolation not yet proven** (§13) — blocks B6D3B.
5. **Fail-open host lifecycle + flag design not yet accepted** (§8–§9, §11) —
   blocks B6D3B.
6. **`MatchRoomPanel` wrapper/extraction is HIGHEST sensitivity** and must be
   pre-approved as minimal/additive (§7.3, §17) — blocks B6D3B.
7. **No controlled real-match evidence** — blocks B6D3D only.
8. **Artifact reproducibility BLOCKED** — blocks B6D3E only.
9. **Local dev caveat:** no `SUPABASE_SERVICE_ROLE_KEY` locally ⇒ capability denied
   ⇒ React-only — a design note, not a blocker.

---

## 21. Final recommendation

**GO WITH CONDITIONS** — proceed to a *separately-authorized* B6D3B implementation
of an isolated React lifecycle / fail-open host, **conditioned on** resolving
blockers 1–6 in §20: an accepted **two-layer server cohort enforcement** (server
capability/session protecting the entry route and artifact; boolean is convenience
only), an accepted **cinematic-viewport extraction** (Unity overlays only the
visual arena; controls/timer/scoreboard stay visible), an accepted **sanitized
identity dataflow with an id-free host boundary**, **proven iframe pointer/focus/
`inert` isolation**, an accepted **fail-open lifecycle + player-facing flag**, and
pre-approval of the **minimal additive `MatchRoomPanel` wrapper/extraction**. All
with **no real match, no flag/capability configuration, non-production only,
mock-driven, and React kept mounted and authoritative throughout**.

Recommended seam: a **new `UnityPresentationHost`** layered inside an extracted
cinematic-viewport wrapper (Option 1); `MatchRenderer3D.tsx` stays unchanged if
host-side input isolation is reliable; Protocol v1 unchanged; identity/correlation
consumed inside React only; no display labels or Unity-owned scoreboard.

This document authorizes **no** implementation. B6D3B remains **NOT AUTHORIZED**;
B6D3C and B6D3D remain **NOT AUTHORIZED**; production remains **NO-GO**.

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
feature flag, no environment, no server/route/middleware, no `next.config.ts`, and
no Unity file; it ran no Unity, no real match, and no deployment.
`MatchRoomPanel.tsx`, `MatchRenderer3D.tsx`, and
`unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` were untouched.
