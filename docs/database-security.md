# Database Security & RLS Audit

> Hardening Sprint 3 — current as of migration
> `20260523080000_rls_security_hardening.sql`.

## Authority model

| Layer | Identity | Bypasses RLS? | Allowed to do |
| ----- | -------- | ------------- | ------------- |
| Browser (anon) | `anon` Supabase JWT | No | Read whitelisted public data only. NEVER write economy or stat tables. |
| Browser (authenticated) | User Supabase JWT | No | Read public data + own private rows. Write only own `profiles` / `tournament_entries` / `tournaments` (creator). |
| Web server routes (`createAdminClient`) | Service role | Yes | Bracket admin, internal tournament tick. Server-only. |
| Realtime server | Service role | Yes | Match results, progression, economy. Authoritative writer for everything. |

**Service role MUST NEVER appear in browser bundles.** Audit:

```bash
rg -n 'SUPABASE_SERVICE_ROLE_KEY|service_role' apps/web/src \
  | rg -v 'lib/supabase/admin\.ts|/api/'   # admin.ts is server-only
```

The only legitimate server-side imports of `createAdminClient` live under
`apps/web/src/app/api/*/route.ts` and `apps/web/src/lib/tournament/*` modules
that are themselves only invoked from API routes.

## Table inventory

Each table is documented with: read / insert / update / delete posture. "Service
role" means the realtime server or a server-only API route. RLS column reflects
the post-Sprint-3 state.

### Public-read tables (server-authoritative writes)

| Table | RLS | Read | Insert | Update | Delete |
| ----- | --- | ---- | ------ | ------ | ------ |
| `profiles` | ✅ | public | self at signup | self only | service role only |
| `seasons` | ✅ | public | service role | service role | service role |
| `player_stats` | ✅ | public | service role | service role | service role |
| `season_player_stats` | ✅ | public | service role | service role | service role |
| `match_results` | ✅ | public | service role | service role | service role |
| `tournament_matches` | ✅ | public | service role | service role | service role |

### User-owned tables

| Table | RLS | Read | Insert | Update | Delete |
| ----- | --- | ---- | ------ | ------ | ------ |
| `tournaments` | ✅ | public | creator self | creator self | service role only |
| `tournament_entries` | ✅ | public | self only | self only | self only |

### Economy tables (Phase 10)

| Table | RLS | Read | Insert | Update | Delete |
| ----- | --- | ---- | ------ | ------ | ------ |
| `wallets` | ✅ | self only | service role | service role | service role |
| `wallet_ledger_entries` | ✅ | self only | service role (RPC) | **never** (append-only) | **never** |
| `escrow_locks` | ✅ | self only | service role | service role | service role |
| `settlement_events` | ✅ | service role only | service role | service role | service role |
| `audit_events` | ✅ | service role only | service role | service role | service role |

## Why each restriction matters

| Restriction | Failure mode prevented |
| ----------- | --------------------- |
| `wallets` write blocked | Player edits their own balance to `999999`. |
| `wallet_ledger_entries` write blocked | Player invents a deposit row. |
| `escrow_locks` write blocked | Player marks their stake refunded mid-match. |
| `match_results` write blocked | Player fakes a win to gain RP. |
| `player_stats` write blocked | Player edits their own MMR / rank. |
| `season_player_stats` write blocked | Player edits their leaderboard position. |
| `tournament_matches` write blocked | Player declares themselves the winner of a bracket slot. |
| `settlement_events` read blocked | Players cannot see others' settlement timing for inference attacks. |
| `audit_events` read blocked | Audit trail stays operator-only. |

## Verification SQL

Run these queries in Supabase SQL Editor as the `postgres` role
(service-role bypasses RLS so use a regular session for checks 2/3).

### 1. Tables in `public` and their RLS status

```sql
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity ASC, tablename;
```

Expected: every table in the inventory above has `rowsecurity = true`. Any
`false` row is a hardening regression — file an issue.

### 2. All policies on every table

```sql
SELECT schemaname, tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Use this to spot any policy with `qual = 'true'` for `cmd IN ('INSERT',
'UPDATE', 'DELETE')`. None should exist on economy / stat / match tables.

### 3. Anon-role grants (red flag if any of these return rows for sensitive tables)

```sql
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
  AND table_name IN (
    'wallets',
    'wallet_ledger_entries',
    'escrow_locks',
    'settlement_events',
    'audit_events',
    'player_stats',
    'season_player_stats',
    'match_results',
    'tournament_matches',
    'seasons'
  )
ORDER BY table_name, grantee;
```

Expected: zero rows. Any result is a leak.

### 4. Sensitive write-policies that should not exist

```sql
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'wallets',
    'wallet_ledger_entries',
    'escrow_locks',
    'settlement_events',
    'audit_events',
    'player_stats',
    'season_player_stats',
    'match_results',
    'tournament_matches'
  )
  AND cmd IN ('INSERT', 'UPDATE', 'DELETE');
```

Expected: zero rows. Any policy here means a client could write the table.

### 5. Tables in `public` without RLS (post-Sprint-3 should be empty
modulo tables we deliberately keep unrestricted, currently none)

```sql
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false;
```

### 6. Policies that expose self-only reads (sanity-check)

```sql
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('wallets', 'wallet_ledger_entries', 'escrow_locks')
  AND cmd = 'SELECT';
```

Expected: each row's `qual` contains `auth.uid() = user_id` (or equivalent).

## Constraints in place

Recorded so future migrations can be reviewed against the contract.

| Table | Constraint | Source |
| ----- | ---------- | ------ |
| `match_results` | `UNIQUE (room_code, match_instance)` | `20260522093000_match_results_idempotency.sql` |
| `wallets` | `UNIQUE (user_id, currency)` | Phase 10 foundation |
| `wallets` | `available_balance_minor >= 0`, `locked_balance_minor >= 0` | Phase 10 foundation |
| `wallet_ledger_entries` | `UNIQUE (user_id, idempotency_key)` | Phase 10 foundation |
| `wallet_ledger_entries` | `amount_minor > 0`, direction CHECK, transaction_type CHECK | Phase 10 foundation |
| `escrow_locks` | `UNIQUE (room_code, match_instance, user_id) WHERE scope='match'` | Phase 10 foundation |
| `escrow_locks` | `UNIQUE (tournament_id, user_id) WHERE scope='tournament_entry'` | Phase 10 foundation |
| `escrow_locks` | status CHECK incl. `manual_review` | Phase 12 recovery |
| `settlement_events` | `UNIQUE (room_code, match_instance, settlement_type) WHERE scope='match'` | Phase 10 foundation |
| `settlement_events` | `UNIQUE (tournament_id, settlement_type) WHERE scope='tournament'` | Phase 10 foundation |
| `settlement_events` | status CHECK incl. `requires_payout` / `manual_review`, `retry_count >= 0` | Phase 12 recovery |
| `tournament_entries` | `UNIQUE (tournament_id, user_id)` | Phase 7 |
| `tournament_matches` | `UNIQUE (tournament_id, round_number, slot_index)` | Phase 7 |
| `tournament_matches` | winner-is-participant trigger + winner-when-terminal CHECK | Phase 7 |

### Suggested future constraints (not added in Sprint 3)

These are documented but not auto-applied because they may fail against
existing data. Run the listed cleanup query first, then a separate migration.

| Constraint | Reason | Cleanup query |
| ---------- | ------ | ------------- |
| `player_stats.rank_points >= 0` (if column exists) | Negative MMR is meaningless. | `SELECT user_id, rank_points FROM public.player_stats WHERE rank_points < 0;` |
| `seasons` exactly one `is_active = true` per game | Prevents two-active-seasons drift. | `SELECT game_id, count(*) FROM public.seasons WHERE is_active GROUP BY game_id HAVING count(*) > 1;` |
| `tournaments.winner_id IS NOT NULL` when `status = 'completed'` AND `winner_id IS NOT NULL` then it must match `tournament_matches.winner_entry_id.user_id` of the final round | Single-winner consistency across joins. | Cross-join verification per tournament — see `apps/realtime-server/src/tournament/completion.ts`. |

## What this sprint deliberately did NOT change

* **Existing column schemas.** No `ALTER COLUMN`. No migrations that could
  fail against historical data.
* **Existing indexes.** None added or removed (Phase 10–12 already covered
  the hot paths).
* **Server-side write paths.** The realtime server and the web's
  `createAdminClient` continue to write through the service role. They
  already bypass RLS, so the new policies are invisible to them.
* **Frontend queries.** Every `select()` call we audited is either against a
  public-read table or against a user-owned row protected by an existing
  self-only policy. No new policy blocks a current frontend feature.
