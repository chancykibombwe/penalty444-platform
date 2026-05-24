# Runtime Security Posture

> Hardening Sprint 5. Single page describing the runtime configuration
> the platform expects in production. Companion to
> `docs/security/npm-audit-report.md` and the Sprint 1–4 sprint
> checklists.

## Component overview

```
                ┌──────────────────────────┐
                │   Browser (anon / auth)   │
                └────────────┬──────────────┘
                             │ HTTPS + Origin: <allow-listed>
                             ▼
              ┌──────────────────────────────┐
              │   Next.js web app (Vercel)   │
              │   Sec headers (Sprint 5 §3)  │
              │   /api/* Bearer-authed       │
              └────────────┬─────────────────┘
                           │ wss + Origin
                           ▼
              ┌──────────────────────────────┐
              │   Realtime server (Node)     │
              │   CORS allow-list (TASK 3)   │
              │   Socket JWT check           │
              │   /internal/* secret-gated   │
              └────────────┬─────────────────┘
                           │ service-role JWT
                           ▼
                ┌──────────────────────────┐
                │      Supabase / RLS       │
                └──────────────────────────┘
```

Each arrow has at least one explicit security boundary. Sprint 5 closes
the runtime-config gaps that previous sprints intentionally left for
later.

## 1. Dependency posture

* `apps/web`: was 5 vulnerabilities (1 high + 4 moderate) → **2
  moderate** after Sprint 5. Both remaining are `postcss <8.5.10` reached
  through `next`; the official fix downgrades next to 9.x and is not
  acceptable. Tracked in `docs/security/npm-audit-report.md`.
* `apps/realtime-server`: was 6 moderate → **0**. All transitive `qs` /
  `ws` vulnerabilities resolved by plain `npm audit fix`.
* CI / Dependabot: re-check 24h after merge to confirm GitHub's
  vulnerability count (currently >80 on master) drops.

`npm audit fix --force` is forbidden without explicit review. Any PR
that wants to run it must update `npm-audit-report.md` and prove the
build still passes.

## 2. CORS / origin policy (`apps/realtime-server/src/config/origins.ts`)

Modes:

| Mode | Allow-list source | Wildcard? | Localhost? |
| --- | --- | --- | --- |
| `NODE_ENV !== "production"` | `ALLOWED_ORIGINS` csv ∪ `localhost:3000`, `localhost:4000`, `127.0.0.1:3000`, `127.0.0.1:4000` | no | yes |
| `NODE_ENV === "production"` | `ALLOWED_ORIGINS` csv only | no | no |

Production with empty `ALLOWED_ORIGINS` is a startup-fatal condition
(see env validation below). The validator is shared between the
express `cors()` middleware and Socket.IO's `cors.origin` callback so
HTTP and WebSocket pass through identical policy.

Rejection log line:

```
[Security] CORS origin rejected origin=<value> mode=<dev|prod>
```

Same-origin and `Origin: undefined` requests (curl, server-to-server
internal callers) are accepted because the internal-secret guard is
the real gate for sensitive endpoints — origin alone cannot be
trusted.

### Setting `ALLOWED_ORIGINS` for production

Set as a comma-separated string with no spaces:

```bash
ALLOWED_ORIGINS=https://444arena.com,https://www.444arena.com,https://staging.444arena.com
```

For Vercel preview domains, prefer adding the deployment URL pattern
to a server-side allow-list manager (a future sprint) rather than
loosening the regex here.

## 3. Web security headers (`apps/web/next.config.ts`)

Always emitted (dev + prod):

* `X-Frame-Options: DENY`
* `X-Content-Type-Options: nosniff`
* `Referrer-Policy: strict-origin-when-cross-origin`
* `Permissions-Policy: camera=(), microphone=(), geolocation=(),
  payment=(), usb=(), bluetooth=(), magnetometer=(), gyroscope=()`

Production-only:

* `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

Verification:

```bash
curl -I https://444arena.com/ | grep -E "(Strict-Transport|X-Frame|X-Content|Referrer|Permissions)"
```

### CSP rollout (deferred, intentional)

Content-Security-Policy is **not** set in this sprint. A safe CSP for
this stack must allow:

* `connect-src` for `https://*.supabase.co`, `wss://*.supabase.co`,
  the realtime server origin (`wss://realtime.444arena.com`), and
  Vercel image / CDN.
* `script-src` with a per-request nonce (Next.js 16 supports this via
  middleware).
* `style-src 'unsafe-inline'` until Tailwind's runtime style ejection
  (or a hashed-style migration) lands.

Plan:

1. Stage in a single non-critical route under a `Content-Security-Policy-Report-Only` header.
2. Watch the CSP report endpoint for ≥ 7 days.
3. Promote to `Content-Security-Policy` for that route.
4. Repeat per route; the global enable comes last.

Tracked in `docs/pre-real-money-checklist.md` § Soft blockers.

## 4. JWT enforcement rollout

The realtime server has had soft-mode JWT verification since Sprint 2.
Sprint 5 formalised the staged rollout. **Sprint 6 closes the
"web client must always attach the token" precondition for stage 2.**

| Stage | Env | Behaviour |
| --- | --- | --- |
| 1 | `SOCKET_JWT_ENFORCE=false` (today) | Verification runs; mismatches log `[Security] jwt_player_mismatch (soft)`. Anonymous sockets keep working. |
| 2 | `SOCKET_JWT_ENFORCE=true` in **staging** | Sensitive handlers reject anonymous sockets. Manual QA: casual / private / tournament / spectator / wallet panel. **Pre-condition: Sprint 6 client deployed.** |
| 3 | `SOCKET_JWT_ENFORCE=true` in **production** | Same as stage 2 but on real users. Watch `[Security] unauthenticated action blocked` for 48h. |
| 4 | `ECONOMY_REAL_MONEY_ENABLED=true` only after stage 3 settles | The realtime server already fails closed if real money is on without enforcement (`economyLaunchBlockers`). |

The web client always attaches the Supabase access token to its
Socket.IO `auth.accessToken` callback as of Sprint 6. The
implementation lives in `apps/web/src/lib/socket/client.ts`; the
rollout details and regression checklist live in
`docs/socket-auth-plan.md`. Specifically:

* `getSocket()` is the single entry point used by every component
  that touches the realtime server.
* socket.io's dynamic `auth: (cb) => cb({ accessToken })` form
  re-runs on every `connect`, so token refreshes propagate without
  a manual API.
* `bindAuthListenerOnce()` subscribes to Supabase
  `onAuthStateChange` and:
  * disconnects the socket on `SIGNED_OUT`,
  * bounces the socket on `SIGNED_IN` / `TOKEN_REFRESHED`.
* `useTournamentRealtime` only emits `player:register` /
  `tournament:subscribe` when `supabase.auth.getSession()` returns a
  user matching the page's `playerId`, so anonymous viewers don't
  trigger `[Security] unauthenticated action blocked` once stage 2
  ships.

## 5. Internal endpoint posture

Every `/internal/*` route on the realtime server requires the
`x-realtime-internal-secret` header. Sprint 4 introduced a shared
guard helper. Sprint 5 adds:

* Boot-time fingerprint log (`[boot] REALTIME_INTERNAL_SECRET
  fingerprint=<masked>`) so operators can verify "the right secret is
  loaded" without leaking the value.
* `apps/realtime-server/src/security/maskSecret.ts` — reusable masking
  helper for any future log line that might accidentally include a
  secret-shaped value.

Verified routes (no body / response leaks sensitive material):

| Route | Returns | OK? |
| --- | --- | --- |
| `GET /internal/economy/health` | mode flags, blockers list, ISO timestamp — booleans only, no env values | ✅ |
| `GET /internal/economy/escrows/stuck` | escrow rows (user_id is internal anyway; not surfaced to the public surface) | ✅ |
| `GET /internal/economy/settlements/stuck` | settlement rows | ✅ |
| `POST /internal/economy/reconcile` | summary counters | ✅ |
| `POST /internal/economy/test-seed` | `{ ok, mode }` only | ✅ |
| `POST /internal/economy/tournament-entry/{lock,refund}` | `{ ok, skipped }` | ✅ |
| `POST /internal/economy/tournament/refund-fanout` | summary counters | ✅ |
| `POST /internal/tournament-rooms[/notify]` | room code only | ✅ |
| `GET /health` (public) | counts only | ✅ |

## 6. Notification subscription auth pin

Sprint 5 TASK 7 hardens the two notification-subscription socket events
so they can't be hijacked once JWT enforcement flips on:

| Event | Pre-Sprint 5 | Sprint 5 |
| --- | --- | --- |
| `player:register` | trusts `payload.playerId` | strict in enforce mode: `socket.data.userId` MUST equal `payload.playerId`. Soft mode logs the mismatch. |
| `tournament:subscribe` | trusts payload | strict in enforce mode: socket must have a verified `userId`. The tournament id itself is public. |

These changes are zero-cost in dev and zero-effect once a sane web
client sends the token (which is the current case for authenticated
users — anonymous browsers silently fall through to the soft-mode
warning).

## 7. Environment validation (`config/env.ts`)

Boot prints a single banner that lists `present` / `missing` for each
critical env var (no values), then enumerates problems:

```
[boot] realtime-server config — mode=production, NODE_ENV=production,
  SUPABASE_URL=present, SUPABASE_SERVICE_ROLE_KEY=present,
  REALTIME_INTERNAL_SECRET=present, ALLOWED_ORIGINS=2 entries,
  SOCKET_JWT_ENFORCE=on, ECONOMY_ENABLED=on, ECONOMY_TEST_MODE=off,
  ECONOMY_REAL_MONEY_ENABLED=off, ECONOMY_RECONCILIATION_ENABLED=on
```

Fatal in production:

* `SUPABASE_URL` missing
* `SUPABASE_SERVICE_ROLE_KEY` missing
* `REALTIME_INTERNAL_SECRET` missing
* `ALLOWED_ORIGINS` empty
* `ECONOMY_REAL_MONEY_ENABLED=true` && `SOCKET_JWT_ENFORCE!=true`

Warning in any mode:

* `ECONOMY_ENABLED=true` && `SOCKET_JWT_ENFORCE!=true` (with real-money
  off — fine for test mode, must flip before launch).

The validator is run from `index.ts` BEFORE `server.listen(...)` so a
misconfigured deployment surfaces during the rolling deploy rather
than silently serving traffic.

## 8. What this sprint deliberately did NOT change

* No payment provider integration. No deposits. No withdrawals.
* No UI redesign. No gameplay logic changes. No DB migrations.
* Did NOT enable CSP — staged rollout described above.
* Did NOT add request-rate-limiting at the express layer (Sprint 4
  rate-limiter targets socket events; an HTTP-level limiter on
  `/internal/*` is a future sprint).
* Did NOT remove the legacy `apps/web/src/app/wallet/page.tsx` wallet
  insert path — Sprint 3 RLS will start rejecting it; Sprint 6 should
  remove the dead route.
* Did NOT update Unity — that's a separate workstream.

## 9. Remaining risks

* **`postcss <8.5.10`** — see `npm-audit-report.md`. Build-time only;
  not exploitable from user-controlled input today.
* **CSP not yet set** — header rollout staged, see § 3.
* **No rate-limit on web `/api/*` routes** — Sprint 4 rate-limiter is
  socket-only.
* **Subdomain HSTS preload not registered** — `Strict-Transport-Security`
  is emitted but the production domain is not on the
  [hstspreload.org](https://hstspreload.org) list yet.
* **Vercel preview origins** — there's no allow-list automation. Add
  preview URLs to `ALLOWED_ORIGINS` per environment variable today; a
  future sprint can hook this to Vercel's deployment webhook.
* **`SOCKET_JWT_ENFORCE` still defaults to false** — by design (rollout
  stage 1). Sprint 6 made the web client always attach the token, so
  stage 2 is unblocked from the client side. Stage 2 still requires
  the staging operator to flip the env var and run the regression
  checklist; tracked in `docs/socket-auth-plan.md`.
