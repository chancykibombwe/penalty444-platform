# Economy Architecture (Phase 10 Foundation)

> Foundation only. Builds on `docs/pre-economy-architecture.md`.
> No real-money integration yet.

## Layered design

```
┌──────────────────────────────────────────────────────┐
│  Web client (apps/web)                               │
│    - READS wallet snapshot + ledger via Supabase RLS │
│    - NEVER initiates money movements                 │
│    - NEVER computes balances from primitives         │
└────────────┬─────────────────────────────────────────┘
             │ Supabase RLS (self-read on wallets / ledger)
             │
┌────────────▼─────────────────────────────────────────┐
│  Supabase Postgres                                   │
│    - wallets, wallet_ledger_entries (append-only),   │
│      escrow_locks, settlement_events, audit_events   │
│    - SERVICE-ROLE-ONLY function:                     │
│         economy_apply_ledger_entry(...)              │
│    - RLS: clients can read OWN wallet/ledger/escrow  │
│      rows only; settlements + audit are SR-only.     │
└────────────▲─────────────────────────────────────────┘
             │ service role key
             │
┌────────────┴─────────────────────────────────────────┐
│  Realtime server (apps/realtime-server)              │
│    - The ONLY caller of economy_apply_ledger_entry   │
│    - Wraps the RPC in idempotent service helpers     │
│        wallet.ts   – getOrCreateWallet, ledger entry │
│        escrow.ts   – lock / release / refund         │
│        settlement.ts – settleMatchEconomy, etc.      │
│    - Gated by ECONOMY_ENABLED env flag               │
└──────────────────────────────────────────────────────┘
```

## Why this shape

* **Append-only ledger.** Mutating history makes fraud silent. Inserting
  forces every change to be discoverable, replayable, and verifiable.
* **Derived balances.** `wallets.available_balance_minor` and
  `locked_balance_minor` are projections of the ledger. They exist for
  read speed; a reconciliation cron asserts
  `sum(ledger.delta) == wallet.balance` per `(user_id, currency)`.
* **Idempotency keys everywhere.** Retries are inevitable in a
  distributed system. Stable keys collapse retries onto the same row.
* **Server authority.** Only the realtime server holds the service role
  key. Even a malicious DB-aware client cannot mutate wallets / ledger /
  escrow.

## State machines

### Wallet

```
active  ──(admin)──▶ suspended  ──(admin)──▶ active
   │                     │
   └──(admin)──▶ locked  └──(admin)──▶ active
```

* `active`: ledger entries allowed.
* `suspended`: reads work, writes rejected.
* `locked`: hard freeze (fraud / sanctions).
* Only the service-role helpers may flip a status; no client policy.

### Escrow

```
pending  ──(ledger debit ok)──▶ locked  ──(payout)──▶ settled
   │                                 │
   │                                 └──(refund)────▶ refunded
   │
   └──(ledger debit fails)─▶ failed
```

* Terminal states: `settled`, `refunded`, `failed`.
* No transitions OUT of terminal states.

### Settlement

```
pending  ──(start)──▶ processing  ──(success)──▶ completed
                          │
                          └──(error)────────────▶ failed
                                                    │
                                                    └─ (manual)──▶ reversed
```

* `settlement_events` is the **only** record of "did we settle this".
* `UNIQUE (room_code, match_instance, settlement_type)` for matches and
  `UNIQUE (tournament_id, settlement_type)` for tournaments.
* `reversed` is reserved for ops tooling; not used in Phase 10.

## Money flow — match

```
1. Player joins lobby with stake.
2. lockMatchEscrow(userId, roomCode, matchInstance, amountMinor)
     → inserts escrow_locks (pending → locked)
     → ledger debit: available → locked  (transaction_type=escrow_lock)
3. tournament:matchReady / room:ready emitted by realtime server.
4. Match plays.
5. saveMatchResult(room) persists match_results (Sprint 1 idempotency).
6. settleMatchEconomy(roomCode, matchInstance)
     → asserts match_results row exists
     → inserts settlement_events (processing)
     → for each player:
        - draw  → refundMatchEscrow (ledger credit locked→available)
        - win   → releaseMatchEscrow(payout) credits full pot
        - loss  → releaseMatchEscrow(consume) zeroes their locked
     → updates settlement_events.status = completed
     → emits audit row + [Settlement] log
```

**Ordering invariants:**

* (a) Escrow locked BEFORE match starts (already required for staked
  matches today; new code unifies the path).
* (b) match_results row exists BEFORE settlement starts (Sprint 1).
* (c) `settlement_events` row inserted BEFORE any per-player ledger
  movement (so a retry sees `processing` and short-circuits).
* (d) Every per-player movement uses a stable idempotency key
  (`createMatchEscrowKey(...)`).

## Money flow — tournament (foundation)

Phase 10 only inserts a settlement_events row and audit log when a
tournament completes. No prize distribution yet. The schema is in place
for a future sprint to:

1. Sum locked tournament_entry escrows.
2. Apply rake_bps to compute pool.
3. Distribute per `payout_structure`.
4. Mark all entry escrows as `settled`.

## Concurrency model

`economy_apply_ledger_entry` performs `SELECT ... FOR UPDATE` on the
wallet row. Concurrent ledger writes for the same wallet serialize.

The `wallet_ledger_entries.UNIQUE (user_id, idempotency_key)` constraint
turns concurrent identical retries into a single row plus a benign
unique-violation.

The `settlement_events.UNIQUE` indexes (per scope) make duplicate
settlements impossible.

## Frontend contract

The web wallet UI is **strictly read-only**:

| Action | Allowed | Notes |
| ------ | ------- | ----- |
| Read wallet for self | ✅ | RLS: `wallets_self_read` |
| Read ledger for self | ✅ | RLS: `wallet_ledger_self_read` |
| Read escrow for self | ✅ | RLS: `escrow_locks_self_read` |
| Initiate deposit | ❌ | "Coming soon" UI only |
| Initiate withdrawal | ❌ | "Coming soon" UI only |
| Initiate match settlement | ❌ | Realtime server only |
| Initiate refund | ❌ | Ops tool only (future) |

## Feature flags (Phase 11 integration)

| Flag | Default | Effect |
| ---- | ------- | ------ |
| `ECONOMY_ENABLED` | `false` | Master switch. When `false` the entire economy code path is dead and gameplay behaves exactly as Sprint 1. |
| `ECONOMY_TEST_MODE` | `false` | When `ECONOMY_ENABLED=true` AND this is `true`, the realtime server enters test mode. Internal `/internal/economy/test-seed` endpoint becomes available. |
| `ECONOMY_REAL_MONEY_ENABLED` | `false` | Always `false` in Phase 11. Real-money payment integration is not built. |
| `NEXT_PUBLIC_ECONOMY_MODE` | `off` | Browser-visible mode label: `off` / `test` / `live`. Used by `WalletPanel` to display the right badge. |
| `SOCKET_JWT_ENFORCE` | `false` | Hardening Sprint 2 + Phase 12 launch blocker. Must be `true` before real money is enabled. |
| `ECONOMY_RECONCILIATION_ENABLED` | `false` | Reserved for the future periodic worker. The reconciliation endpoint always works when economy is on. |

Mode resolution on the realtime server (`getEconomyMode()`):

```
ECONOMY_ENABLED=false                          → mode = "off"
ECONOMY_ENABLED=true + ECONOMY_REAL_MONEY=true → mode = "live"  (not used in Phase 11)
ECONOMY_ENABLED=true + ECONOMY_TEST_MODE=true  → mode = "test"
otherwise                                      → mode = "off"  (fails closed)
```

### Phase 12 — operations layer

Phase 12 added the recovery / reconciliation layer. See
`docs/economy-operations.md` for the full runbook. Highlights:

* `apps/realtime-server/src/economy/reconciliation.ts` exports
  `reconcileEconomy()`, `reconcileStuckSettlements()`,
  `reconcileOrphanEscrows()`, `reconcileTournamentEscrows()`, and
  `reconcileWalletConsistency()`.
* `apps/realtime-server/src/economy/state.ts` is the single source of
  truth for escrow / settlement state transitions
  (`validateEscrowStateTransition`, `validateSettlementStateTransition`,
  terminal-state checks).
* Five new internal endpoints under `/internal/economy/*` expose ops
  visibility.
* `settleTournamentEconomy` is now stricter — refuses to fake-complete
  when `prize_pool_minor > 0` (Phase 12 TASK 4).
* `settleMatchEconomy` rejects pot calculations that do not see exactly
  two locked escrows (Phase 12 TASK 6).
* `settlement_events` gained `retry_count`, `last_retry_at`,
  `failure_reason`, plus status values `requires_payout` and
  `manual_review`. `escrow_locks.status='manual_review'` is the new
  parking lot. Migration:
  `supabase/migrations/20260523093000_economy_recovery_v1.sql`.

When mode is `"off"`:

* `lockMatchEscrowForPlayer`, `refundMatchEscrowForPlayer`,
  `refundAllMatchEscrows`, `settleMatchEconomyForRoom` all short-circuit
  with `{ ok: true, skipped: true, reason: "economy_off" }`.
* The legacy `wallet/stakes.ts` path still runs for staked free-pass
  matches exactly as before.
* The wallet UI shows "Free Play" mode and the standard wallet
  placeholder.

When mode is `"test"`:

* Match host/guest escrow locks fire in parallel with the legacy lock.
* If the economy lock fails (e.g. insufficient test balance), the
  legacy lock is unwound and the room is torn down (host) or the legacy
  lock is reverted (guest). The player is never charged on either side.
* `settleMatchEconomyForRoom` runs after `saveMatchResult` succeeds
  AND `settleStakes` completes. Failure is logged but does not corrupt
  the legacy settlement.
* Tournament entry escrow runs via the `/api/economy/tournament-entry`
  proxy → realtime-server `/internal/economy/tournament-entry/{lock,refund}`.
* Test wallet seeding is gated by the realtime-internal secret AND
  `ECONOMY_TEST_MODE=true`. Idempotency key is
  `test_seed:<userId>:<amountMinor>:<note>`.

## Reconciliation

The following invariants must be asserted nightly once economy goes live:

1. `wallet.available_balance_minor` = SUM(ledger.delta where direction
   affects available).
2. `wallet.locked_balance_minor` = SUM(escrow_locks.amount_minor where
   status='locked').
3. Every `settlement_events.completed` row has a matching set of
   ledger entries (deterministic via idempotency keys).
4. No row in `escrow_locks` has been in `pending` for > 5 minutes.
5. No row in `settlement_events` has been in `processing` for > 5 minutes.

Mismatches trigger an alarm, freeze the affected user(s), and route to
on-call ops.
