# B6D3B — ISOLATED REACT LIFECYCLE HOST: SCOPE AND RISK REVIEW

> **Status: PLANNING / STATIC REPOSITORY REVIEW ONLY.** This document authorizes
> no code, no test, no CI, no feature flag, no cohort gate, no capability, no
> route, no environment variable, no Protocol v1 change, no Unity activation, no
> real match, and no deployment. It does not modify `MatchRoomPanel.tsx`,
> `MatchRenderer3D.tsx`, any runtime/test/server/route/Unity file, `next.config.ts`,
> or `ProjectSettings.asset`. It defines the smallest safe implementation boundary,
> the exact integration seams, a proposed lifecycle host, fail-open contract, a
> two-layer flag/cohort design, a **fixed protected entry URL**, a **single-renderer
> mutual-exclusion rule**, a **protected artifact delivery contract**, the phase
> split, tests, risks, and gates for a *possible, separately-authorized* B6D3B step
> — and asks for a single GO / GO-WITH-CONDITIONS / HOLD decision in §21.
>
> **This revision (finalization pass)** adds/corrects five points versus the prior
> revision: (1) a **fixed protected same-origin entry route `/unity-arena/player`**
> (no `roomCode`/id/capability in the URL) compatible with the renderer's static
> `NEXT_PUBLIC_UNITY_BUILD_URL`; (2) an **exactly-one-Unity-renderer** mutual-
> exclusion rule (player-facing host XOR the secondary shadow iframe); (3) a
> corrected **cinematic-underlay vs. authoritative-status-overlay** boundary — only
> decorative visuals may be hidden beneath Unity; all controls **and** authoritative
> status/accessibility surfaces (including the pick-locked/disconnect overlay) stay
> above; (4) a **protected artifact delivery contract**; (5) updated risks, file
> scope, and gates.

> **Follow-up (merged):** the file-by-file implementation authorization package
> that builds on this review lives at
> [`docs/unity-b6d3b-implementation-authorization.md`](./unity-b6d3b-implementation-authorization.md)
> (includes the independent artifact proxy/streaming review). B6D3B runtime
> implementation remains **NOT AUTHORIZED**.

Evidence labels: **[Verified]** (exists at the baseline SHA; cited by file/line),
**[Contract]** (stated in a merged design doc at the baseline SHA),
**[Proposed B6D3B]** (future, separately-authorized design; not built here),
**[Recommendation]**. No payload field, event, flag, file, or URL is invented as
existing; proposed names are labelled.

---

## 1. Executive decision

**[Recommendation] GO WITH CONDITIONS** for a *separately-authorized* B6D3B
implementation of an **isolated React lifecycle / fail-open presentation host**,
default-off, non-production, mock-driven only, with **no real match**.

Why favourable **[Verified]**: the whole React→Unity presentation stack exists and
is default-off (`unityPresentationProtocol.ts`, `unityPresentationAdapter.ts`,
`unityPresentationShadow.ts`, the fail-open `MatchRenderer3D.tsx`), plus the merged,
tested-but-unwired B6D3A contracts (`unityPresentationIdentity.ts`,
`unityPresentationCorrelation.ts`, 226/226). Unity is never player-facing today; it
is a shadow in a *secondary* panel that never replaces React controls
(`MatchRoomPanel.tsx:4025-4100`).

Conditions (design blockers, not defects), finalized in this revision:

1. **Fixed protected entry URL.** One same-origin `/unity-arena/player` route,
   authorized by the signed HttpOnly cohort session; no `roomCode`/id/capability in
   the URL; match identity flows through sanitized Protocol v1 messages, not the URL
   (§7.5, §12). Compatible with the renderer's static
   `NEXT_PUBLIC_UNITY_BUILD_URL`.
2. **Exactly one Unity renderer.** Player-facing `UnityPresentationHost` **XOR** the
   secondary shadow iframe — never both; one coordinator/instance/queue/ready/ack
   path (§7.4).
3. **Cinematic underlay vs. status overlay.** Unity may hide only **decorative**
   visuals; **all** controls and **authoritative status + accessibility** surfaces
   (including pick-locked/disconnect overlay, reveal/tension countdown, result/
   status text) stay above Unity (§7.2–§7.3, Correction 3).
4. **Two-layer server cohort enforcement + protected artifact delivery contract.**
   The cohort boolean is convenience-only; enforcement is a server-verified signed
   HttpOnly session protecting the entry route **and** every artifact request
   (§12, §13.2).
5. **Sanitized identity boundary + iframe input isolation** (§10, §13.3).

`MatchRoomPanel` is **HIGHEST sensitivity**; any edit is minimal, additive,
lifecycle-safe, line-by-line reviewed. B6D3B/B6D3C/B6D3D remain **NOT AUTHORIZED**;
production remains **NO-GO**.

---

## 2. Scope and non-goals

### In scope

Static, repository-grounded review of the exact seams; a *design* (not an
implementation) for the isolated host, its fail-open contract, the player-facing
flag, the two-layer cohort enforcement, the fixed protected entry URL, the
single-renderer rule, the cinematic/status boundary, the protected artifact
contract, and the sanitized identity dataflow; the B6D3B/C/D boundary, test matrix,
risk register, and gates. Exactly one new document (this file) plus, only if needed,
a minimal status/link note in the main planning doc.

### Non-goals (not done, not authorized here)

React implementation; Unity mounting; runtime integration; feature-flag creation/
configuration; environment changes; cohort gate / capability / route / artifact-
proxy implementation; server/route/middleware changes; `next.config.ts` changes;
preview-route changes; Unity C# changes; WebGL rebuilds; real-match testing;
deployment; production activation; any change to `MatchRoomPanel.tsx`,
`MatchRenderer3D.tsx`, any TS runtime/test file, `package.json`/lockfiles,
`apps/web/src/app/dev/unity-staging/**`, `next.config.ts`,
`apps/realtime-server/**`, `packages/shared/**`, Unity assets/scenes/prefabs/
`ProjectSettings`, `.github/**`, middleware, route handlers, Supabase, Vercel/
Railway config, env files, generated WebGL, or `audit-artifacts/**`.

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
   winner/timer/sudden-death. Scores are **not** atomic with `match:result`:
   `room.scores` increments **before** `match:result` (which carries **no** scores);
   the authoritative scoreboard arrives on a later `match:update`
   (`unityPresentationCorrelation.ts:6-9`; B6D3 scope §6).
2. **React state — `MatchRoomPanel.tsx`** (≈4135 lines). Owns the single Socket.IO
   subscription, match state machine, timers, reveal pacing, scores, phase,
   `matchInstance`, reconnect, rematch, `pick()`. **HIGHEST sensitivity.**
3. **Adapter — `unityPresentationAdapter.ts`.** Pure field-by-field mapping to
   Protocol v1; `round_result` never carries scores; null on malformed input.
4. **Protocol v1 — `unityPresentationProtocol.ts`.** `PENALTY444_MATCH_EVENT`,
   version 1, events `round_result|match_state_sync` (`:23-26`); `validateEnvelope`,
   `sanitizeScores`, `deriveMatchInstanceId` (`:305-317`),
   `PresentationSequenceEmitter` (`:326-346`), `PresentationSequenceGate`
   (`:359-405`).
5. **Coordinator + queue — `unityPresentationShadow.ts`.** Owns instance/sequence/
   last-snapshot; commits atomically only after a successful build (`:181-302`);
   FIFO queue dedup+cap 32 (`:324-369`); id-free audit (`:70-96`); pure pending
   helpers (`:447-499`).
6. **Renderer — `MatchRenderer3D.tsx`.** Passive iframe shell. Reads **only** the
   static `NEXT_PUBLIC_UNITY_MATCH_ENABLED` (`:249`) and
   `NEXT_PUBLIC_UNITY_BUILD_URL` (`:250`) — **it does not accept a dynamic source/
   URL prop**. Strict `event.origin===location.origin` **and**
   `event.source===iframe.contentWindow` (`:374-375`); outbound `postMessage`
   always same-origin, never `"*"` (`:332`, `:355`); inbound allowlist
   `ready|animation_complete|error` (`:132-164`); `UNITY_READY_TIMEOUT_MS=15_000`
   (`:187`); `markUnavailable` fails open (`:294-309`, `:506-526`); FIFO mode with
   `activeMatchInstanceId` reset (`:425-457`); loading overlay `pointer-events-none`
   (`:543`).
7. **Ack/failure.** Unity emits only `ready/animation_complete/error`; error/load-
   failure/timeout → `markUnavailable`. Unity acks carry numeric score **values**
   only (B6D2B).
8. **Fallback.** React is always authoritative; the shadow is an additive secondary
   panel (`:4025-4100`).

### 4.2 Current render subtree (exact JSX) — **[Verified]**

- **Main container** `<div className="relative z-10 main-container …">` **`:3145-3159`**
  — carries decorative full-screen `screenEffect` classes (GOAL/SAVE/DRAW zoom/
  shake). Wraps everything.
- **`match-container` `<section>`** **`:3160-…`** — carries decorative `impactResult`
  flash classes (`:3162-3169`).
- **Scoreboard** — standalone `<div className="shrink-0">` wrapping
  `<MatchScoreboard …/>` at **`:3449-3464`**.
- **Sudden-death banner** — `<section>` **`:3434-3447`**.
- **Match-end / rematch / leave controls** — `<section>` **`:3466-3743`**.
- **Play/arena `<section>`** (`!matchEnded`) **`:3745-3877`** — **intermixes**
  decorative pitch-lane dividers (`:3748`, `aria-hidden pointer-events-none`), the
  **authoritative pick-locked / disconnect overlay** (`:3749-3765`,
  `aria-live="polite"`), the pick-status headers, **and the interactive lane-button
  grid `:3837-3874`** (`onClick={() => pick(lane)}`).
- **Result/reveal `<section>`** (`!matchEnded`) **`:3879-4007`** — the
  **authoritative** result headline, reveal/tension countdown (`:3906-3918`),
  result subheadline/status (`:3931-3947`), and kicker/keeper result cards
  (`aria-live="polite"`).
- **Unity shadow secondary section** **`:4025-4100`**, renderer at **`:4043-4051`**.

**Consequence:** the arena `<section>` intermixes **decorative visuals** with the
**interactive lane grid** *and* the **authoritative pick-locked/disconnect overlay**;
the reveal section is **authoritative status**. There is no isolated decorative-only
node today, so a mount swap at `:4043-4051` is insufficient (§6–§7).

### 4.3 Ownership — **[Verified]**

| Value | Owner |
|---|---|
| Outcome/score/phase/winner/sudden-death | Node realtime server |
| Socket subscription, timers, reveal, `matchInstance`, reconnect/rematch, `pick()` | `MatchRoomPanel.tsx` |
| Protocol instance id + sequence | `UnityPresentationShadowCoordinator` |
| Pending buffer / active-instance mirror | `MatchRoomPanel` state (`:901-908`) |
| Readiness, iframe lifecycle, fail-open | `MatchRenderer3D.tsx` |
| Identity/visual-side & correlation (contract) | `unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts` (**not wired**) |

### 4.4 React always beneath Unity today; shadow cannot self-promote — **[Verified]**

Unity mounts only in the additive secondary panel (`:4025`), which "never obscures
or replaces lane controls, scoreboard, timer, reveal, disconnect, or match-end UI"
(`:4018-4024`). No flag/code path promotes the shadow to a visible/primary
renderer; promotion needs **new** code — the B6D3B work under review.

---

## 5. Current Unity flags and activation path

Three build-time **public** flags, all required, all default-off/unconfigured
(**[Verified]**): `NEXT_PUBLIC_UNITY_MATCH_ENABLED` (`MatchRenderer3D.tsx:249`;
`MatchRoomPanel.tsx:861`), `NEXT_PUBLIC_UNITY_LIVE_SHADOW_ENABLED` (`:860-862`),
`NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` (`:889-891`).

The staging route (`app/dev/unity-staging/page.tsx`) is gated by **server-only**
`UNITY_STAGING_ROUTE_ENABLED` + `UNITY_STAGING_ARTIFACT_ORIGIN` and returns
`notFound()` when `VERCEL_ENV === "production"` (`:39-49`). **Important
[Verified]:** the staging *artifact* is served by an **unauthenticated Next.js
rewrite** `/unity/penalty444/staging/:path* → ${ARTIFACT_ORIGIN}/:path*`
(`next.config.ts:229-235`) — no per-request auth, so any known artifact URL is
directly fetchable. Acceptable for staging; **not an enforcement boundary** for a
player-facing cohort. This shapes §12–§13.

`NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` remains **UNCONFIGURED**.

---

## 6. Integration-seam comparison

Goal: the narrowest seam that overlays Unity on **only the decorative cinematic
underlay** while every React control **and** authoritative status/accessibility
surface stays mounted, visible, and interactive — no moved gameplay state, no added
socket subscription, no duplicated timers/reveal, and **exactly one** Unity
renderer.

| # | Option | Files changed | Timers/socket | Fallback | Testability | Recommendation |
|---|---|---|---|---|---|---|
| 1 | **`UnityPresentationHost` layered inside an extracted decorative-underlay wrapper, mutually exclusive with the shadow iframe** | new host + tests; bounded extraction + single-renderer branch in `MatchRoomPanel` (§7) | none new (composition) | reuse `markUnavailable`; host toggles visible↔hidden of the *decorative underlay only* | High | **Recommended** |
| 2 | Sibling component mounted by the match page | match page (client) + host | needs re-sourced match state | weaker | Medium | Not recommended |
| 3 | Mount-swap only at `:4043-4051` | `MatchRoomPanel` | none new | — | — | **Rejected** — that is the secondary shadow node; it cannot become the arena without covering controls/status |
| 4 | Extend `MatchRenderer3D` to own visibility/URL | renderer (security boundary) | none new | same | Lower | Not recommended — keep it a pure transport/fail-open shell |

Changing only the shadow mount at `:4043-4051` is **not sufficient** (that is the
additive shadow node; the arena visuals, lane grid, and authoritative status share
subtrees). Option 1 requires a **bounded relative wrapper around the decorative
underlay**, a **single-renderer mutual-exclusion branch**, and lifting controls +
status out of the overlaid region.

---

## 7. Recommended isolated host boundary, viewport, single-renderer rule, and entry URL

**[Recommendation]** `UnityPresentationHost` **composes** `MatchRenderer3D` (does
not edit it) and consumes the already-produced FIFO props (`messages`,
`activeMatchInstanceId`, `onReady`, `onError`, `onMessageSent`). It owns **only
presentation-lifecycle + decorative-underlay visibility** — never match state,
socket, gameplay timer, reveal logic, scoreboard, or authoritative status text.

### 7.1 What Unity may cover — decorative underlay only (Correction 3)

The cinematic underlay Unity may replace/hide contains **only visual/decorative**
presentation:

- pitch background;
- lane-divider artwork (`:3748`, `aria-hidden`);
- non-interactive cinematic animation;
- visual result effects (decorative `screenEffect`/`impactResult` bursts,
  `:3145-3169`).

### 7.2 What must stay outside/above Unity — controls **and** authoritative status (Correction 3)

These React elements remain mounted, outside or above the Unity overlay:

- **lane-button grid** (`:3837-3874`);
- **scoreboard** (`:3449-3464`);
- **timer**;
- **pick-locked status** and **disconnect/reconnect countdown + overlay**
  (`:3749-3765`) — **explicitly NOT part of the hidden cinematic subtree**;
- **revealing / tension countdown text** (`:3906-3918`);
- **authoritative result / status text** (`:3926-3947`);
- **match-end / rematch / leave controls** (`:3466-3743`);
- **every `aria-live`, `role="status"`, and accessibility announcement**.

- **Unity receives no gameplay input**; the iframe receives **no pointer or
  keyboard input** during B6D3B (§13.3).
- **When Unity is visible:** React's **decorative** underlay may be visually hidden;
  **authoritative textual status and accessibility content remain mounted, visible
  where appropriate, and exposed to assistive technology**; Unity is `aria-hidden`
  and receives no input.
- **When fail-open occurs:** **only the React decorative underlay is restored**;
  controls and status surfaces never disappear.

### 7.3 Exact subtree that must later be wrapped/extracted — **[Verified] boundary**

A future B6D3B introduces a **relative wrapper around the decorative underlay only**
and hosts `UnityPresentationHost` inside it, while keeping controls **and**
authoritative status above/outside:

- Decorative region to wrap (hideable): pitch background / lane-divider artwork
  (`:3748`) and the decorative full-screen effect layers (`:3145-3169`), plus any
  non-interactive cinematic animation — refactored into a dedicated underlay layer.
- **Kept above/outside** (never hidden): the lane-button grid (`:3837-3874`), the
  pick-locked/disconnect overlay (`:3749-3765`), the reveal/tension countdown
  (`:3906-3918`), the result/status text (`:3926-3947`), the scoreboard
  (`:3449-3464`), the timer, and match-end/rematch controls (`:3466-3743`).
- Because these currently share subtrees, this is a **bounded structural extraction
  of the decorative layer** (not a mount swap), with **no** change to `pick()`,
  timers, reveal, socket, scores, or reconnect.

### 7.4 Single-renderer mutual-exclusion rule (Correction 2)

Current behaviour **[Verified]:** enabling the shadow flags mounts the secondary
shadow `MatchRenderer3D` (`:4043-4051`).

Future B6D3B rule **[Proposed B6D3B]:**

- **When the full player-facing gate is satisfied** (all shadow flags + player-
  facing flag + valid server cohort session + non-production): mount **exactly one**
  `UnityPresentationHost` inside the decorative underlay; **do not** mount the
  secondary shadow `MatchRenderer3D` iframe; retain **one**
  `UnityPresentationShadowCoordinator`, **one** active match instance, **one** FIFO
  pending buffer, **one** ready lifecycle, **one** message/acknowledgement path.
- **When the gate is not satisfied:** preserve the existing shadow-preview behaviour
  **byte-for-byte**; React remains the normal player-facing renderer.
- **Never duplicate** iframes, `postMessage` listeners, pending queues, sequence
  emitters, readiness callbacks, or acknowledgements. The two modes are a **mutually
  exclusive render branch** — player-facing host **XOR** secondary shadow iframe.

### 7.5 Fixed protected entry URL (Correction 1)

Repository fact **[Verified]:** `MatchRenderer3D` reads a **static**
`NEXT_PUBLIC_UNITY_BUILD_URL` internally and **does not accept a dynamic source
prop**. Therefore:

- Use **one fixed protected same-origin entry route: `/unity-arena/player`**
  (**[Proposed B6D3B]**).
- The route is authorized by the short-lived signed HttpOnly cohort session (§12).
- The route **does not require `roomCode` in its URL**; **match identity flows
  through sanitized Protocol v1 messages, not URL parameters**.
- **No capability, token, user id, room code, or match id appears in the URL.**
- `NEXT_PUBLIC_UNITY_BUILD_URL` **may later** point to `/unity-arena/player` during
  an **explicitly authorized protected-preview phase** (not configured here).
- **`MatchRenderer3D` may remain unchanged for URL selection** (the fixed route is
  compatible with its static build-URL read).
- A dynamic `/unity-arena/[roomCode]` route is **not** part of the recommended
  B6D3B design.

The conditional `MatchRenderer3D` security-prop rule (§13.3) applies **only** to
iframe focus/input isolation — **not** URL selection.

`NEXT_PUBLIC_UNITY_BUILD_URL` is **not configured** in this task.

### 7.6 Does `MatchRoomPanel.tsx` change? — **[Recommendation] Yes, minimally but structurally.**

The correct minimal change is: a **bounded decorative-underlay wrapper +
extraction** (§7.3), a **single-renderer mutually exclusive branch** (§7.4), passing
**sanitized host props only** (§10), with **no** timer/socket/reveal/score authority
change. This is larger than a one-line swap and is **HIGHEST sensitivity**; it must
be additive/lifecycle-safe and reviewed line-by-line.

### 7.7 Does `MatchRenderer3D.tsx` change? — **[Recommendation] No for URL; conditional for isolation.**

Unchanged for URL selection (§7.5). It changes **only if** host-side iframe pointer/
focus/`inert` isolation cannot be proven (§13.3); then a minimal security-prop
change enters the future file scope.

---

## 8. Proposed lifecycle state machine

**[Proposed B6D3B]** Host-owned, presentation + decorative-underlay visibility only:

- `DISABLED` — gate off / cohort session absent → host renders nothing extra; React
  arena visible; **secondary shadow unaffected** (see §7.4 mutual exclusion).
- `REACT_ONLY` — gated on, Unity not yet visible; React decorative underlay + all
  controls/status visible + authoritative.
- `UNITY_LOADING` — the single player-facing iframe mounted, awaiting `ready`
  (bounded by the 15 s timeout).
- `UNITY_READY_VISIBLE` — `ready` received; Unity revealed over the **decorative
  underlay only**; the React decorative underlay hidden (mounted) beneath;
  **controls + authoritative status + accessibility stay visible/mounted**; Unity
  `aria-hidden`, no input.
- `UNITY_FAILED_REACT_FALLBACK` — any failure; Unity hidden/unmounted; **only the
  React decorative underlay restored**; controls/status never disappeared; terminal
  for the instance.

Rules: keep React mounted always; **hide, never unmount** the decorative underlay;
**never hide controls or authoritative status**; exactly one renderer (§7.4);
prevent hidden/failed-iframe input (§13.3); reset on new `matchInstanceId` (reuse
`activeMatchInstanceId`, `MatchRenderer3D.tsx:425-431`); iframe reload = fresh ready
lifecycle; discard pre-ready/old-instance pending (`replacePending`,
`fifoQueueRef.reset()`); permanent fail-open per instance after a fatal error
(mirror `markUnavailable` idempotency, `:296-297`, `:382`). Not implemented here.

---

## 9. Fail-open and fallback contract

**[Proposed B6D3B]** Fail-open needs **no server intervention** and never
interrupts gameplay; it restores **only the React decorative underlay** —
controls/timer/scoreboard/status never disappear.

| Failure | Unity | React controls + authoritative status | Match continues? | Retry? | Sanitized telemetry | Never log |
|---|---|---|---|---|---|---|
| iframe load failure | unmount | stay visible/interactive | Yes | new instance/reload | reason, counter | payloads/ids/capability |
| readiness timeout (15 s) | unmount | visible | Yes | new lifecycle | reason, elapsed bucket | ids/tokens/capability |
| malformed ack | ignored | visible | Yes | n/a | event name | raw ack |
| rejected/foreign/stale/duplicate | not applied | visible | Yes | n/a | reject reason (enum) | ids/scores-by-id |
| sequence/instance rejection | not applied | visible | Yes | n/a | instance id + reason | player ids |
| postMessage exception | fail open | visible | Yes | new lifecycle | reason | error w/ payload |
| Unity runtime `error` | fail open | visible | Yes | new lifecycle | "unity_error" | Unity raw message |
| iframe reload | fresh lifecycle | visible | Yes | yes (bootstrap) | "reload" | history |
| navigation/unmount | teardown | visible until nav | Yes | n/a | none | — |
| rematch/new instance | reset+bootstrap | visible | Yes | yes | new instance id | old-instance data |
| missing/unavailable/denied artifact | placeholder/unmount | visible | Yes | n/a | "artifact_denied" | origin/capability |
| cohort session revoked/expired | hide Unity → React underlay | visible | Yes | n/a | "revoked" | session/capability contents |

Telemetry is identity-free (values/counts, mirroring `buildAuditSummary`,
`unityPresentationShadow.ts:70-96`); **no capability/token/session appears in logs**.

---

## 10. B6D3A identity / correlation consumption (complete dataflow)

**[Contract; Verified]** `buildViewerIdentityContext`
(`unityPresentationIdentity.ts:196-290`) and `correlateResultToStateSync`
(`unityPresentationCorrelation.ts:110-168`). **These modules are not modified by
B6D3B.**

### 10.1 Identity flow

- Raw ids may exist **only inside `MatchRoomPanel`** (or a trusted React-side
  adapter/hook), where a pure builder calls `buildViewerIdentityContext({...})`.
- Output `ViewerIdentityContext` is sanitized: `SELF/OPPONENT`, `SELF→LEFT`/
  `OPPONENT→RIGHT` (`:255-263`), verbatim score projection (no arithmetic),
  optional all-or-nothing `KICKER/KEEPER` (`:218-234`), optional authoritative
  outcome (never derived from scores, `:236-252`), optional bounded label with
  raw-id-containment defence (`:111-167`, `:270-278`).
- **Only the sanitized context crosses into `UnityPresentationHost`.** The host must
  **never** receive: `viewerPlayerId`, raw score-map keys, `kickerPlayerId`,
  `keeperPlayerId`, `winnerPlayerId`, email, auth/session/token/capability data,
  socket data, or wallet/economy data.
- Guard: legacy `getUnityMatchEndPresentation` returns a raw score-map key
  `winnerId` (`MatchRoomPanel.tsx:278-301`) — legacy-shadow-only; **never** feed the
  player-facing path.

### 10.2 Correlation flow

- Store the last accepted sanitized `round_result`; on the later authoritative
  `match_state_sync`, evaluate `correlateResultToStateSync(result, stateSync)`.
- Accept equal-round terminal (delta 0) and exactly-next-round continuation
  (delta 1); reject stale/duplicate, foreign-instance, invalid-round-order
  (`:131-149`); reset on new `matchInstanceId`; only `match_state_sync` is
  score-bearing (`:73-75`).

### 10.3 Visible scoreboard decision

- Keep the existing React scoreboard, timer, controls, and **authoritative status
  text** visible and authoritative (`MatchScoreboard`, `MatchRoomPanel.tsx:3449-3464`;
  status `:3879-4007`).
- Unity renders only the decorative cinematic arena.
- Update the visible scoreboard only from authoritative React state or the accepted
  `match_state_sync` — **never** from `round_result`.
- Do not send display labels or identity fields to Unity; do not create a
  Unity-owned scoreboard; any viewer-relative HTML overlay stays React-owned and
  receives only the sanitized `ViewerIdentityContext`.

### 10.4 Recommended approach

Keep Protocol v1 unchanged; consume identity/correlation only inside React; do not
ship display labels to Unity in B6D3B. Lowest risk; sanitizer stays the single
choke point; any additive presentation contract is deferred to a separately
authorized protocol phase.

---

## 11. Separate player-facing flag design

**[Proposed B6D3B] — designed, not created.**

- **Proposed flag:** `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED` (build-time public,
  default-off). **Build/UX gate only — not a production security boundary.**
- **Insufficiency of existing flags:** they only feed a shadow into an additive
  panel (§4.4); none swaps React out.
- **Required combination:** player-facing mode requires all three existing flags
  **AND** the new flag **AND** a valid **server cohort session** (§12) **AND**
  `VERCEL_ENV !== "production"`. The public flag is necessary, never sufficient.
- **Single disable → React for everyone.**
- **Client-side checks are not the boundary:** browser state, public flags, JS,
  query params, localStorage, and intercepted responses are untrusted; none may make
  the protected Unity resource load (§12–§13).

No flag is created, configured, or enabled here.

---

## 12. Server-side cohort design (two-layer enforcement)

**[Proposed B6D3B] — designed, not implemented.** The cohort must be impossible to
self-select from browser JavaScript.

**Repository facts [Verified].** Match route is a **client component**
(`app/match/[roomCode]/page.tsx:1-16`); **no middleware** in `apps/web`; staging
artifact is served by an **unauthenticated rewrite** (`next.config.ts:229-235`); a
proven server-only allowlist pattern exists in `/api/admin/me` (JWT via
`admin.auth.getUser(token)`; returns only a boolean; `:7-67`).

### A. Convenience status endpoint (NOT the boundary)

`/api/unity-cohort/status` → `{ inCohort: boolean }` for UI flow only; false/error/
unavailable ⇒ React-only. **Not an enforcement boundary**; client state/fetch/
localStorage/query params are untrusted; tampering must not grant Unity.

### B. Actual enforcement boundary (server-verified session/capability)

- Server verifies the authenticated user against a **server-only allowlist**.
- Server **issues/validates a short-lived signed HttpOnly cohort session** (not
  readable/forgeable by client JS).
- The **fixed protected entry route `/unity-arena/player`** and **every artifact
  request** are protected server-side by that session; unauthorized ⇒ **404**.
- **Production always denies server-side** via `VERCEL_ENV === "production"`.
- **No client-side change** can make the protected resource load.
- **Revocation:** remove from allowlist / expire the session / rotate the signing
  secret.

**Recommended [Recommendation]: A + B**, with the fixed protected entry
(`/unity-arena/player`, §7.5) and the protected artifact delivery contract (§13.2).
The unauthenticated `next.config.ts` rewrite is **not** reused for the player-facing
path. Degrades safely locally (no `SUPABASE_SERVICE_ROLE_KEY` ⇒ deny ⇒ React-only,
per root `AGENTS.md`).

### Likely future files (Correction 1) — **[Proposed B6D3B], not implemented**

- `apps/web/src/app/api/unity-cohort/status/route.ts` (new) — convenience boolean
  (NOT the boundary).
- `apps/web/src/lib/unity-cohort/capability.ts` (new) — sign/verify the short-lived
  session/capability (server-only secret).
- `apps/web/src/app/api/unity-cohort/session/route.ts` (new) — verify user +
  allowlist; mint the signed HttpOnly cohort session.
- `apps/web/src/app/unity-arena/player/route.ts` (new) — **fixed protected same-
  origin Unity entry**; validates the session; `notFound()` on failure and in
  production. *(Replaces the previously-listed dynamic `[roomCode]` route.)*
- `apps/web/src/app/api/unity-arena/artifact/[...path]/route.ts` (new) —
  **protected artifact/manifest** access behind the same server boundary (§13.2).
- (Alternative, not recommended) `apps/web/middleware.ts` (new).

No route, capability, secret, session, schema, RLS, middleware, or `next.config.ts`
change is created here.

---

## 13. Protocol, security, and privacy boundaries

### 13.1 Current protections **[Verified]**

Same-origin inbound (`origin`+`source`, `MatchRenderer3D.tsx:374-375`); outbound
same-origin only (`:332`, `:355`); inbound allowlist (`:132-164`); sanitizing
adapter/protocol (prototype-pollution guard, finite non-negative integer scores,
null-not-throw); id-free audit (`unityPresentationShadow.ts:70-96`); iframe
`allow="autoplay; fullscreen"` (`:539`), **no `sandbox` set today**; staging route
`notFound()` in production (`app/dev/unity-staging/page.tsx:39-41`); staging
artifact rewrite is **unauthenticated** (`next.config.ts:229-235`).

### 13.2 Protected artifact delivery contract (Correction 4) **[Proposed B6D3B]**

The fixed protected entry (`/unity-arena/player`) and **every** artifact request
(loader, framework, data, wasm, manifest) must:

- **validate the signed HttpOnly cohort session server-side** on every request;
- **deny when absent, invalid, expired, or revoked**;
- **return 404 (or equivalent) in production**;
- **never accept a capability through a query string**;
- **never expose the upstream artifact origin** to the client;
- **reject `..`, encoded traversal, absolute paths, and unknown files**;
- **serve only files allowlisted by the immutable release manifest**;
- **preserve the required `Content-Type` and `Content-Encoding`** (gzip WebGL);
- **preserve safe `Content-Length`, `ETag`, and cache semantics** where applicable;
- **support streaming and byte-range behaviour** where the Unity loader requires it;
- **never fall back to the unauthenticated staging rewrite**.

**Tests (Correction 4):** no session → 404; invalid session → 404; expired session
→ 404; removed allowlist member → 404; production → 404 for entry, manifest, loader,
data, and wasm; direct artifact URL without session → 404; path traversal and
encoded traversal → 404; unknown file → 404; valid authorized manifest/loader/data/
wasm requests preserve expected response metadata (type/encoding/length/range); no
capability/token appears in logs or URLs.

**The exact proxy/streaming implementation must be independently reviewed before
B6D3B implementation authorization.**

### 13.3 Production hard-block + iframe input isolation **[Proposed B6D3B]**

- `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED` is a **build/UX gate only**; client-side
  checks are **not** a production security boundary. **Production denial occurs in
  the protected server route/resource** via `VERCEL_ENV === "production"`.
- **Iframe input isolation:** keep `MatchRenderer3D` unchanged **only if**
  `UnityPresentationHost` can reliably apply `pointer-events: none`, focus
  exclusion, and `inert` so Unity receives **no** pointer/keyboard input and React
  controls retain keyboard + pointer ownership; future component tests must prove no
  iframe focus/pointer. Sandbox/CSP changes are a separately reviewed hardening
  decision unless implementation proves a renderer change is necessary; **if
  reliable isolation cannot be achieved host-side, a minimal `MatchRenderer3D`
  security-prop change enters the future file scope** (isolation only, not URL).

### 13.4 Other proposed protections

Route all player-facing identity through `buildViewerIdentityContext`; never forward
a raw score-map key; keep auth/session isolation (host reads no token/capability);
exclude wallet/economy; no Protocol v1 change and no new event in B6D3B.

---

## 14. B6D3B / B6D3C / B6D3D phase split

**[Proposed / Contract]**

- **B6D3B — isolated React lifecycle / fail-open host.** New host + player-facing
  flag design + two-layer server cohort enforcement + fixed protected entry
  (`/unity-arena/player`) + protected artifact contract + decorative-underlay
  extraction + single-renderer mutual-exclusion + fail-open logic; mock/
  deterministic events only, **no real match**, **no flag/session/capability
  configuration**; non-production; minimal additive `MatchRoomPanel` change (HIGHEST
  sensitivity); automated/unit/component tests. **Entry:** this review merged; all
  §19 items approved. **Exit:** host merged; 226+ tests green; new host/fallback/
  isolation/identity/single-renderer/artifact tests green; `tsc`+`next build`+
  realtime build green; no runtime activation.
- **B6D3C — protected-preview mock/runtime proof.** Deterministic mock Protocol v1
  on a protected (SSO) preview; verify lifecycle, ordering, instance/reload/
  bootstrap, fallback, controls-and-status-stay-visible, single renderer, and the
  protected-artifact denials; **no real match**.
- **B6D3D — controlled two-user real-match staging proof.** Separate explicit
  authorization; internal free-play accounts only; server-gated session; validate
  all rounds/sudden-death/timeout/disconnect/reconnect/rematch/abort/match-end/
  fallback; rollback rehearsed; production NO-GO.

---

## 15. Test and evidence strategy

**[Proposed B6D3B]** Unit/component-level; no real match.

B6D3B (automated): host lifecycle transitions (§8); React controls/timer/scoreboard
**and authoritative status** remain visible + interactive in every state incl.
fail-open; **exactly one iframe when player-facing; exactly one iframe in
shadow-only mode; never both renderers together; one ready callback per lifecycle;
every dispatch sent at most once** (§7.4); readiness timeout / load failure /
postMessage failure / Unity error → fallback restores only the decorative underlay;
malformed/rejected/foreign/stale/duplicate dropped; new-instance reset; rematch
separation; flag disabled → `DISABLED`; cohort session absent/invalid → React-only
(boolean tampering does not grant Unity); production `VERCEL_ENV` → protected
resource denies; hidden/failed iframe cannot receive pointer or keyboard focus; no
raw-id/PII/capability crosses into the host; no socket/timer/listener/queue/emitter
duplication; **protected artifact tests per §13.2**; existing 226 tests remain
green; `tsc --noEmit`, `next build`, realtime `build` regression guards.

B6D3C (runtime proof, not B6D3B): deterministic mock drive on a protected preview;
ordered/instance/reload/bootstrap/fallback + controls-and-status-visible + single-
renderer + artifact-denial evidence; identity-free capture. Two-browser real-match
evidence is **B6D3D only**.

The `test:unity-presentation` script runs 5 files = **226 tests**
(`apps/web/package.json:13`); new host tests would be registered there in B6D3B (a
script-only edit — out of scope here).

---

## 16. Performance, UX, and accessibility bounds

**[Proposed B6D3B] — budgets for later subphases; not measured here.** Readiness
timeout reuses `15_000` ms (`MatchRenderer3D.tsx:187`). Fallback instantaneous
(decorative underlay pre-mounted/hidden; no state refetch). Bounded iframe remounts
per instance; fatal error terminal. **React interaction availability 100%** —
controls always usable. Layout-shift: revealing/hiding Unity must not shift the
controls/timer/scoreboard/status (Unity overlays the decorative underlay only).
Memory/CPU on a device matrix in B6D3D (artifact ≈10.7 MB). Respect
`prefers-reduced-motion`; keep `role="status"`/`aria-live` surfaces mounted and
exposed while Unity is `aria-hidden`; a hidden decorative layer must be `inert`/not
focusable; keyboard/focus ownership stays with the visible React controls. No claim
is made that player-facing performance has been measured (it has not).

---

## 17. Proposed future changed-file list

**[Proposed B6D3B] — classification only; no authorization implied.**

### Likely new

- `apps/web/src/components/match/UnityPresentationHost.tsx`
- `apps/web/src/components/match/UnityPresentationHost.test.ts(x)` (host tests)
- `apps/web/src/components/match/useViewerPresentation.ts` (sanitized identity/
  correlation builder inside React)
- `apps/web/src/app/api/unity-cohort/status/route.ts` (convenience boolean; NOT the
  boundary)
- `apps/web/src/lib/unity-cohort/capability.ts` (sign/verify session/capability)
- `apps/web/src/app/api/unity-cohort/session/route.ts` (verify user + allowlist;
  mint HttpOnly session)
- `apps/web/src/app/unity-arena/player/route.ts` (**fixed** protected entry;
  capability-gated; prod 404) — *replaces the previously-listed
  `app/unity-arena/[roomCode]/route.ts`*
- `apps/web/src/app/api/unity-arena/artifact/[...path]/route.ts` (protected artifact
  delivery per §13.2)

### Minimal modification

- `apps/web/src/components/match/MatchRoomPanel.tsx` —
  - bounded **decorative-underlay extraction** (§7.3);
  - **single-renderer mutually exclusive branch** (§7.4);
  - **sanitized host props only** (§10);
  - **no** timer/socket/reveal/score authority change. **HIGHEST sensitivity.**
- `apps/web/package.json` — register host test in `test:unity-presentation` (no
  dependency/lockfile change).

### Conditional

- `apps/web/src/components/match/MatchRenderer3D.tsx` — **only if** host-side input/
  focus isolation cannot be proven (isolation prop only; **not** URL selection).

### Inspect only

- B6D3A modules (`unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts`)
- protocol/adapter/shadow modules
- staging route (`app/dev/unity-staging/**`)
- `next.config.ts` (staging rewrite reference; not reused for player-facing artifact)

### Prohibited

`apps/realtime-server/**`, `packages/shared/**`, Unity C#/scenes/prefabs/assets/
`ProjectSettings.asset`, env/config, `.github/**`, Vercel/Railway, lockfiles,
generated WebGL, `audit-artifacts/**`.

Listing a file grants **no** implementation authorization.

---

## 18. Risk register

Likelihood × impact; current mitigation (**[Verified]**) vs proposed
(**[Proposed B6D3B]**); evidence; phase that clears it; blocking status.

| # | Risk | Lk | Impact | Current mitigation | Proposed mitigation | Evidence | Clears in | Blocking |
|---|---|---|---|---|---|---|---|---|
| 1 | **Static renderer URL incompatible with a dynamic protected route** | Med | High | renderer reads static `NEXT_PUBLIC_UNITY_BUILD_URL` (`:250`), no dynamic prop | fixed `/unity-arena/player`; identity via messages, not URL (§7.5) | design review; renderer unchanged for URL | B6D3B | **Yes** |
| 2 | **Simultaneous secondary-shadow and player-facing iframes** | Med | High | shadow is the only mount today | mutually exclusive render branch; one renderer (§7.4) | test: exactly one iframe per mode; never both | B6D3B | **Yes** |
| 3 | **Duplicate ready/message/ack lifecycles** | Med | High | one coordinator/queue today | retain one coordinator/instance/queue/ready/ack (§7.4) | test: one ready per lifecycle; each dispatch sent once | B6D3B | **Yes** |
| 4 | **Disconnect or authoritative status overlays hidden beneath Unity** | Med | Critical | pick-locked/disconnect + status are in-arena today | keep pick-locked/disconnect (`:3749-3765`), reveal/tension (`:3906-3918`), result/status (`:3926-3947`) ABOVE Unity; underlay hides decorative only (§7.2) | test: status/overlays visible + `aria-live` exposed in `UNITY_READY_VISIBLE` | B6D3B | **Yes** |
| 5 | **Protected artifact proxy corrupts compression/MIME/range** | Med | High | staging rewrite preserves headers but is unauthenticated | protected route preserves `Content-Type`/`Content-Encoding`/`Content-Length`/`ETag`/range (§13.2) | test: metadata preserved on authorized loader/data/wasm | B6D3B design / B6D3C | **Yes** |
| 6 | **Traversal or unknown-file access** | Med | Critical | staging validates version format only | reject `..`/encoded/absolute/unknown; manifest allowlist (§13.2) | test: traversal/encoded/unknown → 404 | B6D3B design / B6D3C | **Yes** |
| 7 | **Capability/token appears in URLs or logs** | Med | Critical | none yet | HttpOnly session; never in query string; never logged (§12–§13.2) | test: no capability in URL/logs | B6D3B | **Yes** |
| 8 | **Client tampering with the cohort boolean grants Unity** | Med | Critical | boolean not yet used | boolean convenience-only; enforcement via server session (§12) | test: tampered boolean → still denied | B6D3B/C | **Yes** |
| 9 | **Direct access to an unprotected Unity artifact URL** | Med | Critical | staging rewrite unauthenticated (`next.config.ts:229-235`) | player-facing artifact behind capability-gated route; not the rewrite (§13.2) | test: no session → 404 | B6D3B/C | **Yes** |
| 10 | **Client-side production-gate bypass** | Med | Critical | staging prod 404 pattern | production denial server-side via `VERCEL_ENV`; public flag never sufficient (§13.3) | prod 404 capture | every subphase | **Yes** |
| 11 | **Unity overlay hides React lane controls** | Med | Critical | arena+controls share `<section>` (`:3745-3877`) | overlay decorative underlay only; lane grid outside wrapper (§7) | test: controls visible+clickable in `UNITY_READY_VISIBLE` | B6D3B | **Yes** |
| 12 | **Unity overlay hides scoreboard/timer** | Med | High | scoreboard is a separate node (`:3449-3464`) | keep scoreboard/timer outside/above overlay | test | B6D3B | **Yes** |
| 13 | **Raw ids / capability cross into the host** | Low | Critical | sanitizer + id-free audit; B6D3A tests | host receives only sanitized context; id/capability-free prop assertions | leakage test (`JSON.stringify` host props) | B6D3B | **Yes** |
| 14 | **Host mounted in the wrong subtree** | Med | High | — | host inside the extracted decorative wrapper only (§7.3) | code review + snapshot test | B6D3B | **Yes** |
| 15 | **iframe receives pointer/keyboard focus** | Med | High | loading overlay `pointer-events-none` (`:543`) | host `pointer-events:none`+`inert`+focus exclusion; renderer prop only if needed (§13.3) | focus/pointer isolation test | B6D3B | **Yes** |
| 16 | **Capability leakage/replay/expiry mishandling** | Med | High | none yet | short-lived signed HttpOnly session; expiry+rotation; verify per request | tests: expired/replayed → deny | B6D3B/C | **Yes** |
| 17 | **Production resource accidentally returns 200** | Low | Critical | staging prod 404 pattern | explicit `VERCEL_ENV` deny in entry + artifact routes | prod 200/404 capture | every subphase | **Yes** |
| 18 | React remount / state loss | Low | Critical | React primary; shadow additive | hide-not-unmount underlay; additive wrapper | host tests | B6D3B | Yes |
| 19 | Reveal timing divergence / stale result animation | Med | High | React owns reveal; scoreboard only on `match_state_sync` | correlation rule; reset on instance | correlation tests (exist) + host tests | B6D3B/C | Managed |
| 20 | Old-instance messages cross rematch boundary | Med | High | instance gates everywhere | host reuses `activeMatchInstanceId` reset | tests | B6D3B/C | Managed |
| 21 | iframe origin mismatch | Low | Critical | strict `origin`+`source` (`:374-375`) | keep checks; CSP/sandbox review | origin tests | B6D3B | Managed |
| 22 | Fallback flicker | Med | Med | — | underlay pre-mounted/hidden; single-frame swap | latency check | B6D3C | Non-blocking B6D3B |
| 23 | Hidden Unity resource usage / mobile perf | High | Med | shadow off by default | perf budget; unmount on fatal | device matrix | B6D3D | Non-blocking B6D3B |
| 24 | Accessibility regression | Med | Med | `role/aria-live` surfaces | keep status mounted+exposed; Unity `aria-hidden`; `inert` underlay | a11y checks | B6D3B/C | Managed |
| 25 | Artifact reproducibility | Known | Med | immutable versioned artifacts | unchanged | — | B6D3E | **BLOCKED** (non-blocking B6D3B) |
| 26 | `MatchRoomPanel` regression | Med | Critical | additive-only history | smallest additive extraction + single-renderer branch; line-by-line review | full match matrix | B6D3B/D | Managed |

---

## 19. Authorization gates

**Before B6D3B implementation authorization, require approval of:**

- **fixed protected entry URL design** (`/unity-arena/player`; no id/capability in
  URL; identity via messages) (§7.5);
- **protected artifact delivery contract** (§13.2, incl. the independent
  proxy/streaming implementation review);
- **single-renderer mutual-exclusion rule** (§7.4);
- **exact cinematic-underlay / status-overlay boundary** (§7.1–§7.3);
- **exact `MatchRoomPanel` diff boundary** (decorative extraction + single-renderer
  branch + sanitized host props; no authority change);
- **sanitized identity/correlation flow** (§10; host id/capability-free);
- **iframe focus/pointer isolation** (§13.3);
- **server capability/session design** (§12);
- **complete automated test matrix** (§15);
- **no unresolved critical risk** (§18: risks 1–17 are blocking).

**B6D3C** remains protected-preview mock/runtime proof only (no real match).
**B6D3D** remains the separately-authorized two-user real-match staging proof
(internal free-play accounts only; rollback rehearsed; production NO-GO).

Standing gates (every subphase): B6D2B/B6D3A merged and stable; master CI green;
production Unity off; free-play-only policy unchanged; no local generated-artifact
contamination; `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` UNCONFIGURED.

---

## 20. Remaining blockers

1. **Fixed protected entry URL + two-layer server cohort enforcement + protected
   artifact delivery contract** not yet accepted (new route handlers; §7.5, §12,
   §13.2) — blocks B6D3B.
2. **Single-renderer mutual-exclusion** not yet accepted (§7.4) — blocks B6D3B.
3. **Decorative-underlay vs. authoritative-status boundary** not yet accepted; the
   arena subtree intermixes decorative visuals, controls, and status overlays (§7)
   — blocks B6D3B.
4. **Sanitized identity dataflow + host id/capability-free boundary** not yet
   accepted (§10) — blocks B6D3B.
5. **Iframe pointer/focus/`inert` isolation** not yet proven (§13.3) — blocks B6D3B.
6. **Fail-open host lifecycle + flag design** not yet accepted (§8–§9, §11) — blocks
   B6D3B.
7. **`MatchRoomPanel` extraction + single-renderer branch** is HIGHEST sensitivity;
   must be pre-approved as minimal/additive (§7.6, §17) — blocks B6D3B.
8. **No controlled real-match evidence** — blocks B6D3D only.
9. **Artifact reproducibility BLOCKED** — blocks B6D3E only.
10. **Local dev caveat:** no `SUPABASE_SERVICE_ROLE_KEY` locally ⇒ session denied ⇒
    React-only — a design note, not a blocker.

---

## 21. Final recommendation

**GO WITH CONDITIONS** — proceed to a *separately-authorized* B6D3B implementation
of an isolated React lifecycle / fail-open host, **conditioned on** resolving
blockers 1–7 in §20: an accepted **fixed protected entry `/unity-arena/player`**
(no id/capability in URL; identity via sanitized messages), an accepted **two-layer
server cohort enforcement** and **protected artifact delivery contract**
(server-verified signed HttpOnly session protecting the entry route and every
artifact request; independent proxy/streaming review), an accepted **single-renderer
mutual-exclusion rule** (host XOR shadow iframe), an accepted **decorative-underlay
vs. authoritative-status boundary** (Unity hides decorative only; controls and
status stay above), an accepted **sanitized identity dataflow with an id/capability-
free host boundary**, **proven iframe pointer/focus/`inert` isolation**, and
pre-approval of the **minimal additive `MatchRoomPanel` extraction + single-renderer
branch**. All with **no real match, no flag/session/capability configuration,
non-production only, mock-driven, and React kept mounted and authoritative
throughout**.

Recommended seam: a **new `UnityPresentationHost`** layered inside an extracted
decorative-underlay wrapper, mutually exclusive with the shadow iframe (Option 1);
`MatchRenderer3D.tsx` stays unchanged for URL selection (compatible with its static
`NEXT_PUBLIC_UNITY_BUILD_URL`) and changes only if input isolation is not otherwise
provable; Protocol v1 unchanged; identity/correlation consumed inside React only; no
display labels or Unity-owned scoreboard.

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

This review changed no runtime code, no test, no Protocol v1 wire shape, no feature
flag, no environment, no server/route/middleware, no `next.config.ts`, and no Unity
file; it ran no Unity, no real match, and no deployment. `MatchRoomPanel.tsx`,
`MatchRenderer3D.tsx`, and
`unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` were untouched.
