# Settlement Pipeline

> Phase 10 foundation. The match end → economy settlement path.

## Strict ordering (Phase 11 wiring)

The pipeline runs ONLY after the authoritative match outcome is durable.
Phase 11 wires it inside `endMatch` in `apps/realtime-server/src/index.ts`:

```
1. (Realtime) endMatch() emits match:end + spectator mirror
2. saveMatchResult(room)
       → INSERT INTO match_results
       → unique (room_code, match_instance) — duplicates are benign (Sprint 1)
3. (Always) settleStakes(room)   ← legacy free-pass wallet path
4. (Always) settleMatchEconomyForRoom(room)
       → no-op when mode = "off" or room.stakeAmount = 0
       → otherwise:
             - assertMatchSettlementNotProcessed
             - INSERT settlement_events (processing)
             - per-player: refund / payout / consume
             - UPDATE settlement_events → completed
             - emit audit + [Settlement] log
5. scheduleRoomCleanup(io, roomCode, "match-ended")
```

`saveMatchResult` MUST succeed before either settlement runs. Sprint 1
already enforces this; Phase 11 keeps the contract intact and runs the
economy settle AFTER the legacy settle so legacy state is never
poisoned by an economy failure.

## Phase 12 — pot integrity guard

`settleMatchEconomy` now refuses to pay out unless **exactly two**
locked escrows are found for the room. Any other count:

* emits `settlement.invalid_pot_state` at `critical` severity,
* flips the `settlement_events` row to `status='manual_review'`,
* returns `{ ok: false, reason: 'invalid_locked_count:<n>' }`.

This blocks the failure mode where the reconciliation worker has
already refunded one escrow while a delayed match-result arrives.

## Phase 12 — settlement status state machine

```
pending      → processing | manual_review
processing   → completed | failed | requires_payout | manual_review
failed       → processing | manual_review   (retryable up to MAX_SETTLEMENT_RETRIES)
requires_payout → completed | manual_review (tournament prize payout module)
manual_review → processing | completed | reversed (operator only)
completed    → ∅
reversed     → ∅
```

`completed` and `reversed` are terminal. The reconciliation worker
never touches `manual_review` — those rows wait for an operator.

## Phase 12 — tournament settlement guard

`settleTournamentEconomy(tournamentId)` behaviour matrix:

| `prize_pool_minor` | Outcome |
| ------------------ | ------- |
| `= 0` | Insert `settlement_events` `status='processing'` → flip to `completed`. Audit `settlement.tournament_foundation_no_payout`. |
| `> 0` | Insert `settlement_events` `status='requires_payout'`. Audit `settlement.tournament_requires_payout` at `warning`. Return `{ ok: false, reason: 'payout_not_implemented' }`. |

The "fake-complete with prize > 0" failure mode is now impossible.

## Pipeline (settleMatchEconomy)

```
[1] Verify match_results row exists.
       → Missing? Return { ok: false, reason: "result_missing" }.

[2] Pre-flight settlement_events lookup.
       → If status=completed → return { ok: true, alreadyProcessed: true }.

[3] INSERT INTO settlement_events (status='processing').
       → 23505 unique_violation → benign duplicate, return early.

[4] Fetch all escrow_locks rows for the match (status='locked' only).

[5] For each escrow row:
        is_draw   → refundMatchEscrow()  (locked → available, status=refunded)
        winner_id → releaseMatchEscrow(payout)  (credit full pot, status=settled)
        loser_id  → releaseMatchEscrow(consume) (debit locked, status=settled)

[6] UPDATE settlement_events SET status='completed', processed_at=now().

[7] emitAuditEvent('settlement.match_completed', ...).

[8] [Settlement] log line.
```

Any failure at step [5] → settlement_events stays `processing`. The
audit row records the failure. A reconciliation cron (future sprint)
sweeps stuck rows and replays.

## Idempotency model

Three independent layers guard against double-settlement:

1. **Application flag** (`room.settlementStarted`) — set in
   `endMatch()` before invoking the pipeline. Prevents two concurrent
   invocations on the same room.
2. **settlement_events unique index** — prevents two distinct rows for
   the same `(room_code, match_instance, settlement_type)`.
3. **Per-player idempotency key** on every ledger entry — prevents
   double-payout / double-refund for the same player.

If all three fail (very rare), the wallet RPC's `FOR UPDATE` lock plus
the unique constraint on ledger rows make the worst case a partial
duplicate which the reconciliation cron will detect.

## Why settle AFTER result

* Settlement before result = trusting an unconfirmed outcome.
* Settlement after result = the ledger is a function of an immutable,
  rate-limited table (`match_results`).
* Replays are then mathematical: re-running settlement on the same
  match cannot produce a different outcome.

## Failure modes & recovery

| Failure | Symptom | Recovery |
| ------- | ------- | -------- |
| ledger RPC returns 23505 | Same key already used | Treat as benign, mark completed |
| escrow row missing | Match was free-pass / staked-via-legacy | `escrows.length === 0` → settlement is a no-op, still mark completed |
| ledger RPC raises non-23505 | DB outage / constraint violation | settlement_events stays `processing`; cron sweeper retries |
| `match_results` missing | Result save crashed | settleMatchEconomy returns `{ ok: false, reason: "result_missing" }`; do not start settlement |
| Concurrent invocations | Two replicas | First INSERT wins; second gets 23505 and returns `alreadyProcessed: true` |

## Reconciliation cron (future)

Selects:

* `settlement_events.status='processing'` older than 5 minutes.
* For each, asserts ledger correctness, applies missing entries, flips
  to `completed` or `failed`.

This cron is documented but **not implemented in Phase 10**. The
foundation is in place — the cron is a future sprint.

## Tournament settlement

Phase 10 tournament settlement is a SHELL:

* Inserts `settlement_events` (scope='tournament').
* Marks completed with `notes='phase10_foundation_no_payout'`.
* Emits an audit event.
* **Does NOT distribute prize money**.

Future sprint adds:

1. Sum all locked tournament_entry escrows.
2. Apply `rake_bps`.
3. Walk `payout_structure` and credit each finisher.
4. Refund non-finishers if tournament was cancelled.
