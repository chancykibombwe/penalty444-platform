# Legacy Stakes Migration Plan

> Phase 12 — documentation only. No code change.

## Background

Two wallets coexist in the codebase:

* **Legacy.** `apps/realtime-server/src/wallet/stakes.ts` calls the
  `lock_wallet_stake`, `settle_wallet_stakes`, and `unlock_wallet_stake`
  Postgres RPCs against a pre-economy `wallets` table that predates
  Phase 10. Free-pass / non-staked play uses this path today.
* **Economy.** `apps/realtime-server/src/economy/*` writes against the
  new `wallets`, `wallet_ledger_entries`, `escrow_locks`,
  `settlement_events`, and `audit_events` tables introduced by the
  Phase 10 migration. Wired into the match / tournament lifecycle
  behind `ECONOMY_ENABLED` in Phase 11.

When `ECONOMY_ENABLED=true` both paths run **in parallel** for any
staked match. That is intentional for `ECONOMY_TEST_MODE` (parallel
test wallets so the legacy free-pass flow is never broken). It is
**NOT** acceptable for real-money launch: one of the two systems must
be the single source of truth for live balance.

This document is the migration plan.

## Risks of coexistence

| # | Risk | Severity |
| - | ---- | -------- |
| 1 | Player has different balances in the two systems → user-visible drift | High |
| 2 | Legacy `settle_wallet_stakes` succeeds but economy `settleMatchEconomy` fails (or vice-versa) → support burden | High |
| 3 | Audit trail is split across two tables → forensic queries miss half the truth | Medium |
| 4 | Refund logic is duplicated → bugs need to be fixed in two places | Medium |
| 5 | Operators see two wallet UIs / surfaces in Phase 13+ | Low |

## Target end-state

`apps/realtime-server/src/wallet/stakes.ts` deleted. Every stake / refund
goes through the ledger. The `wallets` schema, the legacy RPCs, and any
client code that reads them are removed.

## Migration steps

### Step 1 — coexistence (today)

* `ECONOMY_ENABLED=false` everywhere → only legacy runs.
* Phase 10 + 11 code is dormant.
* Status: ✅ shipped.

### Step 2 — internal economy test mode

* `ECONOMY_ENABLED=true` + `ECONOMY_TEST_MODE=true` in staging.
* Both paths run. Test wallets are seeded via
  `/internal/economy/test-seed`.
* Phase 12 reconciliation worker runs nightly to ensure no orphans.
* Status: ✅ shipped (this phase).

### Step 3 — economy-as-canonical (planned)

* Flip a new flag `LEGACY_STAKES_DISABLED=true`. When set:
  * `lockStake` / `unlockStake` / `settleStakes` / `refundBothStakes`
    short-circuit to `{ ok: true, message: "legacy_disabled" }`
    when `stakeAmount === 0` (free play unchanged).
  * Staked play uses economy escrow only; legacy RPCs are never called.
* Balances in legacy `wallets` table are read-only and shown side-by-side
  with the new wallet for the migration window.
* Status: 🔜 Phase 13.

### Step 4 — one-time balance import

* Service-role migration script reads each legacy wallet row and writes
  a `migration_import` ledger deposit into `wallet_ledger_entries`.
* Idempotency key:
  `legacy_import:<userId>:<legacyBalanceMinor>:<migrationVersion>`.
* Audit event `wallet.legacy_imported` emitted per user.
* Status: 🔜 Phase 13.

### Step 5 — legacy removal

* Drop the legacy wallet RPCs.
* Delete `apps/realtime-server/src/wallet/stakes.ts`.
* Delete `apps/web/src/lib/wallet/legacyWallet.ts` (and any UI hooks).
* Drop the legacy `wallets` columns that economy doesn't use.
* Status: 🔜 Phase 14.

## Test plan

For each step:

1. Run the Phase 11 test checklist (matches, tournaments,
   free / staked / abort flows).
2. Run the Phase 12 reconciliation pass and verify the summary shows
   zero drift.
3. Manually verify a paid match in test mode credits the winner exactly
   `2× stake_minor` in the ledger and zero in the legacy wallet (Step 3+).
4. Spot-check audit events for every state transition.

## Rollback plan

| Step | Rollback |
| ---- | -------- |
| Step 2 → 1 | `ECONOMY_ENABLED=false`. Test wallets remain in DB but go dormant. |
| Step 3 → 2 | `LEGACY_STAKES_DISABLED=false`. Both paths active again. No data loss because economy writes never moved legacy money. |
| Step 4 → 3 | Delete `migration_import` ledger rows by idempotency-key prefix. Legacy balances are unchanged (the import does not debit them). |
| Step 5 → 4 | Restore deleted files from git. Re-add the dropped columns from a backup. |

## Open questions

* **Multi-currency.** Legacy stakes are denominated in "K" (Kinshasa
  units, not a real currency). The economy uses `P4C` (Penalty444
  Credits). The mapping is `1 K = 100 P4C minor`. We need a one-time
  decision before Step 4 whether the import preserves the K-balance
  or rescales it.
* **Refund-on-import.** If a legacy match is mid-flight at the moment
  of the import script, we need a 24-hour soak window where Step 3
  blocks new staked matches.
