# Pre-Economy Architecture

> Hardening Sprint 2 — TASK 10.
> **Documentation only. No code in this sprint touches money.**
> Owner: platform + finance.

This document defines the **non-negotiable architecture** that must be
in place before the platform handles real-money stakes, prize pools, or
payouts. Every section ends with a "Definition of Done" checklist; none
of them are satisfied yet.

---

## 1. Wallet ledger model

We use an **append-only double-entry ledger**. There is no UPDATE on
ledger rows after insert.

```
wallet_ledger
  id              UUID PK
  user_id         UUID NOT NULL
  delta_minor     BIGINT NOT NULL   -- signed; in smallest currency unit
  currency        TEXT NOT NULL
  reason          TEXT NOT NULL     -- enum (see below)
  reference_type  TEXT              -- e.g. 'match_escrow', 'tournament_payout'
  reference_id    UUID              -- FK target id (no hard FK; soft join)
  idempotency_key TEXT NOT NULL     -- UNIQUE w/ user_id (see §5)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  UNIQUE (user_id, idempotency_key)
```

`wallet_balances` is a **derived projection**:

```
wallet_balances
  user_id    UUID PK
  currency   TEXT
  amount_minor BIGINT NOT NULL DEFAULT 0
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (user_id, currency)
```

* Updated **only** inside the same transaction as the ledger insert.
* Equivalent to `SUM(delta_minor)`; we keep it materialised for read
  speed and so the wallet UI doesn't have to scan the full ledger.
* Periodic invariant job: `assert amount_minor == sum(delta_minor)` per
  `(user_id, currency)`. Mismatch → ALARM, freeze the user, escalate.

### Reason enum

```
deposit
withdrawal
match_escrow_lock
match_escrow_release
match_escrow_payout
tournament_escrow_lock
tournament_escrow_release
tournament_payout
refund
manual_adjustment
```

### Definition of Done

* [ ] Tables exist with RLS configured per `docs/rls-audit-checklist.md`.
* [ ] Service-role-only RPC `apply_wallet_delta(user_id, delta, reason, ref_type, ref_id, idem_key)` exists.
* [ ] The RPC enforces `wallet_balances.amount_minor + delta >= 0` inside the txn.
* [ ] Insert + balance update happen in a single SQL transaction.
* [ ] No code path mutates `wallet_balances` without inserting into `wallet_ledger`.

---

## 2. Escrow model

Funds in flight (stakes, prize pools) live in **escrow tables**, not
in user wallets.

```
match_escrow
  id            UUID PK
  room_code     TEXT NOT NULL
  match_instance INTEGER NOT NULL DEFAULT 1
  stake_minor   BIGINT NOT NULL
  currency      TEXT NOT NULL
  player_one_id UUID NOT NULL
  player_two_id UUID NOT NULL
  status        TEXT NOT NULL DEFAULT 'locked' -- locked | released | refunded
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  resolved_at   TIMESTAMPTZ
  UNIQUE (room_code, match_instance)   -- mirrors match_results
```

```
tournament_escrow
  id            UUID PK
  tournament_id UUID NOT NULL
  user_id       UUID NOT NULL
  stake_minor   BIGINT NOT NULL
  currency      TEXT NOT NULL
  status        TEXT NOT NULL DEFAULT 'locked'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  resolved_at   TIMESTAMPTZ
  UNIQUE (tournament_id, user_id)
```

### Rules

* Lifecycle: `locked → released | refunded`. Never re-lockable. To
  collect another stake from the same player we insert a new row.
* On **lock**, ledger debits the user once with reason `*_escrow_lock`
  and `idempotency_key = "escrow:<escrow.id>:lock"`.
* On **release** (loss / forfeit), ledger does NOTHING for the loser;
  the escrow row simply transitions to `released` and the funds become
  prize pool (see §4).
* On **payout** (win), ledger credits the winner with reason
  `*_escrow_payout` and `idempotency_key = "escrow:<escrow.id>:payout"`.
* On **refund** (cancelled match / cancelled tournament), ledger
  credits each player with reason `*_escrow_release` and
  `idempotency_key = "escrow:<escrow.id>:refund"`.

### Definition of Done

* [ ] Tables exist with service-role-only RLS.
* [ ] `match_escrow.UNIQUE(room_code, match_instance)` aligns with
      `match_results_room_instance_unique`.
* [ ] Status transitions enforced by `CHECK` constraints + service-role
      stored procedures.

---

## 3. Stake locking

Stake locking happens **before** the match starts and is the only
gate between "wallet money" and "in-flight money".

Sequence (free-pass mode disables steps 1–3 and starts at step 4):

1. Player joins lobby and indicates stake.
2. Edge function `lockMatchStakes(roomCode, stakeMinor)` runs in a
   single SQL txn:
   * Insert one `match_escrow` row.
   * Insert two `wallet_ledger` debits (one per player) with
     `idempotency_key = "escrow:<escrow.id>:lock:<userId>"`.
   * Update both `wallet_balances` rows.
3. Realtime server is notified (`tournament:matchReady` /
   `room:ready`) **only after** all three writes commit.
4. Match plays.
5. On match end → `endMatch` calls the new
   `settleMatchEscrow(roomCode, matchInstance, winnerId | null)`:
   * Look up the escrow row.
   * If draw / no winner → refund both via ledger.
   * If winner → credit `2 * stake_minor - platform_fee` to winner.
   * Flip escrow status.

### Rules

* Stake-lock failure aborts the match start. We do **not** start a
  match with partially-locked stakes.
* The realtime server's existing idempotency story
  (`room.resultSaved`, `room.progressionApplied`) is reused; stake
  settlement adds `room.escrowSettled` to the same set of flags.
* Stakes are **immutable** once locked. The UI never offers "adjust
  stake mid-match".

### Definition of Done

* [ ] `lockMatchStakes` RPC + `settleMatchEscrow` RPC exist.
* [ ] Realtime server `endMatch` calls `settleMatchEscrow` AFTER
      `saveMatchResult` succeeds and BEFORE `settleStakes` (legacy
      free-pass code path is preserved).
* [ ] In-memory `room.escrowSettled` flag added to `Room` type.

---

## 4. Prize pool model

For tournaments the prize pool is the **sum of locked entry stakes**
minus the platform fee.

```
tournament_prize_pool   -- view, not a table
  tournament_id
  pool_minor = SUM(match_escrow.stake_minor)
               - platform_fee_minor
```

### Distribution

Default 100% to first place. Configurable per-tournament:

```
tournaments
  ...
  payout_structure JSONB   -- { "1": 1.0 } or { "1": 0.7, "2": 0.2, "3": 0.1 }
  platform_fee_bps INTEGER NOT NULL DEFAULT 0    -- basis points
```

### Rules

* Payouts happen atomically when the bracket completes
  (`tournaments.status = 'completed'`).
* A single transaction:
  1. Marks every `tournament_escrow` row `released`.
  2. Inserts ledger credits for each prize position with
     `idempotency_key = "tournament:<id>:payout:<position>"`.
  3. Inserts a ledger debit to the platform fee wallet.
* Reconciliation invariant: `sum(payouts) + platform_fee_total ==
  sum(locked_stakes)`. CI invariant job runs nightly.

### Definition of Done

* [ ] `payout_structure` validated at tournament creation time.
* [ ] `platform_fee_bps` enforced on every payout (no silent zero).
* [ ] Invariant job exists and alerts on drift.

---

## 5. Payout idempotency

Every ledger write requires an `idempotency_key`. Format:

```
<domain>:<entityId>[:<sub-action>][:<userId>]
```

Examples:

```
escrow:8a1f...:lock:b2c5...
escrow:8a1f...:payout
tournament:9d3c...:payout:1
manual:adjustment-2026-05-22-001
```

Rules:

* `wallet_ledger` enforces `UNIQUE (user_id, idempotency_key)`.
* Service-role RPCs treat a unique violation as **success** and return
  the existing row (mirror of Sprint 1's `saveMatchResult` 23505 path).
* No payout function ever generates random idempotency keys — they
  must be derivable from the underlying entity so retries collapse.

### Definition of Done

* [ ] All payout RPCs accept (and require) an `idempotency_key` parameter.
* [ ] Retries from the realtime server are safe — same key, same row.
* [ ] Edge-case test: triggering payout twice in 10ms results in one
      ledger row.

---

## 6. Refund flow

Refunds happen on:

* Match cancelled before completion (`abortMatchEarly` in free-pass
  mode; for staked mode it would refund both stakes).
* Tournament cancelled by admin.
* Disputed match resolved in favour of refund (manual ops).

### Rules

* Refund credits the user with `reason = '*_escrow_release'`.
* Escrow status flips `locked → refunded`.
* Idempotency key: `escrow:<id>:refund:<userId>`.
* Manual ops refunds use a separate reason `manual_adjustment` and
  require a justification field (free-text, stored on the ledger row).

### Definition of Done

* [ ] Refund RPCs exist and are idempotent.
* [ ] Admin tool surfaces refunds with audit context (§7).

---

## 7. Audit logs

Every state transition that touches money emits an audit event.

```
audit_events
  id           UUID PK
  actor_id     UUID            -- user id or NULL for system
  actor_kind   TEXT NOT NULL   -- 'user' | 'system' | 'admin'
  event_type   TEXT NOT NULL   -- ledger.insert | escrow.transition | etc.
  payload      JSONB NOT NULL
  ip_address   INET
  user_agent   TEXT
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```

* Read-only after insert.
* Service role only.
* Retained for the maximum of:
  * 7 years (financial regulation default), OR
  * 2 years post-account-closure.

### Definition of Done

* [ ] Audit table exists with service-role-only RLS.
* [ ] Every ledger/escrow/payout RPC inserts an audit row in the same
      transaction.
* [ ] Audit log is immutable (no UPDATE / DELETE grants, not even
      service role; archive-and-truncate only).

---

## 8. Transaction ordering

Critical orderings to never violate:

1. **Stake lock → match start.** The realtime server may not emit
   `match:start` until `lockMatchStakes` has committed.
2. **Match result save → stake settlement.** Sprint 1 already enforces
   this for casual matches (`saveMatchResult` → `settleStakes`). The
   economy version adds `settleMatchEscrow` between them.
3. **Bracket advance → escrow release for the loser slot.** The
   realtime server's existing bracket-advance idempotency
   (`room.bracketAdvanced`) is reused. The escrow release is a
   side-effect *after* `winner_entry_id` is persisted.
4. **Tournament completion → prize pool payout.** Pool payout fires
   only after `tournaments.status` transitions to `completed` and the
   final match's bracket-advance has committed.

In all four cases the *trailing* operation is the one that can be
retried. The *leading* operation is the single source of truth for "did
this happen".

### Definition of Done

* [ ] Each ordering has a runtime guard and a passing integration test.
* [ ] Retries of trailing operations are idempotent.

---

## 9. KYC / compliance placeholder

Real-money play is gated behind KYC. This is not implemented yet, but
the schema reserves space:

```
auth.users (Supabase managed)
public.kyc_status
  user_id        UUID PK REFERENCES auth.users(id)
  status         TEXT NOT NULL DEFAULT 'pending' -- pending | verified | rejected
  provider       TEXT
  provider_ref   TEXT
  verified_at    TIMESTAMPTZ
  country        TEXT
  jurisdiction   TEXT
```

Rules:

* `wallet_ledger` deposits / withdrawals require
  `kyc_status.status = 'verified'`.
* Withdrawals additionally require a 24h-old verification (no
  same-day-create-and-cash-out).
* Sanctions screening hook on every `deposit` and `withdrawal`.
* Per-jurisdiction caps (daily, monthly) stored alongside.

This section is a **placeholder**, not a design. Real KYC requires
provider selection (Onfido / Persona / Sumsub), licensing review per
jurisdiction, and a legal sign-off.

### Definition of Done

* [ ] KYC provider selected.
* [ ] Jurisdictional rules enumerated and reviewed by counsel.
* [ ] No deposit/withdrawal RPC works without `kyc_status = 'verified'`.

---

## 10. Non-negotiable rules before real money

This is the gate. **None of these are optional.**

1. Sprint 1 + Sprint 2 hardening fully shipped and observed in prod for
   ≥ 4 weeks with no `[Settlement]` / `[TournamentAdvance]` anomalies.
2. `match_results_room_instance_unique` constraint live in prod.
3. RLS policies in `docs/rls-audit-checklist.md` applied and CI-asserted.
4. JWT enforcement (`SOCKET_JWT_ENFORCE=true`) on; anonymous sockets
   rejected.
5. Wallet ledger, escrow, audit log tables exist with the schemas above.
6. Every ledger / escrow / payout RPC has an idempotency key and a
   passing dedupe integration test.
7. Reconciliation cron job exists and has run at least 7 days without
   raising an alarm.
8. Disaster recovery plan written:
   * how do we freeze withdrawals?
   * how do we replay the ledger?
   * who has the kill switch?
9. KYC provider integrated and verified for at least one jurisdiction.
10. Legal / compliance sign-off in writing for the launch jurisdiction.
11. Bug bounty programme open for ≥ 2 weeks pre-launch.
12. Soft launch with a capped daily volume (e.g. $5k) before raising
    limits.

If even one box is unchecked, **we do not ship real money.**
