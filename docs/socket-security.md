# Socket Security & Spectator Isolation

> Hardening Sprint 4 — TASK 7. Audit of every realtime-server event,
> identity gate, and the spectator isolation guarantee. Companion to
> `docs/server-authority.md` and `docs/socket-auth-plan.md`.

## Connection lifecycle

```
client.connect() ──▶ socket.io handshake (auth.accessToken optional)
                ──▶ verifySocketJwt(socket)            (Sprint 2 + 4)
                       ├─ ok    → socket.data.userId, authenticated=true
                       └─ fail  → authenticated=false, authError=<reason>
                ──▶ register*Handlers(socket)          (idempotent, per-event)
```

* The handshake completes BEFORE the socket starts emitting application
  events in normal browsers, so `socket.data.authenticated` is usually
  populated before the first sensitive event arrives. Async handlers can
  `await socket.data.authPromise` to guarantee freshness.
* When `SOCKET_JWT_ENFORCE=false` (default), JWT failures are logged but
  do not block. When `true`, every player-action handler must reject
  unauthenticated sockets via `requireAuthenticatedSocket`.
* Disconnect runs:
  `unregisterSocket → pruneSpectatorOnDisconnect → pruneSocketEventHistory →
   pruneRateLimitForSocket → ranked queue cleanup → public-offer cleanup →
   active-room cleanup`. Every map that holds the socket id is hit.

## Identity ladder (recap)

```
1. socket.connected
2. roomCode → Room exists in `state/stores.rooms`
3. room not in terminal state for this action
4. socket NOT in `room.spectatorSocketIds`        ← spectator separation
5. payload.playerId ∈ room.players
6. room.players[i].socketId === socket.id
7. tournament rooms: playerId ∈ room.allowedPlayerIds
8. socket.data.userId === playerId                ← JWT cross-check
9. action-specific gates (timer, pick, phase, stake, …)
```

`apps/realtime-server/src/security/identity.ts::resolvePlayerForSocket`
checks rungs 1-7 (and rung 8 in enforce mode). The combined
`assertSocketCanActInRoom` from `security/socketIdentity.ts` chains rung
2-8 in one call.

## Per-event matrix

| Event | Identity ladder | Replay guard | Rate limit | Notes |
| --- | --- | --- | --- | --- |
| `room:create` | rung 8 (soft / strict by enforce flag) | — | `room:create` 6/30s | Creator only. Active-room reuse is blocked. |
| `room:join` | rung 5-8 for existing player; rung 8 for new joiner | — | `room:join` 30/30s | Tournament rooms additionally require `allowedPlayerIds`. |
| `room:leave` | none (just `socket.leave`) | — | — | Cosmetic — does not mutate room state. |
| `match:pick` | full ladder via `resolvePlayerForSocket` | optional via `clientEventId` | `match:pick` 6/10s | matchInstance check rejects stale picks. |
| `match:forfeit` | full ladder | — | `match:forfeit` 4/10s | Blocked during early-cancel window for casual rooms. |
| `match:abortEarly` | full ladder | — | `match:abortEarly` 4/10s | Tournament rooms refuse this event. |
| `match:rematch` | full ladder | — | `match:rematch` 4/10s | Tournament rooms refuse. Stake>0 refused (legacy stakes path). |
| `match:rematch:decline` | full ladder | — | `match:rematch:decline` 4/10s | Same posture as `match:rematch`. |
| `publicOffer:create` | rung 8 (soft / strict) | — | `publicOffer:create` 5/30s | Cannot create while busy. Stake locks server-authoritative. |
| `publicOffer:join` | rung 8 (soft / strict) | — | `publicOffer:join` 10/30s | Server validates offer presence + own-offer guard. |
| `publicOffer:cancel` | rung 8 (soft / strict) | — | `publicOffer:cancel` 10/30s | Host-only. Offer-not-found → silent. |
| `publicOffers:request` | none | — | — | Snapshot read; safe. |
| `ranked:enqueue` | none on rung 5-7 (queue is pre-room) | — | `ranked:enqueue` 10/60s | Active-room reuse blocked. |
| `ranked:cancel` | playerId-on-queue + socketId match | — | — | Self-only via socket equality. |
| `spectator:join` | reverse: rung 4 — must NOT be in `room.players` | — | — | Adds socket id to `room.spectatorSocketIds`, joins `${code}:spectators` channel. |
| `spectator:leave` | none | — | — | Idempotent. |
| `tournament:subscribe` / `tournament:unsubscribe` | rung 7 in enforce mode (Sprint 5 TASK 7): `socket.data.userId` must be present. Sprint 6: web client also gates on Supabase session before emit. | — | — | Subscription is a notification subscription only — no state mutations follow. |
| `player:register` | rung 7 in enforce mode (Sprint 5 TASK 7): `socket.data.userId === payload.playerId`. Sprint 6: web client only emits when `getSession()` matches. | — | — | Registers playerId → socketId mapping for tournament-ready notifications. |

## Spectator isolation contract

The spectator subsystem is the most security-sensitive socket surface
because we route player-room emits across two channels. The contract:

1. **Disjoint channel.** Spectators join the Socket.IO room
   `${roomCode}:spectators`, never the player room `${roomCode}`.
2. **Disjoint roster.** A socket id MAY be a player or a spectator,
   never both for the same room. `spectator:join` rejects any socket
   that already appears in `room.players`.
3. **No pick state pre-reveal.** `room.picks` is **never** sent to any
   client until both lanes are in. Spectators only receive
   `match:result` after `resolveShot` runs, which happens server-side.
4. **Player-action emits are ignored from spectator sockets.** Every
   `match:pick`, `match:forfeit`, `match:abortEarly`, `match:rematch`,
   `match:rematch:decline` calls `resolvePlayerForSocket`, which
   short-circuits when `room.spectatorSocketIds.has(socket.id)` returns
   true (rung 4 of the identity ladder). The rejection is logged as
   `[Security] rejected spoofed action ... reason=spectator_socket`.
5. **No tournament progression from spectators.** Bracket advancement
   only fires from `endMatch` → `saveMatchResult` →
   `advanceTournamentFromRoom`. None of those paths consider spectator
   sockets.
6. **No economy mutations from spectators.** Stake / escrow flows are
   anchored to `room.players`. Spectators never appear there.
7. **Cleanup parity.** `pruneSpectatorOnDisconnect`, `removeRoomNow`,
   and the stale-room sweeper all drop spectator memberships before
   completing.

`apps/realtime-server/src/socket/spectator.ts::isSpectatorSafeEvent`
explicitly whitelists which events may be mirrored to the spectator
channel. Anything outside that list NEVER reaches a spectator.

### Verifying spectator isolation manually

Open two browser tabs.

* Tab A: open the match as a player.
* Tab B: open `/watch/{roomCode}` as a spectator.

In Tab B, open devtools and try to emit a player action via the live
socket:

```js
window.socket.emit("match:pick", {
  roomCode: "ABCDEF",
  playerId: "<another player's id>",
  lane: "LEFT",
});
```

Expected:

* Realtime server log:
  `[Security] rejected spoofed action action=match:pick socketId=… reason=spectator_socket roomCode=ABCDEF playerId=…`
* No state mutation. No event reaches Tab A.
* Tab B's scoreboard remains unchanged.

## Internal endpoint surface

Every `/internal/*` route on the realtime server is gated by
`requireInternalSecret(req, res)` in `security/internalSecret.ts`. The
secret is the `REALTIME_INTERNAL_SECRET` env var. Missing or mismatched
header returns `401 Unauthorized` and logs `[Security] internal endpoint
blocked path=… method=…`.

| Route | Method | Purpose |
| --- | --- | --- |
| `/internal/economy/test-seed` | POST | Test-mode wallet seed (gated by `ECONOMY_TEST_MODE=true`). |
| `/internal/economy/tournament-entry/lock` | POST | Lock tournament entry escrow. Reads fee from DB, never trusts client. |
| `/internal/economy/tournament-entry/refund` | POST | Refund tournament entry escrow. |
| `/internal/economy/health` | GET | Mode + flag snapshot. |
| `/internal/economy/reconcile` | POST | Run reconciliation pass. |
| `/internal/economy/escrows/stuck` | GET | List stuck escrows. |
| `/internal/economy/settlements/stuck` | GET | List stuck settlements. |
| `/internal/economy/tournament/refund-fanout` | POST | Refund every locked entry for a cancelled tournament. |
| `/internal/tournament-rooms` | POST | Create / look up a tournament-match → room mapping. |
| `/internal/tournament-rooms/notify` | POST | Notify players a room is ready. |
| `/health` | GET | Public health snapshot — counts only, no user data. |

## Web `/api/*` surface

| Route | Auth | Purpose |
| --- | --- | --- |
| `/api/internal/tournaments/tick` | `Authorization: Bearer ${CRON_SECRET}` (production) OR dev sync header (non-prod only) | Cron tick. |
| `/api/tournaments/[id]/matches/[matchId]/room` | Bearer Supabase access token | Provision tournament room. Calls realtime server with internal secret. |
| `/api/tournaments/[id]/matches/[matchId]/presence` | Bearer Supabase access token | Record participant presence. |
| `/api/tournaments/[id]/start` | Bearer Supabase access token | Manual creator-triggered start. |
| `/api/economy/tournament-entry` | Bearer Supabase access token | Proxy to realtime server `/internal/economy/tournament-entry/*`. The browser never sees `REALTIME_INTERNAL_SECRET`. |

No browser-facing route mutates `wallets`, `wallet_ledger_entries`,
`escrow_locks`, `settlement_events`, or `audit_events`. The economy proxy
is the only route the browser hits, and it dispatches to a server that
ALSO requires the internal secret.

## Known gaps (intentional, tracked)

* `SOCKET_JWT_ENFORCE=false` is the default. Sprint 4 makes every
  sensitive handler ENFORCE-READY (the soft check is in place; flipping
  the env flag turns the soft warning into a hard reject). The flip is
  blocked behind `ECONOMY_REAL_MONEY_ENABLED` going to true — see
  `economyLaunchBlockers()`.
* `ranked:enqueue` does not currently soft-check the JWT against the
  player id because the queue is socket-attached and we destroy queue
  entries on socket disconnect. Adding a JWT check would not remove any
  abuse path that the active-room guard doesn't already cover. Tracked
  as future work in `docs/pre-real-money-checklist.md`.
* `tournament:subscribe` and `player:register` are notification-only and
  do not mutate any persistent state. Pre-Sprint 5 they accepted any
  payload because a malicious client only hurts itself by sending a
  wrong id. Sprint 5 added enforce-mode rejection so the metric
  `[Security] unauthenticated action blocked` is meaningful for those
  events too. Sprint 6 makes the web client itself gate the emit on
  `supabase.auth.getSession()`, which keeps anonymous tabs silent.

## Operational signals to monitor

Grep production logs for these prefixes:

* `[Security] rejected spoofed action` — identity ladder rejection. A
  spike indicates either a hostile client or a bug in the legitimate
  client.
* `[Security] jwt_player_mismatch (soft)` — pre-enforcement warning. The
  count should monotonically decrease as the web client always-attaches
  the access token.
* `[Security] unauthenticated action blocked` — only fires in enforce
  mode. Any volume after enforcement rollout is real abuse.
* `[Security] rate limit exceeded` — abuse signal.
* `[Security] replay rejected` — duplicate `clientEventId`. Investigate
  if not zero in steady state.
* `[Security] internal endpoint blocked` — external probing. Should be
  near zero in production behind a private network.
