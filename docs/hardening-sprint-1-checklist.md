# Hardening Sprint 1 — Integrity & Pre-Economy Checklist

This document captures the DB-level invariants, RLS audits, and future
economy prerequisites that complement the **Sprint 1 — Platform
Integrity Stabilization** code changes.

The application-level guards already in code (idempotency flags,
identity checks, room cleanup, persist-before-notify ordering) are
sufficient for current free-money / free-stake play. The items below
are the database hardening required **before** real-money economy
work begins.

---

## 1. `match_results` unique-match constraint

Goal: make duplicate result inserts impossible at the DB layer, so even
if a buggy code path re-enters the save flow, Postgres refuses the
duplicate and the server's "23505 → benign duplicate" path takes over.

### Required constraint

```sql
ALTER TABLE public.match_results
  ADD CONSTRAINT match_results_room_instance_unique
  UNIQUE (room_code, match_instance);
```

Already-saved historical rows MUST satisfy uniqueness. If duplicates
exist, run a one-time `DISTINCT ON` cleanup before adding the
constraint:

```sql
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY room_code, match_instance
      ORDER BY created_at ASC
    ) AS rn
  FROM public.match_results
)
DELETE FROM public.match_results
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
```

### Verification

- Inserting two rows with the same `(room_code, match_instance)` should
  raise `unique_violation` (Postgres code `23505`).
- Server log on duplicate should read:
  `[Settlement] duplicate result skipped (db unique) ...`

---

## 2. `player_stats` write protection

Player progression is written exclusively by the realtime server with
the service-role key. Frontend users should never be able to alter their
own MMR / wins / losses via direct PostgREST writes.

### RLS audit checklist

- [ ] `player_stats` row-level security ENABLED.
- [ ] `SELECT` policy: allow anyone (`true`) — leaderboard, profile
      pages, featured players all need this.
- [ ] `INSERT` policy: **deny** for `auth.role() = 'authenticated'`;
      only the service role inserts.
- [ ] `UPDATE` policy: **deny** for authenticated users. (The realtime
      server bypasses RLS by virtue of the service role.)
- [ ] `DELETE` policy: deny for all non-service roles.

### Suggested policy snippet

```sql
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player_stats_select_public" ON public.player_stats;
CREATE POLICY "player_stats_select_public" ON public.player_stats
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "player_stats_writes_service_only" ON public.player_stats;
CREATE POLICY "player_stats_writes_service_only" ON public.player_stats
  FOR ALL USING (false) WITH CHECK (false);
```

(The `FOR ALL ... USING (false)` clause has no effect on the service
role, which bypasses RLS, but locks every other role out of writes.)

---

## 3. `tournament_matches` advancement guard

The realtime server already uses optimistic updates
(`.is("winner_entry_id", null)`) when advancing the bracket. The DB
should defend in depth.

### Required guardrails

- [ ] No DELETE policies for `tournament_matches` on authenticated
      users.
- [ ] UPDATE policy restricted to service role (no client-side bracket
      edits).
- [ ] Optional but recommended: a partial unique index that prevents
      writing two different winners onto the same slot.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS tournament_matches_winner_once_idx
  ON public.tournament_matches (id)
  WHERE winner_entry_id IS NOT NULL;
```

(This is a no-op uniqueness since `id` is already PK, but flagged here
as a hook in case the team chooses to add a history table later.)

### Verification

- Re-running a complete match in the realtime server logs:
  `[TournamentAdvance] duplicate skipped (slot already won by same entry) ...`
- Two different writers writing different winners should result in:
  `[TournamentAdvance] winner conflict ...`

---

## 4. Future wallet ledger requirements

When `wallet/stakes.ts` graduates from RPC-based settlement to a real
ledger, the following invariants MUST be in place before any economy
launch:

- [ ] `wallet_ledger` table with append-only `INSERT` (no UPDATE / DELETE
      from non-service roles).
- [ ] Every ledger row carries an idempotency key —
      `(room_code, match_instance, kind)` — and a `UNIQUE` constraint
      enforces that the same settlement event can be replayed safely.
- [ ] Balance must be derived as the SUM of ledger rows, never stored
      as a separate column that can drift.
- [ ] `settle_wallet_stakes` RPC must:
      - take an idempotency key
      - return early when the key is already recorded
      - run inside a single transaction with `SELECT FOR UPDATE` on
        both wallet rows.
- [ ] All credit / debit operations gated by service role.
- [ ] Audit log of every successful and failed settlement.

---

## 5. Future idempotency keys

Every state-changing background action that can fire more than once
SHOULD accept an idempotency key. Sprint 1 introduced
`room.matchInstanceId`; consider extending it as follows:

- [ ] **Match result insert** — keyed by `(room_code, match_instance)`.
      DB unique constraint provides last-line defense.
- [ ] **Stake settlement** — keyed by `match_instance_id` (when wallet
      goes live). Each ledger row carries this key.
- [ ] **Tournament advancement** — keyed by `tournament_match_id`;
      database `winner_entry_id` doubles as the idempotency marker.
- [ ] **`tournament:matchReady` notify** — keyed by `room_code`;
      duplicate notifications are tolerated by clients, but the server
      logs prove the cause.
- [ ] **Match progression (RP)** — keyed by `match_instance_id` via
      `room.progressionApplied`.

---

## 6. Future escrow requirement

Before real money is ever transferred, the following sequencing must
hold:

1. **Lock** stake on the BOTH wallets at match acceptance time.
   Locked funds are not available for any other action.
2. Persist a `wallet_ledger` row with `kind = 'stake_lock'` and the
   `match_instance_id` idempotency key.
3. On match completion **AND** `saveMatchResult` returning `true`,
   transition both locked stakes to either:
   - `kind = 'stake_payout'` → winner receives 2× stake
   - `kind = 'stake_refund'` → draw / abort / no-show
4. Settlement runs only after result-save success
   (already enforced in `endMatch` — Sprint 1 TASK 9).
5. If any DB step fails, the lock remains in place. A retry / manual
   reconciliation job picks it up via the idempotency key.

This document is the canonical pre-economy gate. **Do not enable a
real-money stake mode until all checkboxes above are green.**

---

## Sprint 1 changes that this document complements

- `apps/realtime-server/src/index.ts` — endMatch ordering, advance
  idempotency, persist-then-notify endpoints, sweeper bootstrap.
- `apps/realtime-server/src/security/identity.ts` — socket identity
  enforcement.
- `apps/realtime-server/src/socket/spectator.ts` — spectator/player
  separation.
- `apps/realtime-server/src/room/cleanup.ts` — scheduled cleanup +
  stale TTL sweeper.
- `apps/realtime-server/src/player/progression.ts` — RP idempotency.
- `apps/realtime-server/src/types/room.ts` — `matchInstanceId`,
  `settlementStarted`, `progressionApplied`, `lastActivityAt`,
  `createdAt`, `spectatorSocketIds`.
- `apps/web/src/lib/tournament/realtimeRooms.ts` — persist-then-notify
  caller.
