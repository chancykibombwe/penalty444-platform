# Socket Auth / JWT Plan

> Hardening Sprint 2 — TASK 2 companion document.
> Owner: realtime-server team.

## Where we are today (after Sprint 2)

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
  handshake via `apps/web/src/lib/socket/client.ts`.

The system is **non-breaking**: anonymous sockets (no token) and clients
running an older bundle still connect and play.

## What's still gap

| Gap | Risk | Action |
| --- | ---- | ------ |
| `playerId` is still trusted from the wire when no JWT | Spoofing if a roommate steals socketId+playerId | Phase 2 below |
| `SOCKET_JWT_ENFORCE` is `false` in all envs | Sprint 2 chose observability first | Flip after rollout monitoring |
| No refresh-token plumbing on the socket | Long-lived sockets keep stale userId after refresh | Schedule re-auth on `match:start` |
| Tournaments still rely on `room.allowedPlayerIds` | Server-side allowlist already mitigates impersonation | Keep; layer JWT on top |

## Phase 2 — enforcement rollout

1. **Telemetry pass (1–2 weeks).**
   * Confirm `[Security] jwt verified` rate ≈ `engine.clientsCount`.
   * Confirm `[Security] jwt_player_mismatch (soft)` count stays at 0 in
     normal play.
   * Confirm no spike in `[Security] jwt verify failed` outside expected
     reasons (`no_token`, `no_backend`).
2. **Server flip.**
   * Set `SOCKET_JWT_ENFORCE=true` in production env.
   * `resolvePlayerForSocket` now rejects mismatches with reason
     `jwt_player_mismatch`.
3. **Hard rejection of anonymous sockets.**
   * Replace the silent pass-through in `verifySocketJwt` with a
     `socket.disconnect(true)` when `JWT_ENFORCE` is on and the result is
     `no_token`.
4. **Remove client-trusted `playerId` payloads.**
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
