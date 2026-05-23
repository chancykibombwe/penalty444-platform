# Server Authority Model

> Hardening Sprint 4 — TASK 1. Final authority contract for every state
> mutation in the platform. If you are reviewing a PR that lets a client
> decide one of the things in the right column, that PR fails the bar.

## One-line rule

**The client requests. The server decides. The database persists.**

The client never carries authority for any outcome that has economic,
competitive, or progression consequences.

## Authority by layer

### Browser client (anon or authenticated user)

| May request | May NOT decide |
| --- | --- |
| Sign in / sign out | Their own user id |
| Set / change own username | Anyone else's username |
| Browse leaderboard, profiles, tournaments | Their stats |
| Create a tournament (creator only) | Tournament status / winner / advancement |
| Register / withdraw from a tournament (own row only) | Other players' entries |
| Join an existing room (`room:join`) | Whether the room exists / accepts them |
| Create a private room (`room:create`) | Room code, opponent identity |
| Open a public offer (`publicOffer:create`) | Stake amount (server reads from offer config) |
| Join a public offer (`publicOffer:join`) | Whether escrow lock succeeds |
| Cancel own offer (`publicOffer:cancel`) | Refund amount, refund timing |
| Join ranked queue (`ranked:enqueue`) | Match opponent, MMR delta |
| Pick a lane (`match:pick`) | Round outcome, GOAL/SAVE result |
| Forfeit (`match:forfeit`) | Final score, winner |
| Abort during early-cancel window (`match:abortEarly`) | Whether window is still open |
| Vote rematch (`match:rematch`) | Whether opponent agreed |
| Spectate (`spectator:join`) | Pre-reveal pick state of any player |
| View own wallet (RLS-gated) | Wallet balance value |
| View own ledger (RLS-gated) | Ledger entries (append-only, server-only writes) |
| Request a friend / follow (planned) | Whether the other party accepted |

### Realtime server (`apps/realtime-server`)

Owns the **live competitive state machine** for every active room.

| Owns | Notes |
| --- | --- |
| `Room` object lifecycle | In-memory; rebuilt for tournament rooms on boot via `rehydrateTournamentRoomsMap`. |
| Socket → player binding | `room.players[*].socketId` and Phase-2 JWT cross-check via `socket.data.userId`. |
| Pick collection | `room.picks` mutated only after `resolvePlayerForSocket` succeeds. |
| Round resolution | `gameplay/resolveShot.ts` is the only place GOAL / SAVE / DRAW is decided. |
| Score increments | `room.scores[playerId]` incremented only by `resolveRound`. |
| Match end | `endMatch` flips `room.matchEnded`; client `match:end` event is informational. |
| Match abort | `abortMatchEarly` is the only writer of "aborted" state. |
| Sudden death state machine | `gameplay/suddenDeath.ts`. |
| Stake settle / payout call | Triggered only after authoritative match result is persisted. |
| Tournament bracket advancement | `advanceTournamentFromRoom`; idempotent; conflict-guarded. |
| Tournament completion | `maybeCompleteTournament` / `reconcileTournamentCompletion`. |
| Reconnect window | 39s timer in `socket.on("disconnect")`; forfeit applied server-side. |
| Spectator channel | `${roomCode}:spectators`; never mirrors pre-reveal pick state. |
| Internal endpoint surface | `/internal/*` routes; protected by `x-realtime-internal-secret`. |

### Web server-side (`apps/web/src/app/api/*`, `apps/web/src/lib/tournament/*` server contexts)

Uses the Supabase **service role**. Bypasses RLS. Lives only in code paths
that never ship to the browser.

| Owns | Notes |
| --- | --- |
| Tournament bracket creation | `startTournament` writes the initial `tournament_matches` rows. |
| Tournament tick / cron | `/api/internal/tournaments/tick` — `Authorization: Bearer ${CRON_SECRET}`. |
| Bracket no-show / cleanup processing | Run from the cron tick, never from the browser. |
| Tournament room provisioning | `/api/tournaments/[id]/matches/[matchId]/room` — Bearer-token authenticated, calls realtime server with the internal secret. |
| Tournament presence recording | `/api/tournaments/[id]/matches/[matchId]/presence` — Bearer-token authenticated. |
| Economy proxy for tournament entry escrow | `/api/economy/tournament-entry` — Bearer-token authenticated, dispatches to realtime server. |

### Backend / service-role-only writers

These tables are mutated **only** by the realtime server or by service-role
code paths. The Sprint 3 RLS migration removes any client INSERT / UPDATE /
DELETE policies on them.

| Table | Sole authoritative writer |
| --- | --- |
| `match_results` | Realtime server `saveMatchResult`. |
| `player_stats`, `season_player_stats` | Realtime server `applyPlayerProgressionFromMatch`. |
| `tournament_matches` (advancement / status / room_code) | Realtime server `advanceTournamentFromRoom`; web server `startTournament` / cron tick. |
| `tournaments.status` (in_progress, completed, cancelled) | Web server cron tick + `maybeCompleteTournament`. |
| `wallets.available_balance_minor` / `locked_balance_minor` | `economy_apply_ledger_entry` SECURITY DEFINER RPC. |
| `wallet_ledger_entries` | `economy_apply_ledger_entry` only. APPEND-ONLY. |
| `escrow_locks` | `economy/escrow.ts` (server-only). |
| `settlement_events` | `economy/settlement.ts`, `economy/reconciliation.ts`. |
| `audit_events` | `economy/audit.ts`. |

### Supabase (Postgres)

Authoritative for **persistence and constraint enforcement**. Independent
of any application code.

| Owns | Mechanism |
| --- | --- |
| RLS on every public table | Sprint 3 migration `20260523080000_rls_security_hardening.sql` (idempotent). |
| Idempotency for match results | `UNIQUE (room_code, match_instance)` on `match_results`. |
| Idempotency for ledger | `UNIQUE (user_id, idempotency_key)` on `wallet_ledger_entries`. |
| Idempotency for settlements | Per-scope unique constraints on `settlement_events`. |
| Non-negative wallet balances | CHECK on `wallets.{available,locked}_balance_minor`. |
| Tournament bracket invariants | `tournament_matches_winner_is_participant`, `tournament_matches_winner_when_terminal`. |
| Single-winner per slot | Trigger + CHECK on `tournament_matches`. |
| Append-only ledger | RLS denies INSERT / UPDATE to `authenticated`; only `economy_apply_ledger_entry` (SECURITY DEFINER) writes. |
| Audit history | `audit_events`; service-role only. |

## Identity ladder

Every sensitive socket action passes the same ladder before mutating state.
A failure at any rung silently bails (`return;` from the handler) — never
mutate, never emit player-visible state changes.

```
1. socket.connected               (Socket.IO baseline)
2. roomCode resolves to a Room    (state/stores.rooms)
3. room not in terminal state     (matchEnded === false, etc.)
4. socket NOT in spectator set    (room.spectatorSocketIds)
5. payload.playerId is on roster  (room.players)
6. roster.socketId === socket.id  (no socket hijacking)
7. tournament allowedPlayerIds    (matchType === 'tournament' only)
8. JWT cross-check                (socket.data.userId === playerId)
9. action-specific gates          (timer, phase, picks, stake)
```

Rungs 1-7 are enforced by `resolvePlayerForSocket` in
`apps/realtime-server/src/security/identity.ts`.

Rung 8 is **soft** when `SOCKET_JWT_ENFORCE=false` (default — log-only). It
becomes a hard reject when the env var is `true`. **Real money MUST NOT be
enabled until enforcement is on** — `economyLaunchBlockers()` blocks the
realtime server from starting otherwise.

Rung 9 lives in each handler:

| Handler | Action-specific gates |
| --- | --- |
| `match:pick` | timer window open, role assigned, no prior pick this turn, not resolving, not ended, not disconnected |
| `match:forfeit` | early-cancel window passed, room has 2 players, not resolving |
| `match:abortEarly` | within `EARLY_CANCEL_MS`, no pick submitted, casual room only |
| `match:rematch` | match ended, casual room, no stakes (legacy stakes path), not already voted |
| `publicOffer:create` | no existing offer for this host, not busy, stake locks succeed |
| `publicOffer:join` | offer exists, not own offer, room has space, escrow locks succeed |
| `publicOffer:cancel` | offer exists, requester is the host |

## What changed in Sprint 4

* Added `apps/realtime-server/src/security/socketIdentity.ts` — single
  facade over JWT + identity helpers.
* Added `apps/realtime-server/src/security/replayGuard.ts` — duplicate-event
  rejection per `(roomCode, socketId)`.
* Added `apps/realtime-server/src/security/rateLimit.ts` — token-bucket
  per `(socketId, action)` for spam protection.
* Added `apps/realtime-server/src/security/internalSecret.ts` — shared
  helper extracted from `index.ts`.
* Extended `socket.data` with `authenticated` and `authError` fields.
* Added soft JWT cross-check to `room:join` and the public-offer flows.
* Tightened startup warnings: economy on without JWT enforcement now
  emits a loud warning even when real money is off.
* Added `docs/socket-security.md` with the spectator isolation contract.
* Added `scripts/check-security-posture.mjs` — local self-audit script.
