# Wallet Architecture & Coming Soon Guardrails

> Status: **Planning** — wallet is disabled for beta. This document
> defines the future architecture, current UI rules, and compliance
> checklist that must be satisfied before any real-money feature
> is activated.

---

## 1. Purpose

The 444 ARENA / Penalty444 beta operates under a strict **Free Play only**
policy. The wallet system is built as a foundation but must not be activated
during the beta phase. This document serves three purposes:

1. Record the intended future wallet architecture so engineers can build
   toward a consistent target.
2. Define the guardrails that prevent wallet functionality from accidentally
   surfacing to users before it is safe and legally cleared to do so.
3. Document the compliance checklist that must be completed before any
   real-money feature is enabled.

**No code in this document should be taken as an instruction to activate
wallet functionality.** Every section that describes a future feature is
explicitly scoped to a phase after Free Play beta ends.

---

## 2. Current Beta Wallet Policy

The following rules are absolute during the Free Play beta:

| Rule | Status |
|---|---|
| Wallet page | Coming Soon — redirects to `/account` |
| User balance display | Only shown if a real ledger row exists; no fabricated values |
| Deposits | Disabled — no UI, no API, no backend path |
| Withdrawals | Disabled — no UI, no API, no backend path |
| Paid matches | Disabled — `stakeLabel: "Free"` hardcoded in lobby |
| Paid tournaments | Disabled — `NEXT_PUBLIC_ECONOMY_MODE` defaults to `"off"` |
| Prize pools | Not offered — match room shows "Coming soon" |
| Fake transaction history | Never populated — ledger is empty for beta users |
| Fake balances | Never set — wallet panel shows placeholder when no row exists |
| Payment provider integration | Not wired |

### Environment state

`NEXT_PUBLIC_ECONOMY_MODE` is not set or set to `"off"` in all beta
environments. The `getPublicEconomyMode()` helper in
`apps/web/src/lib/economy/mode.ts` fails closed — it returns `"off"` for
any value other than `"test"` or `"live"`. The realtime server is gated by
`ECONOMY_ENABLED`, which defaults to `false`.

No code path should check `NEXT_PUBLIC_ECONOMY_MODE` and then enable any
money movement. It is a display-only flag.

---

## 3. Future Wallet Model

The future wallet is ledger-based. Every money movement is an append-only
ledger entry; balances are derived projections of the ledger, not mutable
columns.

### Core entities

**`wallet_accounts`**
One row per `(user_id, currency)`. Holds pre-computed balance projections
(`available_balance_minor`, `locked_balance_minor`) for read performance.
Never mutated directly by client code — only by the server-side
`economy_apply_ledger_entry` RPC.

**`wallet_ledger_entries`**
The canonical money record. Append-only. Each row describes one atomic
change:

- `transaction_type` — e.g. `deposit`, `withdrawal`, `escrow_lock`,
  `escrow_release`, `escrow_payout`, `escrow_refund`,
  `tournament_entry_fee`, `tournament_prize_payout`,
  `tournament_entry_refund`, `manual_adjustment`
- `direction` — `credit` or `debit`
- `amount_minor` — always positive; sign is derived from `direction`
- `balance_before_minor` / `balance_after_minor` — stamped at write time
- `idempotency_key` — unique per `(user_id, idempotency_key)`; retries
  collapse safely
- `reference_type` / `reference_id` — links back to the originating entity
  (match, tournament, deposit request, etc.)
- `created_by` / `admin_user_id` — audit trail for manual adjustments

**`deposits`**
Tracks inbound payment intent → confirmation lifecycle.
States: `pending → confirmed → failed → refunded`.

**`withdrawals` / `withdrawal_requests`**
Tracks user-initiated payout requests.
States: `pending → approved → processing → completed → failed → cancelled`.

**`wallet_holds`** / **`escrow_locks`**
Temporary reservation of available funds before a match or tournament entry
is resolved. States: `locked → released | paid_out | refunded`.

**`payment_events`**
Append-only log of every inbound webhook from a payment provider
(deposit confirmed, chargeback received, etc.). Idempotent on
`provider_event_id`. Never mutated after insert.

**`admin_audit_logs`**
Every admin wallet action (manual adjustment, wallet suspension, withdrawal
approval) must write a row here. Immutable.

---

## 4. Ledger Principles

These rules must be enforced at the database and server layer, not just in
application code:

1. **Balances are derived from ledger entries.** The `available_balance_minor`
   and `locked_balance_minor` columns on `wallet_accounts` are projections for
   read speed. A reconciliation process must periodically assert that
   `SUM(signed delta) == current balance` per account. A mismatch is a
   critical alert.

2. **Money movements are append-only.** No `UPDATE` or `DELETE` on
   `wallet_ledger_entries`. Corrections insert an opposing entry (a credit
   cancelling a previous debit). History is immutable.

3. **No direct client balance mutation.** The authenticated Supabase client
   has `SELECT` on its own rows only. No `INSERT`, `UPDATE`, or `DELETE`
   grants to clients on wallet or ledger tables.

4. **Every entry has a reason, reference, and audit metadata.** A ledger row
   with no `reference_type` and no `transaction_type` must not exist. The
   reference must point to a real entity that can be independently verified.

5. **Every payment-provider callback must be idempotent.** Webhooks can be
   delivered multiple times. The `payment_events` table enforces uniqueness
   on `provider_event_id`. Application code must handle `23505` (unique
   violation) as a success, not an error.

6. **Every payout must be traceable.** From a withdrawal request row to the
   ledger entry to the payment provider transaction id. Untraceable payouts
   are a compliance failure.

---

## 5. Match Staking — Future Flow

> **Do not implement this flow until Phase E and all compliance gates pass.**

When paid matches are enabled:

1. User selects a stake amount in the lobby. The lobby reads
   `NEXT_PUBLIC_ECONOMY_MODE` to confirm it is `"live"`.
2. Before the match room is created, the realtime server calls
   `escrow.lockMatchStake()` for both players. This writes two
   `escrow_lock` rows and two `wallet_ledger_entries`
   (`transaction_type = escrow_lock`, `direction = debit` against
   `available`).
3. If either escrow lock fails (insufficient balance), the match is not
   created and both players are notified.
4. The match proceeds. The pick/result cycle is unchanged — the server
   is the authority on outcome.
5. On `match:end`, the server calls `economy.settleMatchEconomy()`. The
   winner's escrow is released and the stake is transferred. The loser's
   escrow is consumed. A configurable commission may be applied.
6. Ledger entries are written: `escrow_payout` (winner credit),
   `escrow_payout` (loser debit). Settlement is idempotent using
   `createMatchEscrowKey(roomCode, matchInstance, "settle")`.
7. If the match is aborted (disconnect forfeit, admin abort), the server
   calls the refund path: both players' escrow is released with
   `escrow_refund` ledger entries.

---

## 6. Tournament Paid-Entry — Future Flow

> **Do not implement this flow until Phase E and all compliance gates pass.**

When paid tournaments are enabled:

1. Tournament row has `entry_fee_minor > 0` and a currency.
2. On `handleJoin`, the realtime server's `/internal/economy/tournament-entry/lock`
   endpoint is called. It writes an `escrow_lock` for the entry fee before
   the `tournament_entries` row is inserted.
3. If the lock fails (insufficient balance), registration is rejected.
4. **Cancellation:** If the tournament is cancelled (`status = cancelled`),
   every locked entry fee is refunded via `tournament_entry_refund` ledger
   entries. The refund is idempotent on
   `createTournamentEntryEscrowKey(tournamentId, "refund", userId)`.
5. **Completion:** When the tournament concludes, the server calculates
   prize splits and writes `tournament_prize_payout` ledger entries for
   winners. Non-winners' escrow locks are consumed.
6. **Abort / incomplete states:** If a tournament reaches `in_progress` but
   cannot complete (e.g. insufficient players, admin force-cancel), all entry
   fees must be refunded deterministically. The refund path must be
   idempotent and must not require manual intervention.

---

## 7. Compliance Checklist

> This is planning language. It is not legal advice. All items must be
> reviewed by a qualified legal and compliance professional before
> any real-money feature launches.

- [ ] **Legal review** — obtain legal opinion on the jurisdictions in which
  444 ARENA operates and plans to operate.
- [ ] **Skill game vs regulated gaming classification** — confirm whether
  Penalty444 (turn-based penalty kicks) is classified as a skill game or
  regulated gambling in each target jurisdiction. This determines licensing
  requirements.
- [ ] **KYC / identity verification** — determine whether and when users must
  verify identity before depositing or withdrawing. Select a KYC provider.
- [ ] **AML / sanctions screening** — determine whether Anti-Money Laundering
  and sanctions screening are required (likely yes for real-money
  transactions). Select a screening provider.
- [ ] **Payment provider terms** — review the terms of the selected payment
  provider(s) for gaming / skill-game restrictions and Zambia-specific
  requirements.
- [ ] **Withdrawal limits** — define minimum and maximum withdrawal amounts,
  cooldown periods, and daily/monthly caps.
- [ ] **Chargeback / refund policy** — document the user-facing policy and
  ensure the technical refund path can satisfy it.
- [ ] **User terms and conditions** — include wallet terms, fee schedule,
  refund policy, and withdrawal timeframes.
- [ ] **Privacy policy** — update to cover financial data collection,
  storage, and sharing with payment processors.
- [ ] **Age restriction** — determine and enforce minimum age requirement.
  Confirm whether age verification is required at registration or at first
  deposit.
- [ ] **Geographic restrictions** — confirm which countries / regions are
  permitted to use paid features. Block or warn disallowed regions.
- [ ] **Accounting / tax reporting** — determine whether the platform must
  issue tax documents to winners and/or remit taxes on prize payouts.

---

## 8. Security Requirements

These requirements apply to any phase in which wallet or economy
functionality is active:

1. **No service role key in client.** The `SUPABASE_SERVICE_ROLE_KEY` must
   never be imported, bundled, or referenced in `apps/web`. It is
   server-only. The existing `createAdminClient()` guard enforces this.

2. **Wallet operations are server-only.** All ledger writes, escrow locks,
   payouts, and refunds must go through the realtime server or a verified
   server-side Route Handler. The Supabase anon key grants read-only,
   self-scoped access to wallet data.

3. **RLS prevents user tampering.** Authenticated users may `SELECT` their
   own wallet and ledger rows. They must have no `INSERT`, `UPDATE`, or
   `DELETE` grants on any wallet, ledger, escrow, or settlement table.

4. **Payment webhooks must be verified.** Every inbound webhook from a
   payment provider must be signature-verified before processing. An
   unverified webhook must be rejected with `401`.

5. **Idempotency is required.** Every write path that can be retried must
   carry a stable idempotency key. Retries must not create duplicate ledger
   entries. The `idempotency_key` unique constraint on
   `wallet_ledger_entries` is the database-level safety net.

6. **Admin wallet actions require audit logging.** Every manual adjustment,
   withdrawal approval, and wallet status change must write an `admin_audit_log`
   row before the wallet change is applied.

7. **No destructive ledger mutations.** No migration, script, or application
   code may `UPDATE` or `DELETE` from `wallet_ledger_entries`.

8. **Secure secret management.** Payment provider API keys, webhook secrets,
   and payout credentials must be stored as server-side environment variables.
   Never `NEXT_PUBLIC_*`. Never in code.

9. **Rate limits on payment endpoints.** Deposit initiation, withdrawal
   requests, and webhook ingestion endpoints must be rate-limited to prevent
   abuse. Apply at the reverse proxy / edge layer as well as in application
   code.

---

## 9. Database / RLS Future Plan

> Migration creation is out of scope for this PR. The tables listed below
> describe the intended future schema — not what exists today. Do not create
> migrations until Phase C.

### Intended tables

**`wallet_accounts`**
```
user_id         uuid NOT NULL REFERENCES auth.users(id)
currency        text NOT NULL DEFAULT 'P4C'
available_balance_minor  bigint NOT NULL DEFAULT 0
locked_balance_minor     bigint NOT NULL DEFAULT 0
status          text NOT NULL DEFAULT 'active'  -- active | suspended | locked
created_at      timestamptz NOT NULL DEFAULT now()
updated_at      timestamptz NOT NULL DEFAULT now()
PRIMARY KEY (user_id, currency)
```
RLS: authenticated users may `SELECT` where `auth.uid() = user_id`.
No client writes.

**`wallet_ledger_entries`**
```
id                    uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id               uuid NOT NULL REFERENCES auth.users(id)
idempotency_key       text NOT NULL
transaction_type      text NOT NULL
direction             text NOT NULL  -- credit | debit
amount_minor          bigint NOT NULL CHECK (amount_minor > 0)
balance_before_minor  bigint NOT NULL
balance_after_minor   bigint NOT NULL
reference_type        text
reference_id          text
metadata              jsonb
created_at            timestamptz NOT NULL DEFAULT now()
UNIQUE (user_id, idempotency_key)
```
RLS: authenticated users may `SELECT` where `auth.uid() = user_id`.
No client writes. No `UPDATE` or `DELETE` grants to any role.

**`payment_events`**
```
id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
provider            text NOT NULL
provider_event_id   text NOT NULL
event_type          text NOT NULL
raw_payload         jsonb NOT NULL
processed_at        timestamptz
created_at          timestamptz NOT NULL DEFAULT now()
UNIQUE (provider, provider_event_id)
```
RLS: no client reads. Service-role only.

**`withdrawal_requests`**
```
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES auth.users(id)
amount_minor    bigint NOT NULL CHECK (amount_minor > 0)
currency        text NOT NULL
status          text NOT NULL DEFAULT 'pending'
provider_ref    text
admin_user_id   uuid
reviewed_at     timestamptz
created_at      timestamptz NOT NULL DEFAULT now()
```
RLS: authenticated users may `SELECT` their own rows.
Status transitions are server-only.

**`wallet_holds`** / **`escrow_locks`**
```
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
user_id         uuid NOT NULL REFERENCES auth.users(id)
idempotency_key text NOT NULL
amount_minor    bigint NOT NULL CHECK (amount_minor > 0)
currency        text NOT NULL DEFAULT 'P4C'
status          text NOT NULL DEFAULT 'locked'  -- locked | released | paid_out | refunded
reference_type  text
reference_id    text
created_at      timestamptz NOT NULL DEFAULT now()
resolved_at     timestamptz
UNIQUE (user_id, idempotency_key)
```
RLS: authenticated users may `SELECT` where `auth.uid() = user_id`.
Status transitions are server-only.

**`admin_audit_logs`**
```
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
admin_user_id uuid NOT NULL REFERENCES auth.users(id)
action        text NOT NULL
target_table  text NOT NULL
target_id     text NOT NULL
before_value  jsonb
after_value   jsonb
reason        text
created_at    timestamptz NOT NULL DEFAULT now()
```
RLS: service-role only. Admins may read via the admin API route, never directly.

---

## 10. Current UI Guardrails

The following rules define the required state of all wallet-related UI
during the Free Play beta. Any change that violates these rules must be
rejected in code review.

| Surface | Required state |
|---|---|
| `/wallet` route | Redirects to `/account` |
| `WalletPanel` header | "Arena Wallet · Coming Soon" |
| `WalletPanel` — no wallet row | Shows placeholder copy: "Wallet Coming Soon. Free Play only — no deposits or withdrawals yet." |
| `WalletPanel` deposit row | Disabled "Coming soon" badge — no clickable button |
| `WalletPanel` withdrawal row | Disabled "Coming soon" badge — no clickable button |
| `WalletPanel` available balance hint | "Deposits and withdrawals are disabled during Free Play beta." |
| `WalletPanel` locked balance hint | "No active reservations." (when escrow count is 0) |
| `WalletPill` (navbar) | "Wallet Coming Soon" — links to `/wallet` (redirects to `/account`) |
| Match room — Prize Pool | "Coming soon" label, no value |
| Lobby — Stake selector | Shows "Free" label, grayed out. Copy: "Paid stakes coming soon." |
| Tournament entry fee | Not shown — tournaments are Free Entry in beta |
| Tournament prize pool | Not shown in beta |
| Economy mode badge | "Free Play" when `NEXT_PUBLIC_ECONOMY_MODE` is unset or `"off"` |

---

## 11. Required Copy Language

### Approved wording

Use these exact phrases or close equivalents:

- **"Wallet Coming Soon"** — for the navbar pill and wallet header
- **"Deposits and withdrawals are disabled during Free Play beta."** — wallet available balance hint
- **"Free Play only — no deposits or withdrawals yet."** — wallet empty state
- **"Paid matches are not available yet."** — if stake context is shown
- **"Paid stakes coming soon."** — lobby stake row subtext
- **"Prize pools are coming later."** — if prize pool context is shown
- **"Free Entry"** — tournament entry fee in beta
- **"No cash prizes in beta"** — tournament prize copy in beta
- **"Coming soon"** — deposit/withdrawal action rows in WalletPanel

### Wording to avoid

Do not use the following unless the feature is live and backed by a real,
audited ledger:

| Avoid | Because |
|---|---|
| "Balance: K0" or any currency amount | Implies a real zero balance when no wallet exists |
| "Deposit" as a clickable CTA | Implies the action is available |
| "Withdraw" as a clickable CTA | Implies the action is available |
| "Stake" with an amount | Implies paid stakes are active |
| "Prize Pool: K500" | Fabricates a prize value |
| "Entry Fee: K50" | Implies a real fee is being charged |
| "Spendable in matches and tournaments" | Implies wallet funds can be spent now |
| "Reserved for live stakes and tournament entries" | Implies live staking is active |

---

## 12. Feature-Flag Plan

The following flags control economy activation. All must default to
`false` / `"off"` during the beta. Changing any of these to an active
value requires going through all the compliance gates in Section 7.

| Flag | Layer | Current value | Activation requires |
|---|---|---|---|
| `NEXT_PUBLIC_ECONOMY_MODE` | Client (web) | `"off"` (default) | Phase G after compliance |
| `ECONOMY_ENABLED` | Server (realtime) | `false` (default) | Phase G after compliance |
| `PAID_MATCHES_ENABLED` | Server (realtime) | Not yet implemented — architecture only | Phase G |
| `PAID_TOURNAMENTS_ENABLED` | Server (realtime) | Not yet implemented — architecture only | Phase G |
| `WITHDRAWALS_ENABLED` | Server (realtime) | Not yet implemented — architecture only | Phase G + payout provider |
| `NEXT_PUBLIC_WALLET_ENABLED` | Client (web) | Not yet implemented — architecture only | Phase D (read-only UI) |

> `NEXT_PUBLIC_ECONOMY_MODE` is a display-only flag. Setting it to `"test"`
> or `"live"` changes the economy mode badge label in the wallet panel; it
> does NOT enable any money-movement server path. `ECONOMY_ENABLED` on the
> realtime server is the actual gate.

---

## 13. Rollout Phases

### Phase A — Docs + UI guardrails (current)

- This document written.
- Misleading copy in `WalletPanel` corrected (see Section 10).
- No wallet functionality activated.
- No schema migrations.

### Phase B — Schema and RLS design review

- Draft migrations for tables in Section 9 reviewed by security team.
- RLS policies audited: confirm no client can write wallet/ledger/escrow.
- Compliance checklist in Section 7 assessed — identify blockers.
- No migrations applied to production.

### Phase C — Ledger-only sandbox

- Migrations applied to a development / preview branch only.
- Internal test: create wallet accounts and ledger entries via
  service-role scripts. Confirm RLS. Confirm reconciliation.
- `ECONOMY_ENABLED=true` only in the development branch.
- No payment provider connected. No real money.

### Phase D — Payment-provider sandbox integration

- Select a payment provider. Review their sandbox / test mode.
- Wire deposit flow end-to-end in staging: provider test card →
  webhook → `payment_events` → `wallet_ledger_entries`.
- Withdrawal flow wired in staging: request → approval queue →
  provider test payout.
- All paths tested with idempotency failures and retries.
- No real users. No production traffic.

### Phase E — Internal test with fake provider sandbox only

- Invite a small internal group to test the full wallet flow in staging.
- Match staking flow tested (Section 5).
- Tournament paid-entry flow tested (Section 6).
- All refund / abort cases exercised.
- Admin audit log verified for every action.
- Still no real money. Provider sandbox only.

### Phase F — Legal and compliance approval

- All items in Section 7 resolved.
- Legal sign-off obtained in writing.
- User terms, privacy policy, and age/geo restrictions in place.
- Security audit of the wallet stack completed.
- No production traffic until Phase G.

### Phase G — Limited real-money pilot only after approval

- `ECONOMY_ENABLED=true` set in production only after Phase F sign-off.
- `NEXT_PUBLIC_ECONOMY_MODE=live` set in production.
- Launch to a limited pilot group.
- Monitor: failed payments, failed payouts, reconciliation alerts,
  chargeback rate, support volume.
- Full rollout only after pilot metrics are healthy.

---

## 14. Acceptance Criteria Before Activating Wallet

A production wallet launch is blocked until ALL of the following are met:

- [ ] Legal / compliance sign-off obtained (Section 7 complete)
- [ ] Secure ledger: append-only enforced at DB level, reconciliation running
- [ ] Idempotent payment events: no duplicate ledger entries on webhook retry
- [ ] Audited admin actions: every wallet mutation traceable in `admin_audit_logs`
- [ ] Tested refunds: deposit refunds, escrow refunds, tournament entry refunds
- [ ] Tested match abort cases: both graceful and hard-abort paths refund correctly
- [ ] Tested tournament abort / incomplete cases: all escrow refunds complete
- [ ] Tested withdrawals: full flow including rejection, KYC failure, and retry
- [ ] Monitoring: reconciliation alerts, failed-payment alerts, payout alerts
- [ ] Admin dashboard: withdrawal queue, audit log viewer, balance correction tools
- [ ] Clear user terms covering fees, refunds, and withdrawal timelines
- [ ] No known critical or high-severity security issues in the wallet stack
- [ ] RLS audit: no client write path to wallet / ledger / escrow tables
- [ ] Payment webhook verification: signature check confirmed working in staging
- [ ] Rate limits on deposit / withdrawal / webhook endpoints confirmed

---

## 15. Open Questions

1. **Payment provider(s) for Zambia** — Which providers support ZMW or
   alternative settlement in Zambia? What are their gaming / skill-game
   policies? (e.g. mobile money operators, card processors, regional
   fintech providers)

2. **Currency support** — Will the wallet support ZMW (Zambian Kwacha) as
   the real-money currency alongside the internal `P4C` unit? If so, what
   is the conversion model?

3. **KYC provider** — Which KYC provider is preferred? What is the threshold
   that triggers mandatory KYC (e.g. first deposit, first withdrawal, balance
   exceeds a threshold)?

4. **Skill game vs regulated gaming classification** — Has a legal opinion
   been obtained for Penalty444 in Zambia specifically? The answer determines
   whether a gaming licence is required before any real-money feature can
   operate.

5. **Minimum and maximum withdrawal** — What are the intended withdrawal
   floor and ceiling? What is the cooling-off period between withdrawals?

6. **Commission model** — What percentage (if any) does the platform take on
   match stakes? On tournament prize pools? Is the commission applied at
   escrow resolution or as a separate ledger entry?

7. **Refund policy for disputes** — If a user disputes a match result, what
   is the adjudication process? Who has authority to initiate a manual refund?
   What is the SLA?

8. **Chargeback handling** — How will chargebacks from payment providers be
   handled? What is the policy for accounts with repeated chargebacks?

9. **Tax / accounting reporting** — Are winners required to be issued tax
   documents? Is the platform required to remit withholding tax on prize
   payouts in Zambia?
