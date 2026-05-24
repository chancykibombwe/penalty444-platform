# Socket Auth / JWT Plan

> Hardening Sprint 2 + Sprint 6 — TASK 2 / Phase 2 companion document.
> Owner: realtime-server team + web platform team.

## Where we are today (after Sprint 6)

* Realtime server accepts `socket.handshake.auth.accessToken`.
* `apps/realtime-server/src/security/jwt.ts` verifies the token via the
  service-role Supabase client (`supabase.auth.getUser(token)`).
* On success we set `socket.data.userId` and emit a `[Security] jwt verified`
  log line.
* `apps/realtime-server/src/security/identity.ts` does a **soft** cross
  check inside `resolvePlayerForSocket`:
  * If the socket has a verified `userId` AND it does not match the
    claimed `playerId`, we log `[Security] jwt_player_mismatch (soft)`
    but still allow the action.
  * The check is **strict** only when `process.env.SOCKET_JWT_ENFORCE === "true"`.
* Web client now sends the Supabase session access token in the socket
  handshake via `apps/web/src/lib/socket/client.ts` using socket.io's
  dynamic `auth: (cb) => cb({ accessToken })` callback. The callback
  re-runs on every `connect` / `reconnect`, so the FRESHEST token is
  always attached to every handshake.
* `apps/web/src/lib/socket/client.ts` binds **one** Supabase
  `onAuthStateChange` listener per browser tab (`bindAuthListenerOnce`):
  * `SIGNED_OUT`     → `socket.disconnect()`. Existing
                       `RequireAuth.tsx` also calls
                       `disconnectSocket()` defensively.
  * `SIGNED_IN`      → `socket.disconnect().connect()` so the dynamic
                       auth callback re-runs and the new user's token
                       lands on the server.
  * `TOKEN_REFRESHED`→ same disconnect → connect bounce.
* Identity-bearing emits in `useTournamentRealtime` are gated on
  `supabase.auth.getSession()` matching the `playerId` prop. Anonymous
  viewers no longer emit `player:register` / `tournament:subscribe`,
  which silences the `[Security] unauthenticated action blocked` log
  for browsers that have logged out mid-session.
* Diagnostics are dev-only and prefixed `[socket-auth]`. They never
  print the token, the refresh token, or any Supabase secret.

The system is **non-breaking**: anonymous sockets (no token) and clients
running an older bundle still connect and play. With
`SOCKET_JWT_ENFORCE=false` (the current default) the server only logs
soft warnings; with `SOCKET_JWT_ENFORCE=true` (staging next) the server
rejects mismatches as documented in § Phase 2.

## Frontend token attachment flow (Sprint 6)

```
┌────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Supabase auth  │    │ lib/socket/client│    │ realtime server │
└──────┬─────────┘    └────────┬─────────┘    └────────┬────────┘
       │ getSession()           │                       │
       │ <───────────────────── │  (auth callback)      │
       │                        │ ────── connect ─────► │
       │                        │   auth.accessToken    │
       │                        │                       │ verifySocketJwt
       │                        │ ◄──── connect_ack ─── │ socket.data.userId set
       │                        │                       │
       │ TOKEN_REFRESHED        │                       │
       │ ─────────────────────► │                       │
       │                        │ disconnect()→connect()│
       │                        │ ────── connect ─────► │
       │                        │   (new token)         │ verifySocketJwt re-runs
       │                        │                       │
       │ SIGNED_OUT             │                       │
       │ ─────────────────────► │ disconnect()          │
       │                        │ ────── close ───────► │
```

Key invariants:

* The auth callback always reads from `supabase.auth.getSession()`. We
  never cache the token in module state.
* `disconnect().connect()` is the standard re-auth gesture — the
  socket.io v4 dynamic `auth` callback re-runs on the next handshake.
* When `getSession()` returns no session, the callback sends an empty
  `accessToken`. The server treats this as `no_token` and (in enforce
  mode) refuses to register the socket as a player.

## What's still gap

| Gap | Risk | Action |
| --- | ---- | ------ |
| `playerId` is still trusted from the wire when no JWT | Spoofing if a roommate steals socketId+playerId | Phase 2 below |
| `SOCKET_JWT_ENFORCE` is `false` in all envs | Sprint 2 chose observability first | Flip after Sprint 6 rollout monitoring |
| Tournaments still rely on `room.allowedPlayerIds` | Server-side allowlist already mitigates impersonation | Keep; layer JWT on top |

> Sprint 6 closed the "no refresh-token plumbing on the socket" gap:
> `TOKEN_REFRESHED` is observed in `lib/socket/client.ts` and triggers
> a `disconnect().connect()` so the new token lands on the server
> within ~50 ms of issuance.

## Phase 2 — enforcement rollout (Sprint 5 staged plan)

This rollout is intentionally split into four named stages so each
flip can be reverted independently. The realtime server already fails
closed on real-money mode without JWT enforcement
(`economyLaunchBlockers`); the rollout below ensures we *get there*
without breaking free-play.

| Stage | Env | What changes | Exit criteria |
| --- | --- | --- | --- |
| **1 — Observe** (today) | `SOCKET_JWT_ENFORCE=false` everywhere | Soft mismatches log `[Security] jwt_player_mismatch (soft)` | `[Security] jwt_player_mismatch (soft)` count is zero for ≥ 7 days in production |
| **2 — Staging flip** | `SOCKET_JWT_ENFORCE=true` in **staging only** | Sensitive handlers reject mismatches; `player:register` / `tournament:subscribe` reject anonymous sockets (Sprint 5 TASK 7) | Manual QA passes the regression checklist below |
| **3 — Production flip** | `SOCKET_JWT_ENFORCE=true` in **production** | Same as stage 2 on real users | `[Security] unauthenticated action blocked` count plateaus and is fully accounted for |
| **4 — Real money** | `ECONOMY_REAL_MONEY_ENABLED=true` | Realtime server now allows real-money mode to start (without stage 3 it fails closed) | `pre-real-money-checklist.md` fully green |

Stage 2/3 regression checklist:

* Casual 1v1 works for an authenticated user and an anonymous user
  (only authenticated should match-make and play; anonymous is
  rejected before any state mutation).
* Private room create / join for two authenticated users.
* Tournament match works end-to-end.
* Spectator watch works for an authenticated user.
* `account/page.tsx` wallet panel still loads.
* `tournament-registry` still routes `tournament:matchReady`
  notifications.
* Login → socket connects → `[socket-auth] token attached` appears in
  dev console (and only `[Security] jwt verified` in server logs).
* Refresh page → session restored → socket reconnects with token
  (no `[Security] jwt_player_mismatch` in server logs).
* Logout → `disconnect` event fires → socket stays disconnected until
  the next user signs in. Anonymous flows (e.g. spectator watch) still
  work after logout.
* Trigger a token refresh (e.g. via Supabase debug console
  `auth.refreshSession()`) → socket bounces and reconnects within ~1s.

### Sprint 6 staging flip checklist (`SOCKET_JWT_ENFORCE=true` in staging)

Before flipping the staging env var:

* [ ] Stage 1 monitoring shows zero `[Security] jwt_player_mismatch (soft)`
      lines for 24h on staging.
* [ ] Web bundle deployed to staging includes the Sprint 6 socket
      client (`apps/web/src/lib/socket/client.ts` with the
      `bindAuthListenerOnce` block).
* [ ] All staging Supabase users have either signed in fresh or had
      their browser tabs reloaded since the new bundle deployed.

After flipping:

* [ ] Tail realtime server logs for 30 min. Expect:
  * `[Security] jwt verified` lines on every authenticated socket.
  * Zero `[Security] player:register identity mismatch` lines.
  * Anonymous socket attempts to register a player are logged once
    each as `[Security] player:register unauthenticated`.
* [ ] Run the regression checklist above on staging.
* [ ] `tournament-registry tournament:subscribe` lines still appear
      for authenticated users joining tournament pages.

Roll-back: set `SOCKET_JWT_ENFORCE=false` in staging env, restart the
realtime server. Soft-mode resumes immediately; no client redeploy
needed.

After stage 3:

* Replace the silent pass-through in `verifySocketJwt` with
  `socket.disconnect(true)` when `JWT_ENFORCE` is on and the result is
  `no_token`. Today the soft path stays connected so we can collect
  telemetry; once stage 3 is stable the disconnect can ship.
* For sensitive events (`match:pick`, `match:forfeit`,
  `match:abortEarly`, `match:rematch*`), derive the player from
  `socket.data.userId` and only use `playerId` from the payload as a
  parity check.

## Phase 3 — defence in depth

* Rotate the realtime-server↔web internal secret on a schedule.
* Add a per-action JWT scope claim (e.g. `realtime:match`) issued by a
  short-lived edge function once the player joins a room.
* Replace direct `getUser()` calls (one DB lookup each) with a JWKS
  signature verification (no DB hit) — cuts socket connect latency.

## Operational rules

* **Never** require a JWT for the WebSocket connection ping/pong path —
  that path stays anonymous.
* **Always** call `verifySocketJwt(socket)` on `connect` (we already do),
  not lazily on first sensitive action.
* **Always** keep the legacy room-roster check (`resolvePlayerForSocket`)
  even after enforcement; it is the canonical authority for "this socket
  belongs to this room slot".

## Env vars

```
SOCKET_JWT_ENFORCE=false   # Sprint 2 default
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Setting `SOCKET_JWT_ENFORCE=true` is the single switch that promotes the
soft mismatch path to hard rejection.
