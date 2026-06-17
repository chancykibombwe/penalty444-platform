# Unity / 3D Prototype Plan — Penalty444

> Status: **Planning** — not yet in development. No Unity code lives in this
> repository. This document defines the integration contract, constraints, and
> phased rollout plan to guide the first prototype spike.

---

## 1. Purpose

Penalty444 is a turn-based penalty-shootout game that currently runs entirely
in the browser with a React UI and a Socket.IO realtime server. The current
rendering is 2-D / DOM-based. A Unity (or comparable 3-D) renderer would
replace the visual presentation of the pick/result moment — the shot animation,
goalkeeper dive, ball trajectory, crowd atmosphere — while the game-logic
authority stays on the existing Node.js realtime server and Supabase backend.

This document captures the architecture rules, event contract, risks, and
rollout plan that must be agreed upon before any Unity/3-D prototype build
begins.

---

## 2. Current Working Model

### Stack

| Layer | Technology |
|---|---|
| Web frontend | Next.js 15 App Router (React) |
| Realtime server | Node.js + Socket.IO (`NEXT_PUBLIC_REALTIME_URL`) |
| Database / auth | Supabase (PostgreSQL + Row Level Security) |
| Hosting | Vercel (web) + separate process for realtime server |

### Match flow (simplified)

1. Player creates or joins a room via Socket.IO (`room:create` / `room:join`).
2. Both players are assigned `KICKER` or `KEEPER` roles by the server.
3. Each round: server emits `match:status` with the current phase. Both
   clients independently submit their pick (`match:pick`) — Lane `LEFT |
   CENTER | RIGHT` for the kicker; same three lanes for the keeper.
4. Server calls `resolveShot()` and emits `match:update` with the round
   result, then advances to the next round or emits `match:end` /
   `match:result` when the match concludes.
5. On `match:result` the server persists the outcome to `match_results`,
   runs player progression (`rank_points` delta), and optionally advances a
   tournament bracket.

### What the UI currently owns

- Rendering the pick buttons (lane selector).
- Playing a local CSS/DOM animation on shot result.
- Displaying scores, round counter, role indicator.
- Handling `match:stagingBegin` countdown.

### What the UI does NOT own

- Determining who won (server authority via `resolveShot`).
- Writing to `match_results`, `player_stats`, or `tournament_matches`.
- The pick timer (server-authoritative, emitted in `match:status`).
- Rank point math.

---

## 3. Target Unity Role

Unity (or a comparable 3-D engine such as Three.js / Babylon.js) is scoped
**exclusively** to the visual layer:

- Rendering the ball flight, goalkeeper dive, and goal/save animation.
- Crowd and pitch atmosphere during the staging countdown.
- Optional: animated player avatars or stadium environment.

Unity does **not**:

- Make pick decisions.
- Read from or write to Supabase directly.
- Manage Socket.IO connections.
- Handle authentication.
- Compute rank deltas or tournament advancement.

All of those remain on the existing Node.js realtime server and Supabase
backend.

---

## 4. Non-Negotiable Architecture Rule

> **The Node.js realtime server is the single source of truth for all match
> state. The 3-D renderer is a passive visual consumer.**

This rule must never be violated:

1. The Unity / 3-D layer receives shot outcomes from the existing
   `match:update` Socket.IO event. It plays the animation. It does not
   compute or predict the outcome.
2. Match picks are still submitted from the React shell via `match:pick`.
   Unity may render a pick UI widget embedded in the WebGL canvas, but the
   pick value must be forwarded to the React shell before it is emitted to
   the server — Unity cannot open its own Socket.IO connection.
3. Authentication tokens are owned by the React layer. Unity receives no
   JWT, no Supabase session, and no service role key.

---

## 5. Integration Options

Three technical integration paths are evaluated below.

### Option A — Unity WebGL embedded in an `<iframe>`

Unity is compiled to WebGL and served from a CDN or the same Vercel project.
The React shell loads the Unity build inside an `<iframe>` and communicates
via `window.postMessage`.

| | |
|---|---|
| **Pro** | Complete Unity feature set; richest 3-D graphics; familiar Unity editor workflow. |
| **Pro** | Renderer is fully isolated — a Unity crash cannot bring down the React shell. |
| **Con** | WebGL build sizes are large (typically 15–50 MB compressed). Initial load is slow. |
| **Con** | `postMessage` bridge requires strict origin validation on both sides. |
| **Con** | Cross-origin `<iframe>` complicates auth token passing (must never pass raw token into iframe). |
| **Con** | Mobile performance on mid-range Android devices is inconsistent with Unity WebGL. |

### Option B — Three.js / Babylon.js rendered inside React

A JavaScript 3-D library runs in the same React bundle. The canvas is mounted
in a React component alongside the existing game UI.

| | |
|---|---|
| **Pro** | No build size delta beyond the 3-D library (~600 KB gzipped for Three.js r165). |
| **Pro** | Direct access to React state; no bridge needed. |
| **Pro** | Best mobile performance of the three options. |
| **Con** | Requires 3-D authoring in code (no Unity editor). |
| **Con** | Limited to assets exportable as glTF/GLB; no Unity physics engine. |

### Option C — Native app (iOS / Android) with WebView fallback

Unity builds a native mobile app. The web platform becomes a fallback or
desktop-only experience.

| | |
|---|---|
| **Pro** | Maximum performance and visual fidelity on mobile. |
| **Con** | Requires separate app store releases; significantly higher scope. |
| **Con** | Breaks the current single-codebase model. |
| **Con** | Out of scope for a beta prototype. |

### Recommendation

Start with **Option A (Unity WebGL)** in a sandboxed feature-flagged prototype
(`NEXT_PUBLIC_UNITY_MATCH_ENABLED=true`). If load-size or mobile performance
proves unacceptable during the prototype, pivot to **Option B (Three.js)**
before shipping to users.

---

## 6. Recommended First Prototype

### Feature flag

Add one environment variable:

```
NEXT_PUBLIC_UNITY_MATCH_ENABLED=true   # default: not set / falsy
```

When the flag is falsy, the existing React DOM match page renders unchanged.
When truthy, the match page mounts the Unity WebGL `<iframe>` alongside (or
replacing) the current lane-picker UI. No other behaviour changes.

### Prototype scope (Unity side)

- Renders a single round: receives `match:update` payload → plays shot
  animation → signals "animation complete" back to React.
- Three scenes: GOAL (ball past keeper), SAVE (keeper blocks), and a neutral
  MISS (ball wide/over).
- No crowd, no stadium in the first spike — a flat pitch with goal posts and
  two stick-figure avatars is sufficient to validate the bridge.

### Prototype scope (React side)

- New component `MatchRenderer3D` — mounted only when
  `NEXT_PUBLIC_UNITY_MATCH_ENABLED` is truthy.
- Accepts the `match:update` event payload as a prop.
- Loads the Unity WebGL build from `NEXT_PUBLIC_UNITY_BUILD_URL` (CDN URL;
  not checked in to the repo).
- Returns a `Promise<void>` that resolves when the animation completes (used
  by the existing UI to know when to advance the score display).

### Non-goals for prototype

- No scoring UI changes.
- No pick UI inside Unity (picks stay in React DOM for the prototype).
- No persistent assets committed to the monorepo.

---

## 7. Event / Data Contract (React ↔ Unity)

The React shell and Unity communicate exclusively via `window.postMessage`.
The Unity WebGL build must set `document.domain` to the same origin and
validate `event.origin` on every message received.

### React → Unity (inbound to Unity)

All messages use the envelope:

```typescript
type UnityInbound = {
  type: "PENALTY444_MATCH_EVENT";
  event: "round_result" | "match_end" | "staging_begin" | "reset";
  payload: unknown;
};
```

**`round_result`** — sent after React receives `match:update` from the server.

```typescript
{
  type: "PENALTY444_MATCH_EVENT",
  event: "round_result",
  payload: {
    kickerLane: "LEFT" | "CENTER" | "RIGHT",
    keeperLane: "LEFT" | "CENTER" | "RIGHT",
    result: "GOAL" | "SAVE" | "DRAW",   // ShotResult from server
    scores: { [playerId: string]: number },
    round: number,
    maxRounds: number,
    phase: "NORMAL" | "SUDDEN_DEATH"
  }
}
```

**`match_end`** — sent after React receives `match:end`.

```typescript
{
  type: "PENALTY444_MATCH_EVENT",
  event: "match_end",
  payload: {
    winnerId: string | null,
    isDraw: boolean
  }
}
```

**`staging_begin`** — sent when React receives `match:stagingBegin`.

```typescript
{
  type: "PENALTY444_MATCH_EVENT",
  event: "staging_begin",
  payload: {
    startsAt: number   // ms epoch from server; Unity uses for drift-corrected countdown
  }
}
```

**`reset`** — sent on rematch or room reset; Unity returns to idle state.

```typescript
{
  type: "PENALTY444_MATCH_EVENT",
  event: "reset",
  payload: null
}
```

### Unity → React (outbound from Unity)

```typescript
type UnityOutbound = {
  type: "PENALTY444_UNITY_EVENT";
  event: "animation_complete" | "pick_selected" | "ready" | "error";
  payload: unknown;
};
```

**`animation_complete`** — Unity finished rendering the round animation.
React unblocks the score UI update.

```typescript
{ type: "PENALTY444_UNITY_EVENT", event: "animation_complete", payload: { round: number } }
```

**`pick_selected`** — if pick UI is ever delegated to Unity in a future phase.
React receives the lane choice and forwards it to the server via `match:pick`.
In the first prototype this event is not expected.

```typescript
{ type: "PENALTY444_UNITY_EVENT", event: "pick_selected", payload: { lane: "LEFT" | "CENTER" | "RIGHT" } }
```

**`ready`** — Unity WebGL bundle has loaded and initialised; React can begin
forwarding events.

```typescript
{ type: "PENALTY444_UNITY_EVENT", event: "ready", payload: null }
```

**`error`** — Unity encountered a runtime error.

```typescript
{ type: "PENALTY444_UNITY_EVENT", event: "error", payload: { message: string } }
```

### Timeout contract

React must not block indefinitely on `animation_complete`. If the event does
not arrive within **3 000 ms** of sending `round_result`, React assumes the
animation completed (fail-open) and advances the UI. This prevents a Unity
crash from freezing a live match.

---

## 8. Asset / Loading Plan

### What lives where

| Asset type | Location |
|---|---|
| Unity WebGL build (`.wasm`, `.data`, `.js`) | CDN (e.g. Supabase Storage public bucket or external CDN) — never committed to the monorepo |
| glTF/GLB character and environment assets | CDN |
| Audio (crowd ambient, ball kick, save) | CDN |

### Build URL env var

```
NEXT_PUBLIC_UNITY_BUILD_URL=https://<cdn>/unity-builds/penalty444-v0.1/
```

The React `MatchRenderer3D` component constructs paths as:
`${NEXT_PUBLIC_UNITY_BUILD_URL}Build/penalty444.loader.js`.

### Load strategy

1. The Unity loader is fetched **only after** both players are confirmed
   present and `match:stagingBegin` is received — not on page load.
2. A loading skeleton occupies the canvas area while the bundle fetches.
   The staging countdown (`STAGING_COUNTDOWN_MS`, currently 3 s) is the
   budget; if the bundle is not ready before the first pick window opens,
   the React shell falls back to the existing DOM renderer for that round.
3. Once loaded, the Unity bundle is cached in the browser (CDN cache headers
   with a long `max-age`). Subsequent rounds in the same session do not
   re-fetch.

### Size budget

Unity WebGL compressed target: **≤ 12 MB** for the first prototype spike.
Measured against a fast-3G throttle profile (1.5 Mbit/s download). If the
initial build exceeds 12 MB compressed, strip: post-processing stack,
high-poly meshes, all audio (use DOM Audio API instead), and the IL2CPP
metadata stripping must be set to `High`.

---

## 9. UX Fallback Plan

The 3-D renderer is strictly additive. Users on unsupported configurations
receive an identical match experience via the existing React DOM pick UI.

### Fallback triggers

| Condition | Behaviour |
|---|---|
| `NEXT_PUBLIC_UNITY_MATCH_ENABLED` not set or `false` | DOM renderer, no Unity code loaded |
| Unity bundle fails to load within 5 s | Log to console; render DOM fallback for entire match session |
| `animation_complete` not received within 3 s | Proceed; log `unity_timeout` metric |
| Unity emits `error` event | Unmount iframe; render DOM fallback; log `unity_error` |
| Device is detected as low-memory (`navigator.deviceMemory < 2`) | Skip Unity; render DOM fallback |
| User has `prefers-reduced-motion: reduce` | Skip Unity animations; render DOM fallback |

### No degraded state

There must be no in-between state where the Unity canvas is half-loaded and the
DOM UI is also partly visible with conflicting information. The transition is
binary: Unity is ready (and primary) or DOM is primary. The `MatchRenderer3D`
component owns this switch and must make it before the first pick window
begins.

---

## 10. Mobile Constraints

### Screen size

The Unity WebGL canvas must respond to the same viewport break-points used
across the app (`sm: 640px`, `lg: 1024px`). On screens below `sm`, the canvas
height must not exceed `56vw` (matches the current DOM pick area height).

### Performance floor

| Device class | Expected framerate | Action if below |
|---|---|---|
| iPhone 12+ / Pixel 6+ | 60 fps | Acceptable |
| Mid-range Android (≥ 2018, 4 GB RAM) | 30 fps | Acceptable for prototype |
| Low-end Android (< 2 GB RAM, `deviceMemory < 2`) | — | Force DOM fallback |

Do not profile Unity WebGL on iPhone with iOS < 15; WebAssembly support is
inconsistent.

### Touch input

If pick UI is ever moved into Unity, all interactive elements must have a
touch target of at least 44 × 44 CSS pixels (WCAG 2.5.5). The existing React
DOM buttons already meet this requirement.

### Battery / thermal

Unity WebGL runs the GPU continuously. The `MatchRenderer3D` component must
call `unityInstance.Quit()` when the match ends and the component unmounts to
release GPU resources. Leaving the WebGL context alive between matches on a
mobile browser causes thermal throttling.

---

## 11. Security / Auth Constraints

These rules are absolute and derive from the existing admin and auth hardening
work already in the platform.

1. **No auth token passes into the Unity iframe.** The React shell never
   includes `session.access_token`, `supabase_session`, or any Supabase
   credential in a `postMessage` to Unity.
2. **Unity makes no direct Supabase calls.** No Supabase SDK, no REST calls
   to `https://pwfgcblgjgoywefsotga.supabase.co`, no `SUPABASE_SERVICE_ROLE_KEY`
   referenced in any Unity C# code.
3. **Unity opens no Socket.IO connection.** All realtime communication goes
   through the existing React Socket.IO client (`lib/socket/client.ts`). Unity
   is a downstream consumer of events, not a peer on the socket.
4. **`postMessage` origin validation is mandatory.** The Unity WebGL bundle
   must validate `event.origin === window.location.origin` on every message
   received. The React shell must validate the `<iframe>` src origin on every
   Unity message received. Mismatched origins must be silently dropped.
5. **CDN assets are public, not authenticated.** Unity build files and 3-D
   assets are served from a public CDN bucket. No Supabase RLS applies to them.
   Do not embed any per-user data in the Unity build.
6. **No Supabase Storage writes from Unity.** Asset uploads (e.g. match
   replays, screenshots) are out of scope for all phases in this plan.
7. **Feature flag is client-readable.** `NEXT_PUBLIC_UNITY_MATCH_ENABLED` is
   safe to expose to browsers (it controls rendering only). It must never be
   confused with a security gate — it is a UX toggle, not an access control.

---

## 12. Rollout Phases

### Phase A — Internal prototype (current)

- Docs only (this document). No code.
- Unity team scopes the build. React team scopes `MatchRenderer3D` shell.
- Agreement on the event contract (Section 7) before any code is written.
- Deliverable: shared contract doc signed off by both teams.

### Phase B — Local spike (feature-flagged, no merge to master)

- `NEXT_PUBLIC_UNITY_MATCH_ENABLED=true` wired to a local `.env.local`.
- `MatchRenderer3D` stub component created at
  `apps/web/src/components/match/MatchRenderer3D.tsx` — renders a
  placeholder `<div>` when Unity build URL is not set.
- Unity WebGL POC build uploaded to a private CDN bucket.
- Goal: validate `postMessage` bridge round-trips in a real browser session.
- TypeScript must pass `npx tsc --noEmit` in `apps/web`.
- No merge to master until Phase C acceptance criteria pass.

### Phase C — Alpha (feature-flagged, merged to non-production branch)

- Full first-round animation: `round_result` → shot animation → `animation_complete`.
- Fallback triggers from Section 9 all exercised.
- Load-time measured on a simulated Fast 3G connection (Chrome DevTools
  Network throttle: 1.5 Mbit/s download, 750 Kbit/s upload, 40 ms RTT).
- Bundle size verified ≤ 12 MB compressed.
- No existing test suite failures (`npm run test` in `apps/web`).
- No `any` casts in the React bridge code without a comment explaining why.

### Phase D — Beta preview (opt-in for testers)

- Feature flag exposed as a toggle in `/account` settings, visible only to
  users who have completed placement matches (≥ `PLACEMENT_MATCHES_REQUIRED`).
- Staging + all-rounds animation working.
- `match:end` celebration scene for winner.
- DOM fallback confirmed working alongside the flag toggle.
- Pick UI remains in React DOM (Unity pick UI is Phase F).

### Phase E — Soft launch (default on for new users)

- `NEXT_PUBLIC_UNITY_MATCH_ENABLED` becomes the default for all new sessions.
- Existing users who previously opted out remain on DOM renderer.
- Monitoring: `unity_timeout`, `unity_error`, `unity_fallback_triggered` events
  tracked in analytics.

### Phase F — Full launch + pick UI delegation (optional)

- Pick lane selector rendered inside Unity canvas.
- `pick_selected` postMessage event forwarded by React to `match:pick` socket.
- React DOM pick buttons hidden when Unity is active and `ready`.
- Rollback plan: remove `NEXT_PUBLIC_UNITY_MATCH_ENABLED` to restore DOM.

---

## 13. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unity WebGL bundle exceeds 12 MB target | High | Medium | Strip audio, post-processing, IL2CPP metadata; measure early in Phase B |
| `postMessage` bridge introduces race conditions (e.g. `round_result` arrives before `ready`) | Medium | High | React queues all events until `ready` is received; Unity processes the queue on init |
| Unity freeze/crash blocks a live match | Medium | High | 3 s `animation_complete` timeout (Section 7); fallback to DOM mid-match if Unity emits `error` |
| Low-end mobile GPU crashes on WebGL context creation | High | Medium | `deviceMemory < 2` check forces DOM fallback before Unity loads |
| Unity C# developer adds direct Supabase calls | Low | Critical | Code review gate; Section 11 rules added to Unity CONTRIBUTING.md |
| `NEXT_PUBLIC_UNITY_BUILD_URL` points to a compromised CDN | Low | Critical | Pin CDN URLs to a hash or signed URL; add Subresource Integrity where Unity loader supports it |
| Staging countdown too short for Unity bundle to load | Medium | Medium | Unity loads lazily on `match:stagingBegin`; if not ready by first pick window, DOM fallback fires |
| Unity pick UI (Phase F) submits picks directly to socket | Low | Critical | Architecture rule (Section 4); enforced in code review |

---

## 14. Acceptance Criteria

A prototype is considered ready to merge to a non-production branch when ALL
of the following are true:

- [ ] `postMessage` bridge handles `round_result` → `animation_complete` round-trip in < 1 s on desktop Chrome.
- [ ] Fallback to DOM renderer activates automatically when Unity fails to load.
- [ ] Unity iframe never receives, logs, or stores a Supabase auth token.
- [ ] `npx tsc --noEmit` passes in `apps/web` with zero errors.
- [ ] Compressed Unity WebGL build ≤ 12 MB (measured with Brotli).
- [ ] All three shot outcomes (GOAL / SAVE / DRAW) play the correct animation.
- [ ] `unityInstance.Quit()` is called on component unmount (verified via DevTools memory snapshot showing GPU context released).
- [ ] DOM renderer renders an identical match flow when `NEXT_PUBLIC_UNITY_MATCH_ENABLED` is unset.
- [ ] No new TypeScript `any` casts in `MatchRenderer3D` or the bridge utility without a comment.
- [ ] The existing `apps/web` build (`npm run build`) succeeds without warnings introduced by the new code.

---

## 15. Open Questions

1. **Unity vs Three.js final call**: Is there a Unity license already held for
   the project, or would Three.js (Option B) be lower-friction for the first
   prototype? Decision needed before Phase B begins.

2. **CDN bucket**: Which CDN will host Unity build artifacts?
   Supabase Storage (public bucket), a dedicated object store (R2, S3), or
   a purpose-built CDN (Cloudflare Pages, Fastly)? Affects `NEXT_PUBLIC_UNITY_BUILD_URL`
   format and cache policy.

3. **`match:stagingBegin` timing**: The current staging countdown is
   `STAGING_COUNTDOWN_MS` (3 s). Is this a sufficient loading window for the
   Unity bundle on a slow connection, or should the staging duration be
   extended when `NEXT_PUBLIC_UNITY_MATCH_ENABLED` is true?

4. **Pick UI delegation timeline**: Section 6 defers pick UI to Phase F. Is
   there a desired beta milestone by which this must ship, or is Phase D
   (DOM picks + Unity animations) acceptable for the initial beta launch?

5. **Replay / highlight clips**: Some Unity integrations record a WebGL canvas
   stream for replay features. This is explicitly out of scope for all phases
   in this plan. If a replay feature is desired, it needs a separate security
   and storage review before being added to this plan.

6. **Accessibility**: The Unity canvas is not screen-reader accessible.
   If the DOM fallback is disabled for a user in Phase E/F, that user must
   still have a path to play. Policy decision needed: is the DOM fallback
   permanently available as an accessibility mode, or is Unity eventually
   required to support ARIA?
