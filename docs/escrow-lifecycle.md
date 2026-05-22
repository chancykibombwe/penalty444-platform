# Escrow Lifecycle

> Phase 10 foundation, Phase 11 integration.

## Phase 11 integration points

| Lifecycle event | Call site | Helper |
| --------------- | --------- | ------ |
| Public offer create (host stake) | `socket/publicOffers.ts → publicOffer:create` | `lockMatchEscrowForPlayer(room, hostId)` AFTER `lockStake` succeeds. Failure rolls back legacy lock and tears down the room. |
| Public offer join (guest stake) | `socket/publicOffers.ts → publicOffer:join` | `lockMatchEscrowForPlayer(room, guestId)` AFTER guest's `lockStake` succeeds. Failure reverts the legacy lock. |
| Public offer cancel | `socket/publicOffers.ts → publicOffer:cancel` | `refundMatchEscrowForPlayer(room, hostId)` AFTER legacy `unlockStake`. |
| Match end (settled) | `index.ts → endMatch` | `settleMatchEconomyForRoom(room)` AFTER `saveMatchResult` AND `settleStakes`. |
| Match abort early | `index.ts → abortMatchEarly` | `refundAllMatchEscrows(room)` AFTER legacy `refundBothStakes`. |
| Tournament entry join | `components/tournament/TournamentEntryActions.tsx` → `/api/economy/tournament-entry` proxy | `lockTournamentEntryForPlayer(...)` BEFORE the `tournament_entries.insert`. Insert rollback triggers `refundTournamentEntryForPlayer`. |
| Tournament entry withdraw | same as above | `refundTournamentEntryForPlayer(...)` AFTER the row update succeeds. |
| Tournament completion | `index.ts → advanceTournamentBracket` (after `maybeCompleteTournament` returns true) | `settleTournamentEconomyForTournament(tournamentId)` — foundation only, does not distribute prizes yet. |

Every helper is a no-op when:

* `ECONOMY_ENABLED=false`, OR
* the stake / entry fee is `0`, OR
* `supabase` is not configured.

So free matches and free tournaments are entirely unaffected by Phase 11.

## Phase 12 status machine (updated)

```
pending  → locked         (lock succeeded)
pending  → failed         (ledger debit failed, no money moved)
pending  → manual_review  (recovery worker stuck)
locked   → settled        (release: payout or consume)
locked   → refunded       (refund)
locked   → manual_review  (recovery cannot decide safely)
manual_review → settled | refunded   (operator only)
```

`settled`, `refunded`, `failed` are terminal. `manual_review` is NOT
auto-recovered.

## Phase 12 — `refundTournamentEntryEscrowByRow`

Used by the reconciliation worker and the cancellation fanout. Takes
the full escrow row and refunds via the deterministic key
`tournament:<tournamentId>:entry:refund:<userId>`. Idempotent —
duplicate calls collapse onto the same ledger entry.

## Phase 12 — manual review helper

`markEscrowManualReview(escrowId, reason)` parks an escrow in
`manual_review`. No funds move. Emits
`escrow.manual_review_required` at `critical` severity. Operators
inspect via `GET /internal/economy/escrows/stuck`.

## What is escrow

Funds in flight: money that's left the user's available pocket but
isn't yet a final outcome (win / loss / refund). Stored in
`escrow_locks` with a status machine and a unique index per match-slot
or tournament-entry.

## Schema highlights

```
escrow_locks
  id              UUID PK
  user_id         UUID
  scope           'match' | 'tournament_entry'
  room_code       TEXT     -- match only
  match_instance  INTEGER  -- match only
  tournament_id   UUID     -- tournament_entry only
  amount_minor    BIGINT
  currency        TEXT
  status          'pending' | 'locked' | 'settled' | 'refunded' | 'failed'
  locked_at       TIMESTAMPTZ
  released_at     TIMESTAMPTZ
  refunded_at     TIMESTAMPTZ
  UNIQUE (room_code, match_instance, user_id) WHERE scope='match'
  UNIQUE (tournament_id, user_id) WHERE scope='tournament_entry'
```

## Status machine

```
pending  ──(ledger debit ok)──▶ locked  ──(payout)──▶ settled
   │                                 │
   │                                 └──(consume)───▶ settled
   │                                 │
   │                                 └──(refund)────▶ refunded
   │
   └──(ledger debit fails)─▶ failed
```

* All transitions are write-once. There is no return path from a
  terminal state.
* `pending` rows older than 5 minutes are stuck (cron sweeper).

## Lock flow

```
lockMatchEscrow({ userId, roomCode, matchInstance, amountMinor })

  1. INSERT INTO escrow_locks (status='pending').
        On 23505 → read existing row.

  2. If status in (locked, settled): return ok (idempotent).
     If status in (refunded, failed): return error (terminal).

  3. createLedgerEntry({
       direction:'debit', pocket:'transfer',
       transactionType:'escrow_lock',
       idempotencyKey: createMatchEscrowKey(..., 'lock', userId),
     })
     → moves available → locked
     → 23505 collapses to no-op

  4. UPDATE escrow_locks SET status='locked', locked_at=now()

  5. emitAuditEvent('escrow.locked', ...)
```

If step 3 fails, step 4 is skipped and the row is updated to `failed`
with `failure_reason`. The caller sees `{ ok: false }`.

## Release / payout flow

```
releaseMatchEscrow({ userId, ..., amountMinor, mode: 'payout' | 'consume' })

  payout: locked → available  via createLedgerEntry credit transfer
          (transaction_type=escrow_payout)
          → winner receives funds.

  consume: locked → 0          via createLedgerEntry debit locked
          (transaction_type=escrow_release)
          → loser's stake removed from their wallet (now in prize pool).

  Both modes:
  1. Read escrow row. Already 'settled' → idempotent return.
  2. Apply ledger entry with the appropriate idempotency key.
  3. UPDATE escrow_locks SET status='settled', released_at=now().
  4. emitAuditEvent('escrow.released').
```

## Refund flow

```
refundMatchEscrow({ userId, ..., amountMinor })

  1. Read escrow row. Already 'refunded' → idempotent return.
     Not 'locked' → error.
  2. createLedgerEntry credit transfer (locked → available),
     transaction_type=escrow_refund.
  3. UPDATE escrow_locks SET status='refunded', refunded_at=now().
  4. emitAuditEvent('escrow.refunded').
```

## Idempotency

Every ledger movement uses a deterministic key from `idempotency.ts`:

```
createMatchEscrowKey('ABCD12', 1, 'lock',   'user-uuid')
createMatchEscrowKey('ABCD12', 1, 'payout', 'user-uuid')
createMatchEscrowKey('ABCD12', 1, 'release','user-uuid')
createMatchEscrowKey('ABCD12', 1, 'refund', 'user-uuid')
```

Re-running the lock 100 times produces 1 ledger row and 1 escrow row.
Re-running the payout produces 1 ledger row regardless of how many
times the settlement pipeline is invoked.

## Non-negotiables

1. **No double-lock.** Unique index per `(room, instance, user)`.
2. **No double-payout.** Unique idempotency key per
   `(roomCode, matchInstance, action, userId)`.
3. **No release without a prior lock.** `releaseMatchEscrow` reads the
   row first and refuses unless `status='locked'`.
4. **No refund of a settled escrow.** Status guard.
5. **No client mutation.** RLS allows SELECT for self only; INSERT /
   UPDATE / DELETE require service role.

## Failure & cleanup

* `pending` for > 5min → cron flags as `failed` with reason
  `pending_timeout`.
* `locked` with no `match_results` row 1h after match end → cron
  triggers refund.
* `failed` rows are kept forever; they are the audit record of a
  failed lock attempt.

## What's NOT in Phase 10

* Real escrow money. The migration creates the tables and the helpers
  understand the lifecycle, but `ECONOMY_ENABLED=false` means the
  helpers are never called from the live match flow.
* Tournament prize escrow distribution. Entry escrow lock is wired;
  distribution waits for a future sprint.
* Cron reconciliation. Documented; not built.
