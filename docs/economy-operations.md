# Economy Operations Runbook

> Phase 12 — operational playbook for the recovery layer.

## Overview

The economy is built around five invariants:

1. **Append-only ledger.** Balances are derived from
   `wallet_ledger_entries`. Rows are never edited.
2. **Idempotent helpers.** Same idempotency key → at most one ledger row.
3. **Escrow-before-gameplay.** Locked funds are visible in
   `escrow_locks`; the wallet `locked_balance_minor` mirrors the sum.
4. **Result-before-settlement.** `match_results` row is durable before
   `settlement_events` flips to `processing`.
5. **Audited everything.** Every state transition emits an
   `audit_events` row.

When all five invariants hold, no money is lost or duplicated. The
reconciliation worker (this doc) handles the edge cases where the
chain of writes is interrupted mid-flight.

## Feature flags

| Flag | Default | Purpose |
| ---- | ------- | ------- |
| `ECONOMY_ENABLED` | `false` | Master switch. |
| `ECONOMY_TEST_MODE` | `false` | Enables `/internal/economy/test-seed`. |
| `ECONOMY_REAL_MONEY_ENABLED` | `false` | Real money. Phase 12 keeps it off. |
| `ECONOMY_RECONCILIATION_ENABLED` | `false` | Reserved for future cron loop. The endpoint always works when economy is on. |
| `SOCKET_JWT_ENFORCE` | `false` | Required-true before real money (server fails closed otherwise). |

## Endpoints

All require the `x-realtime-internal-secret` header.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/internal/economy/health` | Mode + blockers + JWT/economy flags. |
| `POST` | `/internal/economy/reconcile` | Run the reconciliation pass. Returns the full summary. |
| `GET` | `/internal/economy/escrows/stuck?limit=N` | Locked / pending / manual_review escrows ordered by age. |
| `GET` | `/internal/economy/settlements/stuck?limit=N` | Processing / failed / requires_payout / manual_review settlements. |
| `POST` | `/internal/economy/tournament/refund-fanout` | Refund every locked entry escrow for a cancelled tournament. Body: `{ tournamentId }`. |
| `POST` | `/internal/economy/tournament-entry/lock` | (Phase 11) per-player lock. |
| `POST` | `/internal/economy/tournament-entry/refund` | (Phase 11) per-player refund. |
| `POST` | `/internal/economy/test-seed` | (Phase 11) dev/QA only. |

## Reconciliation pass

`reconcileEconomy()` runs four sub-passes:

### 1. Stuck settlements

Targets `settlement_events` where:

* `status IN ('processing', 'failed', 'pending')`
* `created_at < now() - 5 min`
* `retry_count < MAX_SETTLEMENT_RETRIES (3)`
* `scope = 'match'`

For each row:

1. Check `match_results` exists. If not → audit and skip.
2. Increment `retry_count`, reset status to `processing`.
3. Call `settleMatchEconomy({ roomCode, matchInstance })` — this is
   idempotent.
4. On success → settlement row flips to `completed` and an audit row
   `settlement.recovered` lands.
5. On failure → row flips to `failed` and `settlement.recovery_failed`
   audit row lands. Next pass will retry (until max).

After `MAX_SETTLEMENT_RETRIES` the row goes to `manual_review` and is
not auto-retried again. Operator must inspect and either:

* Reset `status='processing', retry_count=0, failure_reason=NULL` to
  re-enter the worker pipeline.
* Manually refund the affected escrows and mark `status='reversed'`.

### 2. Orphan escrows

Three buckets, processed in order:

| Bucket | Condition | Action |
| ------ | --------- | ------ |
| (a) | `status='pending' AND created_at < now() - 10 min` | Set `status='failed'`. Ledger was never debited; safe. |
| (b) | `scope='match' AND status='locked' AND locked_at < now() - 60 min AND NO match_results AND room NOT in memory` | Refund via `refundMatchEscrow` (idempotent). |
| (c) | `scope='match' AND status='locked' AND locked_at < now() - 60 min AND has match_results` | Skip — owned by the settlement worker. |
| (d) | Same as (b/c) but room still in memory | Skip — could be a very long match. |
| (e) | `scope='match' AND status='locked' AND locked_at < now() - 60 min` but ANY refund failed for non-idempotent reason | `markEscrowManualReview`. |

### 3. Tournament escrow fanout

For every distinct `tournament_id` that has at least one locked or
pending entry escrow:

* If `tournaments.status='cancelled'` → call
  `refundTournamentEntryEscrowByRow` for each row. `pending` rows are
  marked `failed` (no ledger debit yet).
* Otherwise → skip.

### 4. Wallet consistency sample

Pulls the 20 most-recently-updated wallets and recomputes
`available_balance_minor` and `locked_balance_minor` from
`wallet_ledger_entries`. Any drift emits
`wallet.balance_drift_detected` at `severity=critical` and increments
the `flaggedManualReview` counter on the summary.

## Manual review queue

A row is in the manual-review queue when:

* `escrow_locks.status='manual_review'`, OR
* `settlement_events.status='manual_review'`

The reconciliation worker NEVER auto-fixes these. Operator workflow:

1. `GET /internal/economy/escrows/stuck` and
   `GET /internal/economy/settlements/stuck`.
2. Cross-check `audit_events` for the row using
   `referenceType=escrow|settlement&referenceId=...`.
3. Decide: refund, settle, or reverse.
4. Service-role SQL update.
5. Re-run `/internal/economy/reconcile` to confirm.

## Tournament room rehydration

`tournamentMatchRooms` is an in-memory Map<tournamentMatchId, roomCode>.
On boot Phase 12 calls `rehydrateTournamentRoomsMap()` which:

* Reads `tournament_matches WHERE room_code IS NOT NULL AND
  winner_entry_id IS NULL AND status IN ('pending', 'in_progress',
  'ready')`.
* Rebuilds the map so subsequent `POST /internal/tournament-rooms`
  calls re-use the persisted room code instead of minting a new one.

The in-memory `Room` object is NOT reconstructed. If the realtime
server is restarted mid-match, the players must rejoin via the lobby
flow. The persistence layer is the source of truth for the bracket;
the realtime layer is for live communication only.

## Pot calculation guard

`settleMatchEconomy` now refuses to pay out unless **exactly two**
locked escrows exist for the room. Any other count emits
`settlement.invalid_pot_state` at `critical` severity and the
settlement is parked in `manual_review`. This protects against the
case where one escrow was refunded by the recovery worker while a
parallel match-result arrived.

## Tournament settlement guard

`settleTournamentEconomy` will NOT mark `settlement_events.status =
'completed'` when `prize_pool_minor > 0`. The row is inserted with
`status='requires_payout'` and an audit event
`settlement.tournament_requires_payout` is emitted. This is the "must
NOT fake-complete without payout" enforcement from Phase 12 TASK 4.

A future prize-distribution module (Phase 13+) will be the only thing
allowed to flip `requires_payout` → `completed`.

## Hard launch blocker (real money)

`apps/realtime-server/src/index.ts → economyLaunchBlockers()` runs at
startup. When `ECONOMY_REAL_MONEY_ENABLED=true`:

* If `SOCKET_JWT_ENFORCE!=true` → `process.exit(1)`.
* If `ECONOMY_ENABLED!=true` → `process.exit(1)`.

Both messages are logged with `[Economy] FATAL: ...` so the operator
can diagnose immediately.
