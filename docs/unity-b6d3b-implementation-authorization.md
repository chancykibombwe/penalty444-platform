# B6D3B — IMPLEMENTATION AUTHORIZATION PACKAGE

> **Status: DOCUMENTATION, STATIC INSPECTION, SECURITY DESIGN, AND IMPLEMENTATION
> PLANNING ONLY.** This package authorizes **no** runtime code, no test, no route
> handler, no capability/session, no feature flag, no environment variable, no
> `next.config.ts` change, no `MatchRoomPanel.tsx` / `MatchRenderer3D.tsx` change,
> no Unity execution, no WebGL build, no real match, and no deployment. It is the
> pre-implementation authorization package required *before* any B6D3B runtime
> code may be written, and it ends with a GO / GO-WITH-CONDITIONS / HOLD
> recommendation (§24) for a **later, separately-authorized** B6D3B implementation
> PR. **B6D3B RUNTIME IMPLEMENTATION REMAINS NOT AUTHORIZED.**

Evidence labels: **[Verified]** (exists at the baseline SHA; cited by file/line or
manifest), **[Contract]** (stated in a merged design doc at the baseline SHA),
**[Proposed B6D3B]** (future design; not built here), **[Recommendation]**,
**[Blocker]** (must be cleared before implementation authorization). No file,
route, flag, or platform limit is invented; unverified platform limits are marked
as blockers requiring official-documentation verification.

---

## 1. Executive authorization decision

**[Recommendation] GO WITH CONDITIONS** to author a *separately-authorized* B6D3B
implementation, split into **two sequenced PRs** (security/delivery first, then the
high-sensitivity `MatchRoomPanel` integration), conditioned on clearing the
blockers in §23 — **chief among them the independent verification of Vercel/Next.js
route-handler response-size and streaming limits for the 8.19 MB `wasm.gz`
artifact** (§13).

Grounds:

- The presentation stack, B6D3A identity/correlation contracts, and the
  fail-open renderer already exist and are default-off; the merged B6D3B planning
  contract (`docs/unity-b6d3b-react-host-scope-risk-review.md`) fixes the host
  architecture, the single-renderer rule, the decorative-underlay boundary, the
  two-layer cohort model, and the protected-artifact contract. **[Verified/Contract]**
- The one materially unresolved *technical* question is whether a Next.js route
  handler can safely stream the largest artifact within platform limits; this
  package reviews it in detail and concludes **ROUTE PROXY FEASIBLE WITH
  CONDITIONS** (§13), with a named blocker for official-limit verification.

`MatchRoomPanel.tsx` is **HIGHEST sensitivity**. B6D3B/B6D3C/B6D3D remain **NOT
AUTHORIZED**; production remains **NO-GO**.

---

## 2. Scope and non-goals

**In scope:** independent review of the protected artifact proxy/streaming design;
the exact runtime architecture; the file-by-file change boundary; the automated
test matrix; branch/rollback/failure constraints; unresolved blockers; a
GO/CONDITIONS/HOLD recommendation. Exactly one new document (this file), plus an
optional minimal status/link note in the merged planning review.

**Non-goals (not done, not authorized here):** React runtime implementation;
`MatchRoomPanel`/`MatchRenderer3D` edits; test implementation; `package.json`
edits; route-handler/capability/session implementation; environment-variable
creation/configuration; deployment; preview configuration; Unity execution; WebGL
generation; real-match testing; player-facing Unity; production activation; any
change to runtime/test/server/route/middleware/Unity/`next.config.ts`/config files
or `ProjectSettings.asset`.

---

## 3. Exact baseline and repository state

- **Repository:** `chancykibombwe/penalty444-platform`; protected branch `master`.
- **`origin/master`:** `f9910f4ec3607452233790ebddefea6f9cb1ac46` (PR #214 merged
  — B6D3B planning review).
- **Branch:** `docs/unity-b6d3b-implementation-authorization`, worked in a
  **separate clean worktree** (`C:\Users\EL GADO\Desktop\penalty444-b6d3b-auth`),
  created from the exact `origin/master` above; confirmed clean before editing.
- **ProtectedSettings:** the remote PR carries **no** `ProjectSettings.asset`
  change; this clean worktree **did not touch** `ProjectSettings`; the main Windows
  checkout's pre-existing `ProjectSettings.asset` modification and all untracked
  files (`audit-artifacts/**`, `WebGLBuildRunner.cs`, `_Recovery/**`) remain
  **untouched** (no stash/reset/restore/clean/skip-worktree/assume-unchanged).

---

## 4. Accepted merged B6D3B contracts

From `docs/unity-b6d3b-react-host-scope-risk-review.md` (merged, **[Contract]**),
this package treats the following as accepted and builds the implementation plan on
them:

1. **Isolated `UnityPresentationHost`** that composes the existing
   `MatchRenderer3D` and consumes already-produced FIFO props.
2. **Fixed protected same-origin entry `/unity-arena/player`** (no id/capability in
   the URL; identity via sanitized Protocol v1 messages).
3. **Exactly one Unity renderer** — player-facing host **XOR** the secondary shadow
   iframe; one coordinator/instance/FIFO/ready/ack path.
4. **Decorative-underlay-only overlay** — controls **and** authoritative status/
   accessibility stay above Unity (incl. pick-locked/disconnect overlay).
5. **Two-layer cohort** — convenience boolean (not the boundary) + server-verified
   signed HttpOnly session enforcing the entry route **and** every artifact request.
6. **Protected artifact delivery contract** — server-validated, production-denied,
   traversal-safe, manifest-allowlisted, header-preserving, never the unauthenticated
   staging rewrite.
7. **Sanitized identity/correlation** consumed inside React; **no raw ids** cross
   into the host; Protocol v1 unchanged; no display labels to Unity; no Unity
   scoreboard.

---

## 5. Exact proposed runtime architecture

**[Proposed B6D3B]** End-to-end flow. "Exists" = present at baseline; "New" =
proposed. Raw ids permitted only where marked.

| # | Step | Owner | File | Inputs | Outputs | Trust boundary | State | Raw ids? | Failure behaviour |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Authoritative event | Node realtime server | `apps/realtime-server/**` | gameplay | `match:update`/`match:result`/`match:end` | server authority | Exists | server-internal | server-owned; unchanged |
| 2 | Match state | `MatchRoomPanel` | `MatchRoomPanel.tsx` | socket events | scores/round/phase/instance | React (trusted, id-bearing) | Exists | **Yes (internal)** | owns fail paths; unchanged |
| 3 | Presentation coordinator + Protocol v1 | `UnityPresentationShadowCoordinator` | `unityPresentationShadow.ts`, `unityPresentationProtocol.ts` | raw payloads | validated envelopes, FIFO dispatch, id-free audit | React (sanitizing) | Exists | ids→values only | null on malformed; no sequence consumed |
| 4 | Identity/correlation builder | `useViewerPresentation` (pure helper) | `useViewerPresentation.ts` | ids + scores + envelopes | sanitized `ViewerIdentityContext` + `CorrelationSummary` | **sanitization choke point** | **New** | **in only; discarded from output** | returns null/typed-reject; never throws |
| 5 | Sanitized host props | `MatchRoomPanel` → host | `MatchRoomPanel.tsx` | sanitized context + FIFO + gate booleans | host props | **id-free after here** | New (wiring) | **No** | gate false → React-only |
| 6 | Host lifecycle | `UnityPresentationHost` | `UnityPresentationHost.tsx` | sanitized props | visibility decision, callbacks | presentation-only | New | **No** | fail-open to decorative underlay |
| 7 | Exactly one renderer | `MatchRenderer3D` | `MatchRenderer3D.tsx` | FIFO messages | `postMessage`, ack callbacks | same-origin iframe bridge | Exists | **No** | `markUnavailable` (15 s / error) |
| 8 | Protected entry | entry route | `app/unity-arena/player/route.ts` | cohort session cookie | trusted entry HTML | **server session gate** | New | **No** | 404 if unauthorized / production |
| 9 | Protected artifact requests | artifact route | `app/api/unity-arena/artifact/[...path]/route.ts` | session cookie, path | streamed artifact bytes | **server session gate + manifest allowlist** | New | **No** | 404 unauthorized/traversal/unknown; 5xx upstream |
| 10 | Unity acknowledgement | Unity iframe → React | `MatchRenderer3D.tsx` (`validateUnityMessage`) | `ready`/`animation_complete`/`error` | callbacks | inbound allowlist | Exists | **No** | invalid → ignored |
| 11 | React fail-open | host + renderer | `UnityPresentationHost.tsx`, `MatchRenderer3D.tsx` | failure signal | hide Unity, show React underlay | presentation-only | New/Exists | **No** | no server call; match continues |

**Invariant:** the **only** place raw ids exist is steps 2–4 (inside React); from
step 5 onward everything is sanitized. Node/Socket.IO stays sole authority;
Protocol v1 wire shape is unchanged.

---

## 6. Exact MatchRoomPanel structural boundary

**[Verified] current JSX** (baseline `f9910f4e`):

- Main container `<div className="relative z-10 main-container …">` **`:3145-3159`**
  (decorative `screenEffect` classes).
- `match-container <section>` **`:3160-3169`** (decorative `impactResult` flash).
- Scoreboard: `<div className="shrink-0"><MatchScoreboard …/></div>` **`:3449-3464`**.
- Sudden-death banner `<section>` **`:3434-3447`**.
- Match-end/rematch/leave `<section>` **`:3466-3743`**.
- Play/arena `<section>` (`!matchEnded`) **`:3745-3877`** — decorative pitch dividers
  (`:3748`, `aria-hidden pointer-events-none`), **authoritative** pick-locked/
  disconnect overlay (`:3749-3765`, `aria-live`), pick-status headers, and the
  **interactive lane-button grid** (`:3837-3874`, `onClick={() => pick(lane)}`).
- Result/reveal `<section>` (`!matchEnded`) **`:3879-4007`** — **authoritative**
  result headline, reveal/tension countdown (`:3906-3918`), status text
  (`:3926-3947`), kicker/keeper cards (`aria-live`).
- Unity shadow secondary section **`:4025-4100`**, renderer at **`:4043-4051`**
  (`unityB6D2ShadowEnabled ? <MatchRenderer3D deliveryMode="fifo" …/> : <MatchRenderer3D …/>`).

**Smallest exact future diff [Proposed B6D3B]:**

- **Decorative nodes to extract** into a new relative wrapper (hideable beneath
  Unity): the pitch/lane-divider artwork (`:3748`) and any non-interactive
  cinematic/decorative effect layer. The decorative `screenEffect`/`impactResult`
  classes live on wrapping containers (`:3145-3169`); the extraction introduces a
  **dedicated decorative underlay layer** rather than moving those container
  classes.
- **Nodes that MUST stay outside/above** (never hidden): lane-button grid
  (`:3837-3874`), scoreboard (`:3449-3464`), timer, pick-locked/disconnect overlay
  (`:3749-3765`), reveal/tension countdown (`:3906-3918`), result/status text
  (`:3926-3947`), match-end/rematch/leave (`:3466-3743`), all `aria-live`/`role`.
- **Where `UnityPresentationHost` mounts:** inside the new decorative-underlay
  wrapper (arena visual region), **not** at `:4043-4051`.
- **Where the shadow branch currently mounts:** `:4043-4051` (secondary panel).
- **Player-facing XOR shadow branching (§8):** a single new boolean
  `playerFacingActive` selects **either** `<UnityPresentationHost …/>` in the arena
  wrapper (with the secondary shadow section suppressed) **or** the existing
  secondary shadow section unchanged — never both.
- **Reused state/callbacks:** `unityB6D2Pending`, `unityB6D2ActiveInstance`,
  `handleB6D2Ready`, `handleB6D2Error`, `handleB6D2Sent`, the coordinator ref
  (`:892-1006`, `:4043-4051`).
- **New props passed to the host:** see §7 (sanitized only).
- **Extract a small child component:** **[Recommendation] Yes** — extract the arena
  visual region into a small `MatchArenaViewport` (or wrap in the host's child
  slot) to keep the `MatchRoomPanel` diff minimal and reviewable; the host receives
  the decorative underlay as `children`.

**Explicitly prohibited changes** (must be byte-for-byte unchanged): socket
subscriptions; `pick()`; authoritative timers; reveal sequencing; score updates;
phase transitions; disconnect/reconnect; rematch; match end; abort logic.

---

## 7. UnityPresentationHost interface and lifecycle

**[Proposed B6D3B] props (design only, not implemented):**

```
interface UnityPresentationHostProps {
  playerFacingAuthorized: boolean;          // full gate result (flag+session+non-prod)
  matchInstanceId: string | null;           // protocol instance id (<ROOMCODE>:<N>) — not a player id
  messages: ReadonlyArray<{ id: string; message: PresentationEnvelope }>; // FIFO, sanitized
  identity: ViewerIdentityContext | null;   // sanitized (SELF/OPPONENT, LEFT/RIGHT) — no raw ids
  correlation: CorrelationSummary | null;   // sanitized score VALUES only
  onReady: () => void;
  onError: (reason: string) => void;
  onMessageSent: (summary: SentSummary) => void;
  children: React.ReactNode;                // React decorative underlay (hidden beneath Unity)
  testHooks?: { forceState?: HostState };   // optional, test-only
}
```

**The host must NEVER receive:** raw player ids, raw score-map keys, user email,
JWT/session/capability, the socket object, room secrets, or wallet/economy data.

**Lifecycle states/transitions:** `DISABLED` → (gate satisfied) `REACT_ONLY` →
(iframe mounted) `UNITY_LOADING` → (`ready`) `UNITY_READY_VISIBLE`; any failure at
any state → `UNITY_FAILED_REACT_FALLBACK`. New `matchInstanceId` resets to
`REACT_ONLY`/`UNITY_LOADING`. **Terminal failure per match instance:** after a
fatal Unity error, the host stays `UNITY_FAILED_REACT_FALLBACK` for the current
instance (mirror `markUnavailable` idempotency, `MatchRenderer3D.tsx:296-297`,
`:382`); recovery only on a new instance/reload. In every state the React
decorative underlay stays mounted; controls/status never hidden; Unity is
`aria-hidden` and receives no input.

---

## 8. Single-renderer mutual exclusion

**[Proposed B6D3B]** Exactly one iframe maximum. `playerFacingActive` is true iff
**all** of: the three shadow flags true; `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED`
true; cohort status boolean true; valid server session present; non-production;
artifact reachable. When true: mount **one** `UnityPresentationHost` and **suppress
the secondary shadow section** (`:4025-4100`). When false: render the existing
secondary shadow section **byte-for-byte** and no host.

### Decision table

| Shadow flags (all 3) | Player-facing flag | Cohort status | Valid session | Env | Artifact | Result |
|---|---|---|---|---|---|---|
| false | any | any | any | any | any | **React-only** (no iframe) |
| true | false | any | any | non-prod | any | **Shadow iframe** (existing) |
| true | true | false/err | any | non-prod | any | **Shadow iframe** (status≠grant; §10) |
| true | true | true | absent/invalid | non-prod | any | **Denied → React-only / shadow** (host not shown; fail-open) |
| true | true | true | valid | **production** | any | **Denied server-side (404) → React-only** |
| true | true | true | valid | non-prod | unavailable | **Player-facing host mounts → fail-open to React underlay** |
| true | true | true | valid | non-prod | available | **Player-facing host (one iframe); shadow suppressed** |
| false→any with player-facing but shadow off | — | — | — | — | — | player-facing requires all shadow flags too → otherwise React-only |

Never both renderers; one `postMessage` listener, one FIFO queue, one coordinator,
one sequence emitter, one ready lifecycle, one ack path (all already singletons in
`MatchRoomPanel`/`MatchRenderer3D`).

---

## 9. Sanitized identity and correlation dataflow

**[Proposed B6D3B]** helper `apps/web/src/components/match/useViewerPresentation.ts`.

- **Recommendation: a pure helper, not a React hook**, if the only state needed is
  "last accepted sanitized `round_result`". That can be held by the existing
  `MatchRoomPanel` refs and passed in, keeping the helper pure and trivially
  unit-testable. Use a hook only if it must own the last-result ref itself.
- **Input contract:** `{ matchInstanceId, viewerPlayerId, scores, kickerPlayerId?,
  keeperPlayerId?, winnerPlayerId?, isDraw?, displayNames?, lastResultEnvelope?,
  stateSyncEnvelope? }` (id-bearing; consumed only).
- **Output contract:** `{ identity: ViewerIdentityContext | null, correlation:
  CorrelationSummary | null }` — **no raw ids**.
- Uses `buildViewerIdentityContext(...)` (`unityPresentationIdentity.ts:196-290`)
  and `correlateResultToStateSync(...)` (`unityPresentationCorrelation.ts:110-168`)
  — **consumed, never duplicated**.
- **Last accepted result storage:** store the last sanitized `round_result` per
  instance; on a new `match_state_sync`, correlate.
- **Correlation rules:** accept equal-round terminal (delta 0) and next-round
  continuation (delta 1); reject stale/duplicate, foreign-instance,
  invalid-round-order; reset on new `matchInstanceId`; only `match_state_sync` is
  score-bearing.
- **No raw-id output** — verified by tests that `JSON.stringify` of the outputs
  contains none of the input ids; legacy raw `winnerId`
  (`MatchRoomPanel.tsx:278-301`) is never used on this path.

---

## 10. Player-facing flag and cohort decision flow

**[Proposed B6D3B]** `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED`:

- **build/UX gate only**, default false; **not** a security boundary.
- The three existing shadow flags are **also** required.
- The **server session is the enforcement boundary** (§11); the
  `/api/unity-cohort/status` boolean is convenience only — false/error/unavailable
  ⇒ React-only.
- Browser tampering (flags, localStorage, query params, intercepted responses)
  **cannot** load protected resources (server denies).
- Disabling any one flag returns all users to React.
- **No flag is created or configured in this task.**

---

## 11. Server session/capability design

**[Recommendation] — designed, not implemented.** Selected bounded model:

- **Mint endpoint:** `POST /api/unity-cohort/session` — verifies a **Supabase
  bearer access token** server-side via `admin.auth.getUser(token)` (the audited
  pattern in `app/api/admin/me/route.ts:26-57`), checks a **server-only allowlist**
  (e.g. `UNITY_COHORT_EMAILS`, mirroring `ADMIN_EMAILS`), and on success sets a
  **short-lived signed HttpOnly Secure SameSite cookie**.
- **Status endpoint:** `GET /api/unity-cohort/status` → `{ inCohort: boolean }`
  (convenience only).
- **Cookie:** name `p444_unity_cohort` (proposed); value = compact signed token
  (payload: `sub` hash or opaque id, `exp`, `iat`, `ver`); **HttpOnly; Secure;
  SameSite=Lax (or Strict); Path=/unity-arena and /api/unity-arena; no Domain
  widening.** **Never** in URL or browser-readable storage.
- **Signing:** **Node `crypto` HMAC-SHA-256** (no new dependency) over the payload
  with a **server-only secret** `UNITY_COHORT_SIGNING_SECRET`; constant-time
  compare on verify. (Web Crypto `subtle.sign` HMAC is an acceptable alternative;
  prefer whichever the route runtime supports without a dependency.)
- **TTL:** short (proposed **10–15 minutes**); the client re-mints as needed;
  short expiry bounds revocation latency.
- **Env vars (server-only, names proposed, not configured here):**
  `UNITY_COHORT_EMAILS`, `UNITY_COHORT_SIGNING_SECRET`; reuse
  `SUPABASE_SERVICE_ROLE_KEY` (via `createAdminClient`) and `VERCEL_ENV`.
- **Production:** **never mints**; mint + entry + artifact all return 404 when
  `VERCEL_ENV === "production"`.
- **CSRF:** mint is a POST authorized by the **bearer token** (not ambient cookie),
  so it is not CSRF-forgeable; the cookie is used only for **GET** reads of same-
  origin protected resources; `SameSite` further limits cross-site sends.
- **Revocation:** remove from allowlist (verified on protected requests where
  practical — see below) and/or rotate `UNITY_COHORT_SIGNING_SECRET`; short TTL
  bounds exposure.
- **Allowlist recheck:** where practical, protected **entry** requests re-verify
  current allowlist membership (cheap); per-**artifact** request re-check may be
  skipped for performance and instead bounded by the short cookie TTL — this
  trade-off must be decided at implementation review.
- **Logout/expiry:** clear cookie; expired cookie ⇒ 404 on protected resources ⇒
  client falls open to React.
- **Errors:** unauthenticated/not-allowlisted/expired/invalid ⇒ **404** (not 401/403)
  to avoid confirming the feature's existence, matching the staging `notFound()`
  posture.

**Local-dev caveat [Verified]:** `createAdminClient` requires
`SUPABASE_SERVICE_ROLE_KEY`, which is **absent locally** (root `AGENTS.md`); mint
then fails ⇒ deny ⇒ React-only. Acceptable and safe.

**Tests:** see §16 (Session).

---

## 12. Protected Unity entry route

**[Proposed B6D3B]** `apps/web/src/app/unity-arena/player/route.ts`.

**Chosen behaviour: construct/stream a minimal trusted entry HTML** that references
**only protected same-origin artifact URLs** under `/api/unity-arena/artifact/...`
and boots the Unity loader (the Unity `index.html` template is small — **5,669
bytes [Verified]** — so a minimal trusted loader HTML is straightforward and avoids
proxying the template's relative URLs). The route:

- validates the signed HttpOnly session (§11); **404** when absent/invalid/expired;
- **404** when `VERCEL_ENV === "production"`;
- uses **no** `roomCode`/user info in the URL and **no** capability query string;
- references only protected same-origin artifact URLs; **never** exposes the
  upstream origin;
- sets security + cache headers: `X-Frame-Options: SAMEORIGIN` (same-origin iframe),
  `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` for the
  entry HTML (it embeds session-scoped URLs), `Content-Type: text/html`;
- runs on the **nodejs runtime** (`export const runtime = "nodejs"`), consistent
  with `admin/me`.

Match identity continues via sanitized Protocol v1 `postMessage`, preserving the
renderer's existing same-origin checks (`MatchRenderer3D.tsx:374-375`).
`NEXT_PUBLIC_UNITY_BUILD_URL` may later be set to `/unity-arena/player` in an
authorized preview phase (not configured here), so `MatchRenderer3D` needs **no**
URL-selection change.

---

## 13. Protected artifact proxy and streaming review (independent)

**This is the principal independent review.** Route:
`apps/web/src/app/api/unity-arena/artifact/[...path]/route.ts`.

### 13.1 Repository-verified artifact facts (manifest `schemaVersion:1`)

| File | Bytes | contentEncoding |
|---|---:|---|
| `Build/*.wasm.gz` | **8,583,356** (8.19 MB) | gzip |
| `Build/*.data.gz` | 1,866,605 (1.78 MB) | gzip |
| `Build/*.framework.js.gz` | 88,984 | gzip |
| `Build/*.loader.js` | 26,982 | identity |
| `index.html` | 5,669 | identity |
| `TemplateData/*` (12 files: png/ico/css) | 74–3,077 each | identity |
| **Total** | **10,585,492** (17 files) | — |

The manifest (`files[]{path, bytes, sha256, contentEncoding}`) is the **immutable
allowlist**. `next.config.ts` (STAGING_HEADER_RULES `:121-160`) shows the required
serving headers: `.framework.js.gz`→`application/javascript`+`Content-Encoding: gzip`;
`.wasm.gz`→`application/wasm`+gzip; `.data.gz`→`application/octet-stream`+gzip;
`.loader.js`→identity JS.

### 13.2 Required contract (per merged review + this analysis)

Validate session server-side on **every** request; deny absent/invalid/expired/
revoked; **404 in production**; **never** accept a capability via query string;
**never** expose the upstream origin; **reject** `..`, decoded/double-encoded
traversal, absolute paths, and unknown files; **serve only manifest-allowlisted
paths** (exact path + expected `contentEncoding` from the manifest); preserve
`Content-Type`, `Content-Encoding`, `Content-Length`, `ETag`, `Cache-Control`
(`public, max-age=31536000, immutable` for immutable artifacts, but behind the
session gate consider `private`), `Accept-Ranges`; **forward Range** and return
`206`/`Content-Range` where the loader requires it; support `HEAD`; handle upstream
timeout/abort; reject upstream redirects; enforce a max file size; **never** fall
back to the unauthenticated staging rewrite.

### 13.3 Platform-limit analysis (the crux)

- **Largest body = 8.19 MB `wasm.gz`.** Next.js route handlers on Vercel run as
  functions; historically Vercel documented a **response body cap around ~4.5 MB
  for buffered function responses**, with **streaming** responses able to exceed
  that. A route that **`fetch()`es the upstream and returns `response.body`
  (a `ReadableStream`) directly** streams through without buffering the whole 8.19
  MB in memory, which is the correct pattern and likely stays within limits — **but
  the exact current Vercel limit and its interaction with streamed proxies must be
  verified against official documentation and measured on a preview**, not assumed.
- **Runtime must be `nodejs`** (`export const runtime = "nodejs"`), not edge, for
  predictable streaming + larger limits + `crypto`.
- **Content-Encoding correctness:** the `.gz` files are **pre-compressed**. The
  route must pass bytes through **verbatim** and set `Content-Encoding: gzip`
  explicitly, and must **prevent the platform from re-compressing or stripping**
  the encoding (double-compression would corrupt Unity). `Content-Length` should
  reflect the compressed bytes; if streaming with an unknown length, omit
  `Content-Length` and rely on chunked transfer.
- **Range/streaming:** Unity's default loader uses `fetch()` for the whole file
  (not necessarily Range), but `instantiateStreaming` needs `Content-Type:
  application/wasm`. Range support is defensive; forward it if present.
- **Execution time:** streaming a ~10 MB total is well within function duration on
  a fast upstream; verify on preview.

### 13.4 Conclusion

**ROUTE PROXY FEASIBLE WITH CONDITIONS (option 2).** Conditions:

1. **nodejs runtime**, streamed pass-through (`return new Response(upstream.body,
   …)`), no whole-body buffering.
2. **Explicit `Content-Encoding: gzip` + correct `Content-Type`** per file; **no
   platform re-compression** of already-gzip bodies (verify Vercel does not alter
   `Content-Encoding` on streamed proxies).
3. **[Blocker] Verify current Vercel/Next.js function response-size and streaming
   limits against official documentation and by measurement on a protected preview
   for the 8.19 MB `wasm.gz`** before implementation authorization. If a buffered
   cap applies to streamed proxies and is below ~8.2 MB, fall back to the
   alternative below.

**Secure alternative if limits are exceeded [Recommendation, contingency]:**
server-mint a **short-lived signed same-origin token bound to an HttpOnly cookie**
and serve artifacts via a **same-origin reverse proxy / CDN in front of Next.js**
(or Vercel rewrite gated by an edge check), such that: no capability appears in a
query string where avoidable (prefer the cookie); cohort self-selection is
impossible; production is denied; **no permanently public artifact URL** exists
(URLs are session/token-scoped and short-lived); and same-origin `postMessage`
assumptions are preserved (or a minimal renderer change is defined). Signed CDN/
object-storage URLs are a further fallback but risk a shareable URL, so they must
be short-lived and, ideally, cookie-bound.

**Platform limits are marked as a [Blocker] requiring official-documentation
verification/measurement in a later authorized research step; this package does not
guess them.**

---

## 14. Security and privacy controls

- **Same-origin postMessage** preserved (`MatchRenderer3D.tsx:332`, `:355`,
  `:374-375`); inbound allowlist `ready|animation_complete|error` (`:132-164`).
- **No raw ids past step 5** (§5, §9); host props id-free; legacy raw `winnerId`
  never used player-facing.
- **Session cookie:** HttpOnly, Secure, SameSite, Path-scoped, signed, short TTL;
  never in URL/logs (§11).
- **Artifact route:** manifest allowlist, traversal-safe, upstream-origin-secret,
  header-correct, session-gated, production-denied (§13).
- **Production hard-block:** server-side via `VERCEL_ENV` at mint/entry/artifact.
- **Headers:** global `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy` (`next.config.ts:30-48`); entry relaxes framing to
  `SAMEORIGIN` for its path only. **CSP is intentionally omitted globally**
  (`next.config.ts:19-23`); a scoped CSP for the entry route is a **separately
  reviewed hardening** item, not a B6D3B blocker unless implementation shows a need.
- **Iframe input isolation:** host applies `pointer-events:none` + `inert` + focus
  exclusion; Unity `aria-hidden`; renderer security-prop change only if host-side
  isolation cannot be proven.
- **No wallet/economy, no auth token, no socket** cross the boundary.

---

## 15. Exact implementation file list

**New:** `apps/web/src/components/match/UnityPresentationHost.tsx`;
`apps/web/src/components/match/UnityPresentationHost.test.tsx`;
`apps/web/src/components/match/useViewerPresentation.ts` (+ `.test.ts`);
`apps/web/src/app/api/unity-cohort/status/route.ts` (+ test);
`apps/web/src/app/api/unity-cohort/session/route.ts` (+ test);
`apps/web/src/lib/unity-cohort/capability.ts` (+ test);
`apps/web/src/app/unity-arena/player/route.ts` (+ test);
`apps/web/src/app/api/unity-arena/artifact/[...path]/route.ts` (+ test);
optionally `apps/web/src/components/match/MatchArenaViewport.tsx` (small extraction).

**Minimal modification:** `apps/web/src/components/match/MatchRoomPanel.tsx`
(decorative-underlay extraction + single-renderer XOR branch + sanitized host props;
**no** authority change); `apps/web/package.json` (register new tests in
`test:unity-presentation` — script only, no dependency/lockfile change).

**Conditional modification:** `apps/web/src/components/match/MatchRenderer3D.tsx`
(only if host-side input/focus isolation cannot be proven — isolation prop only,
not URL).

**Inspect only:** `unityPresentationIdentity.ts`, `unityPresentationCorrelation.ts`,
`unityPresentationProtocol.ts`, `unityPresentationAdapter.ts`,
`unityPresentationShadow.ts`, `app/dev/unity-staging/**`, `next.config.ts`,
`apps/realtime-server/**`, `packages/shared/**`, Unity files.

**Prohibited:** Unity `ProjectSettings`; Unity C#; generated WebGL; realtime
authority; Protocol v1 changes; database schema; wallet/economy; production config;
environment configuration; lockfiles; `next.config.ts` edits; `audit-artifacts/**`.

---

## 16. Exact test file list and matrix

New test files accompany each new module (colocated `*.test.ts(x)`), registered in
`test:unity-presentation` (`apps/web/package.json:13`).

- **Host** (`UnityPresentationHost.test.tsx`): each state transition; React
  underlay stays mounted; controls/status unaffected; readiness-timeout/error →
  fallback; fatal failure terminal per instance; new-instance reset; hidden/failed
  iframe cannot receive pointer/keyboard focus; exactly one iframe.
- **Mutual exclusion:** shadow-only mode = one iframe; player-facing mode = one
  iframe; never both; one ready callback per lifecycle; each dispatch sent at most
  once; one queue/coordinator.
- **Identity** (`useViewerPresentation.test.ts`): host props contain no raw ids; no
  legacy `winnerId`; correct SELF/OPPONENT→LEFT/RIGHT; new-instance reset;
  correlation accepted (terminal/continuation) and rejected (stale/duplicate/
  foreign/invalid-round-order).
- **Session** (`session.route.test.ts`, `capability.test.ts`): unauthenticated →
  404; invalid JWT → 404; not allowlisted → 404; allowlisted → mints cookie;
  production → 404 (no mint); expiry → 404 on protected reads; tampered cookie →
  reject; revocation (allowlist removal / secret rotation) → deny; cookie attrs
  (HttpOnly/Secure/SameSite/Path); no token in logs or URLs.
- **Entry** (`player.route.test.ts`): no session → 404; expired → 404; production →
  404; authorized → trusted HTML referencing only protected artifact URLs; security
  headers present.
- **Artifact** (`artifact.route.test.ts`): no/invalid/expired session → 404;
  production → 404; `..`/encoded/double-encoded traversal → 404; absolute path →
  404; unknown/non-manifest file → 404; allowlisted files served; correct
  `Content-Type`/`Content-Encoding`; `HEAD`; Range/`206`/`Content-Range`;
  `ETag`/`Cache-Control`; upstream timeout → 5xx; abort handling; upstream redirect
  rejected; no upstream-origin leakage in headers/body.
- **Regression:** existing **226** Unity-presentation tests remain green;
  `tsc --noEmit`; `next build`; realtime `build`; no duplicate socket listeners; no
  duplicate timers; no Protocol v1 wire change.

---

## 17. Build and regression validation

Before the implementation PR is considered mergeable (later, separate
authorization): `cd apps/web && npm run test:unity-presentation` (226 + new tests
green); `npx tsc --noEmit -p apps/web/tsconfig.json`; `next build`
(Turbopack/CI placeholders); realtime `npm run build`. CI (`.github/workflows/ci.yml`)
runs test → tsc → next build for web and build for realtime (lint is not a gate).
No lockfile change; no dependency added (crypto is built-in).

---

## 18. Rollback and kill-switch procedure

- **Immediate React-only rollback:** disable `NEXT_PUBLIC_UNITY_PLAYER_FACING_ENABLED`
  (or any of the three shadow flags) → every session reverts to React; the
  single-renderer branch falls to the shadow/React path.
- **Server-side denial:** stop minting sessions (unset the allowlist / disable the
  mint route) → no new sessions; existing sessions expire within the short TTL.
- **Session expiry:** short TTL bounds exposure without action.
- **Artifact/entry denial:** rotate `UNITY_COHORT_SIGNING_SECRET` → all existing
  cookies invalid → entry/artifact 404 → fail-open to React.
- **No dependence on realtime-server changes; no data migration; no Unity rebuild;
  no ProjectSettings change.** Existing shadow behaviour is retained byte-for-byte
  when the player-facing gate is false.

---

## 19. Performance and accessibility requirements

- Readiness timeout reuses `15_000` ms (`MatchRenderer3D.tsx:187`); fallback is
  instantaneous (decorative underlay pre-mounted/hidden; no refetch).
- Artifact ≈ **10.59 MB** total (**8.19 MB** wasm) → measure load/FPS/memory on a
  device matrix (desktop Chrome/Edge, Android Chrome, iOS Safari) in B6D3D; below a
  budget ⇒ React only.
- **100% React interaction availability**; no layout shift of controls/timer/
  scoreboard/status when Unity reveals/hides.
- Respect `prefers-reduced-motion`; keep `role="status"`/`aria-live` mounted and
  exposed while Unity is `aria-hidden`; hidden decorative layer is `inert`/not
  focusable; keyboard/focus ownership stays with visible React controls.
- No claim that player-facing performance has been measured (it has not).

---

## 20. Risk register

| # | Risk | Lk | Impact | Mitigation | Evidence | Clears in | Blocking |
|---|---|---|---|---|---|---|---|
| 1 | **Vercel/Next response-size or streaming limit blocks 8.19 MB wasm proxy** | Med | Critical | streamed nodejs pass-through; contingency CDN/token (§13.4) | official docs + preview measurement | pre-B6D3B research | **Yes [Blocker]** |
| 2 | Platform re-compresses/strips `Content-Encoding` on gz bodies | Med | High | explicit headers; verify no re-encode; tests | preview measurement | B6D3B/C | **Yes** |
| 3 | Traversal / encoded / unknown-file access | Med | Critical | manifest allowlist + normalization + reject `..`/encoded/absolute | artifact tests | B6D3B | **Yes** |
| 4 | Capability/token in URL or logs | Med | Critical | HttpOnly cookie; never query string; never logged | session/artifact tests | B6D3B | **Yes** |
| 5 | Client tampers cohort boolean → grants Unity | Med | Critical | boolean convenience-only; server session enforces | session tests | B6D3B | **Yes** |
| 6 | Direct artifact URL without session | Med | Critical | session-gated route; not the rewrite | artifact tests | B6D3B | **Yes** |
| 7 | Production returns 200 for protected resource | Low | Critical | `VERCEL_ENV` deny at mint/entry/artifact | prod 404 capture | every subphase | **Yes** |
| 8 | Simultaneous shadow + player-facing iframes | Med | High | XOR branch; one iframe | mutual-exclusion tests | B6D3B | **Yes** |
| 9 | Duplicate ready/message/ack lifecycles | Med | High | one coordinator/queue/ready/ack | tests | B6D3B | **Yes** |
| 10 | Disconnect/authoritative status hidden beneath Unity | Med | Critical | status/controls above; only decorative hidden (§6) | host tests | B6D3B | **Yes** |
| 11 | Raw ids cross into host | Low | Critical | sanitized props; id-free assertions | leakage tests | B6D3B | **Yes** |
| 12 | Host mounted in wrong subtree | Med | High | mount inside extracted decorative wrapper | snapshot/code review | B6D3B | **Yes** |
| 13 | iframe receives pointer/keyboard focus | Med | High | `pointer-events:none`+`inert`+focus exclusion; renderer prop if needed | isolation tests | B6D3B | **Yes** |
| 14 | Session leak/replay/expiry mishandling | Med | High | short TTL; signed HttpOnly; verify per request | session tests | B6D3B | **Yes** |
| 15 | `MatchRoomPanel` regression | Med | Critical | smallest additive extraction; line-by-line review; full match matrix | regression suite | B6D3B/D | Managed |
| 16 | Upstream origin leakage | Low | High | never echo upstream headers/origin | artifact tests | B6D3B | Managed |
| 17 | Local dev has no service-role key | Known | Low | deny ⇒ React-only (safe) | root AGENTS.md | B6D3B | Non-blocking |
| 18 | Artifact reproducibility | Known | Med | immutable versioned artifacts | manifest sha256 | B6D3E | BLOCKED (non-blocking B6D3B) |
| 19 | No real-match evidence | Known | High | B6D3D real-match proof | later | B6D3D | Non-blocking B6D3B |

---

## 21. Implementation sequencing

**[Recommendation] Split into two PRs** to isolate the security/delivery layer from
the high-sensitivity `MatchRoomPanel` integration:

**PR-1 (security + delivery, no `MatchRoomPanel` change):**
1. pure capability/session helpers + tests;
2. `status` + `session` routes + tests;
3. protected `entry` + `artifact` routes + tests;
4. **independent proxy/streaming validation on a protected preview (clears Blocker
   §13/§23-1)**.

**PR-2 (React integration):**
5. pure `useViewerPresentation` helper + tests;
6. `UnityPresentationHost` + tests;
7. bounded `MatchRoomPanel` decorative extraction + XOR branch + sanitized props;
8. full regression suite;
9. draft implementation PR(s) → independent review.

B6D3C (protected-preview mock/runtime proof) and B6D3D (real match) remain
separately authorized.

---

## 22. Authorization gates

Before **B6D3B implementation** authorization: this package reviewed/merged; **§23
blockers cleared** (esp. the artifact-limit verification); server session/capability
design approved; fixed entry + protected artifact contract approved; single-renderer
XOR rule approved; decorative-underlay/status boundary approved; exact
`MatchRoomPanel` diff boundary approved; sanitized identity/correlation flow
approved; iframe isolation approach approved; complete test matrix approved; no
unresolved critical risk.

Before **B6D3C**: implementation merged; 226+ new tests green; `tsc`/`next build`/
realtime build green; protected preview available; deterministic mock procedure
approved; no real match.

Before **B6D3D**: B6D3C passed; separate explicit real-match authorization;
internal free-play accounts only; rollback rehearsed; production NO-GO.

Standing gates: B6D2B/B6D3A/B6D3B-planning merged and stable; master CI green;
production Unity off; `NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED` UNCONFIGURED.

---

## 23. Remaining blockers

1. **[Blocker] Vercel/Next.js function response-size + streaming limits for the
   8.19 MB `wasm.gz`** must be verified against official documentation and measured
   on a protected preview (§13.3–§13.4). If exceeded, adopt the §13.4 contingency.
2. **[Blocker] `Content-Encoding` pass-through** (no platform re-compression of
   pre-gzip artifacts) must be confirmed on preview (§13.3).
3. Server session/capability design approval, incl. env-var names, TTL, cookie
   attributes, and allowlist-recheck-per-artifact trade-off (§11).
4. Exact `MatchRoomPanel` decorative-extraction + XOR diff approval (§6) — HIGHEST
   sensitivity.
5. Iframe pointer/focus/`inert` isolation proof (host-side vs. renderer prop) (§14).
6. Complete test matrix approval (§16).
7. (B6D3D only) real-match evidence + separate authorization.
8. (B6D3E only) artifact reproducibility remains BLOCKED.

---

## 24. Final recommendation

**GO WITH CONDITIONS** for a separately-authorized B6D3B implementation, delivered
as **two sequenced PRs** (security/delivery, then `MatchRoomPanel` integration),
**conditioned on** clearing every §23 blocker — above all the **independent
verification/measurement of Vercel/Next.js response-size and streaming limits for
the 8.19 MB `wasm.gz` artifact and correct `Content-Encoding` pass-through** (§13),
plus approval of the server session/capability design, the exact `MatchRoomPanel`
diff boundary, iframe input isolation, and the full test matrix. The artifact proxy
is judged **ROUTE PROXY FEASIBLE WITH CONDITIONS**; a bounded CDN/token contingency
is defined if platform limits are exceeded.

**A GO here does not authorize implementation.** No runtime code, route, capability,
flag, environment, deployment, Unity run, or real match is authorized by this
document. B6D3B implementation remains **NOT AUTHORIZED**; B6D3C and B6D3D remain
**NOT AUTHORIZED**; production remains **NO-GO**.

---

## 25. Final authorization status

```
B6D3A IMPLEMENTATION: COMPLETE AND LOCKED
B6D3B PLANNING REVIEW: COMPLETE AND LOCKED
B6D3B AUTHORIZATION PACKAGE: COMPLETE / IN REVIEW
B6D3B RUNTIME IMPLEMENTATION: NOT AUTHORIZED
B6D3C PROTECTED-PREVIEW PROOF: NOT AUTHORIZED
B6D3D REAL-MATCH UNITY TESTING: NOT AUTHORIZED
PLAYER-FACING UNITY: NOT AUTHORIZED
PRODUCTION UNITY: NO-GO
NEXT_PUBLIC_UNITY_B6D2_SHADOW_ENABLED: UNCONFIGURED
```

This package changed no runtime code, no test, no Protocol v1 wire shape, no
feature flag, no environment, no server/route/middleware, no `next.config.ts`, and
no Unity file; it ran no Unity, no real match, and no deployment. `MatchRoomPanel.tsx`,
`MatchRenderer3D.tsx`, and
`unity/Penalty444Client/ProjectSettings/ProjectSettings.asset` were untouched.
