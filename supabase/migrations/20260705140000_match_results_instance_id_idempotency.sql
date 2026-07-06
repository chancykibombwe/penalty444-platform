-- =============================================================================
-- Match Result Room-Code Idempotency Hardening (audit finding MATCH-1)
-- =============================================================================
-- Problem:
--   match_results idempotency was anchored on the UNIQUE constraint
--   `match_results_room_instance_unique (room_code, match_instance)`
--   (20260522093000). But `match_instance` is a per-room counter that resets
--   to 1 for every new room, while room codes are short (5-char) and reused
--   over time. When a brand-new, unrelated match is assigned a room_code that
--   a previous match already used, both write (room_code, match_instance=1),
--   the second insert hits the unique constraint (23505), and the realtime
--   server treats it as a benign duplicate — silently dropping the new
--   match's result and skipping progression / tournament advancement.
--   (The dedupe step in 20260522093000 is direct evidence this has occurred.)
--
-- Fix:
--   Anchor uniqueness/idempotency on a globally-unique per-match id instead of
--   (room_code, match_instance). The realtime server already mints exactly such
--   an id: `room.matchInstanceId` = randomUUID(), generated at room creation
--   and rotated on every rematch (see apps/realtime-server/src/room/lifecycle.ts
--   and src/socket/rematch.ts). This migration persists it as
--   `match_results.match_instance_id` and makes THAT the unique key.
--
--   • Same match, repeated endMatch  → same match_instance_id → benign 23505
--     (idempotent, no double stat / advancement).
--   • Rematch                        → new match_instance_id → new row.
--   • New match reusing a room_code  → new match_instance_id → PERSISTS
--     correctly (the MATCH-1 fix).
--
-- Deploy ordering (both directions handled — this migration is NOT sufficient
-- on its own; it is paired with a backend fallback):
--   • Migration applied BEFORE the updated server ships: the column DEFAULT
--     gen_random_uuid()::text backfills existing rows and gives any insert that
--     omits the column (old server) a unique value, so persistence keeps working.
--   • Updated server ships BEFORE this migration is applied: the server would
--     otherwise insert match_instance_id into a column that does not exist yet
--     (Postgres 42703 undefined_column). saveMatchResult handles this with a
--     TEMPORARY defensive fallback that retries once with the legacy payload
--     (log reason=match_instance_id_column_missing_retry_legacy). That fallback
--     exists only to survive the migration window.
--
--   FULL MATCH-1 protection (recycled room_code separation) is active ONLY once
--   BOTH (a) this migration is applied AND (b) the realtime backend is deployed
--   with the match_instance_id write. Until both are live, idempotency falls
--   back to the pre-existing guards (the in-memory resultSaved flag and, while
--   it still exists, the legacy (room_code, match_instance) unique constraint).
--
-- Non-destructive: no DROP TABLE / DROP COLUMN. Existing rows are preserved and
-- each keeps a unique id. match_instance is kept as-is (still written; still
-- read by the dormant economy settlement/reconciliation lookups).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1 — add the stable per-match id column. NOT NULL + volatile default
-- backfills every existing row with a distinct value and keeps future inserts
-- safe even if a caller omits the column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_results
  ADD COLUMN IF NOT EXISTS match_instance_id TEXT NOT NULL DEFAULT gen_random_uuid()::text;

COMMENT ON COLUMN public.match_results.match_instance_id IS
  'Globally-unique id for one actual match instance (realtime server '
  'room.matchInstanceId — a UUID minted at room creation and rotated on every '
  'rematch). Idempotency anchor for saveMatchResult: repeated endMatch for the '
  'same match collide here (benign 23505); a new match that reuses a room_code '
  'gets a distinct id and persists correctly. Replaces the previous '
  '(room_code, match_instance) uniqueness which dropped recycled-code matches.';

-- ---------------------------------------------------------------------------
-- Step 2 — enforce uniqueness on the new key (idempotent add).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.match_results'::regclass
      AND conname  = 'match_results_instance_id_unique'
  ) THEN
    ALTER TABLE public.match_results
      ADD CONSTRAINT match_results_instance_id_unique UNIQUE (match_instance_id);
  END IF;
END
$$;

COMMENT ON CONSTRAINT match_results_instance_id_unique
  ON public.match_results IS
  'MATCH-1 idempotency guard. realtime-server saveMatchResult tolerates 23505 '
  'unique_violation on this key and treats it as a benign duplicate.';

-- ---------------------------------------------------------------------------
-- Step 3 — retire the (room_code, match_instance) uniqueness. This is the
-- constraint that CAUSED MATCH-1: it blocks a legitimate new match whose
-- recycled room_code + match_instance=1 collides with an old row. Idempotency
-- is now carried by match_instance_id (Step 2). We keep the match_instance
-- COLUMN (still written and read by the dormant economy paths); we only drop
-- the constraint. IF EXISTS keeps this safe/idempotent.
--
-- Note: no foreign key references this constraint (tournament_matches links to
-- match_results by the plain room_code column via application joins, not an FK
-- to this unique key), so dropping it does not cascade.
-- ---------------------------------------------------------------------------
ALTER TABLE public.match_results
  DROP CONSTRAINT IF EXISTS match_results_room_instance_unique;


-- =============================================================================
-- Verification (run manually as an operator; no real user ids / secrets)
-- =============================================================================
-- a) Column exists, NOT NULL, with default:
--      SELECT column_name, is_nullable, column_default
--      FROM information_schema.columns
--      WHERE table_schema='public' AND table_name='match_results'
--        AND column_name='match_instance_id';
--
-- b) New unique constraint present, old one gone:
--      SELECT conname FROM pg_constraint
--      WHERE conrelid='public.match_results'::regclass
--        AND conname IN ('match_results_instance_id_unique',
--                        'match_results_room_instance_unique');
--      -- expect: only match_results_instance_id_unique
--
-- c) Every row has a unique id (no NULLs, no dupes):
--      SELECT count(*) AS total,
--             count(match_instance_id) AS non_null,
--             count(DISTINCT match_instance_id) AS distinct_ids
--      FROM public.match_results;
--      -- expect: total = non_null = distinct_ids
--
-- Behavioral checks (as comments):
--   -- d) Two DIFFERENT matches reusing the same room_code now both persist:
--   --   INSERT INTO public.match_results (room_code, match_instance, match_instance_id, ...)
--   --   VALUES ('ABC12', 1, 'uuid-a', ...);         -- ok
--   --   INSERT INTO public.match_results (room_code, match_instance, match_instance_id, ...)
--   --   VALUES ('ABC12', 1, 'uuid-b', ...);         -- ok (previously 23505)
--   -- e) Repeated persistence of the SAME match is still rejected:
--   --   INSERT INTO public.match_results (room_code, match_instance, match_instance_id, ...)
--   --   VALUES ('ABC12', 1, 'uuid-a', ...);         -- 23505 (benign duplicate)
-- =============================================================================
