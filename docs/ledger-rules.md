# Ledger Rules

> Phase 10. Defines the non-negotiable rules for `wallet_ledger_entries`.

## Append-only

* The ledger is **append-only**. The migration grants only `SELECT` to
  authenticated users (scoped to `auth.uid() = user_id`); no
  `UPDATE` / `DELETE` policies exist.
* Service-role code never updates ledger rows either. Corrections
  happen by inserting an opposing entry (a credit cancelling a previous
  debit), not by mutating history.
* `wallet_ledger_entries.created_at` is the canonical timeline.

## Direction & amount

* `direction` is `credit` or `debit`. The verb that moves money.
* `amount_minor` is **always positive**. The signed delta is computed
  by the consumer from `(direction, amount_minor)`.
* `balance_before_minor` and `balance_after_minor` are stamped inside
  `economy_apply_ledger_entry` to make verification self-contained.

## Pockets

The wallet has two pockets:

* `available_balance_minor` — spendable.
* `locked_balance_minor` — reserved (escrow).

Each ledger entry targets exactly one pocket via `metadata.pocket`
(server-side; the column doesn't exist on the row by design — pocket
is derived from `transaction_type`). The RPC accepts:

| pocket | direction | effect |
| ------ | --------- | ------ |
| available | credit | `available += amount` |
| available | debit  | `available -= amount` |
| locked    | credit | `locked    += amount` |
| locked    | debit  | `locked    -= amount` |
| transfer  | debit  | `available -= amount` and `locked += amount` (escrow lock) |
| transfer  | credit | `locked    -= amount` and `available += amount` (escrow release/refund) |

`transfer` keeps total equity constant; it just shifts between pockets.

## Idempotency

* `UNIQUE (user_id, idempotency_key)`.
* Retries collapse into one row. Postgres returns `23505`; the
  service helper catches it, re-reads the existing row, and returns
  `{ ok: true, created: false }`.
* **Never** generate idempotency keys with `Math.random()` or `uuid()`.
  Keys must be derivable from the underlying entity. See
  `idempotency.ts`:
  ```
  createMatchEscrowKey(roomCode, matchInstance, action, userId?)
  createTournamentEntryEscrowKey(tournamentId, action, userId)
  createTournamentPayoutKey(tournamentId, position, userId)
  createSettlementKey(scope, ids, settlementType)
  ```

## Transaction types

```
deposit                – funds added from external payment gateway (future)
withdrawal             – funds removed to external payment gateway (future)
escrow_lock            – available → locked (match / tournament stake)
escrow_release         – locked → 0       (loser stake consumed)
escrow_payout          – locked → available (winner receives pot)
escrow_refund          – locked → available (match cancelled / aborted)
tournament_entry_fee   – available → locked (tournament entry)
tournament_prize_payout – locked → available (tournament finishing position)
tournament_entry_refund – locked → available (tournament cancelled)
manual_adjustment      – admin-only; requires audit_events row with justification
```

The `CHECK` constraint on the column enforces this set.

## Constraints

* `amount_minor > 0`
* `direction IN ('credit', 'debit')`
* `transaction_type IN (...)`
* `UNIQUE (user_id, idempotency_key)`

## Reading

* Web reads scoped to `auth.uid() = user_id`.
* Realtime server reads via service role for reconciliation.
* No client reads other users' ledgers; profiles show
  competitive stats (from `player_stats`), NEVER any wallet detail.

## Non-negotiables

1. No `UPDATE` on ledger rows. Ever.
2. No client-generated idempotency keys. Server only.
3. No frontend computes payouts; only displays formatted values.
4. No transaction without an audit row in the same logical operation.
