-- =============================================================================
-- Hardening Sprint 2 — TASK 1: match_results idempotency constraint
-- =============================================================================
-- Goal:
--   Make duplicate match result inserts impossible at the database layer.
--   Pairs with the application-level guard in apps/realtime-server/src/index.ts
--   `saveMatchResult` which already tolerates Postgres unique violation
--   error code "23505" and treats it as a benign duplicate.
--
-- Strategy:
--   1. Defensively NULL-coalesce match_instance so historical rows that
--      may predate the column still satisfy the constraint.
--   2. Deduplicate any existing duplicate (room_code, match_instance)
--      rows by keeping the earliest-created row and removing the rest.
--      This is the documented manual-cleanup step from
--      docs/hardening-sprint-1-checklist.md and we run it as part of the
--      migration so deploys never wedge on legacy data.
--   3. Add a UNIQUE constraint (room_code, match_instance) only if one
--      doesn't already exist. The IF NOT EXISTS guard makes the migration
--      idempotent and safe to re-run.
--
-- Non-destructive characteristics:
--   - We never DROP TABLE or DROP COLUMN.
--   - The dedupe step only runs against rows that already violate the
--     intended invariant; healthy databases see no row deletions.
--   - The constraint addition is a no-op when already present.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1 — backfill any NULL match_instance values to 1 so the unique
-- constraint covers them. This mirrors what saveMatchResult writes for
-- legacy free-pass matches.
-- ---------------------------------------------------------------------------
UPDATE public.match_results
SET match_instance = 1
WHERE match_instance IS NULL;

-- ---------------------------------------------------------------------------
-- Step 2 — delete duplicates, keeping the earliest persisted row per
-- (room_code, match_instance) pair.
-- ---------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY room_code, match_instance
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.match_results
)
DELETE FROM public.match_results
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

-- ---------------------------------------------------------------------------
-- Step 3 — install the constraint. Idempotent (only created when missing).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.match_results'::regclass
      AND conname  = 'match_results_room_instance_unique'
  ) THEN
    ALTER TABLE public.match_results
      ADD CONSTRAINT match_results_room_instance_unique
      UNIQUE (room_code, match_instance);
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Step 4 — leave a comment on the constraint to anchor the contract to
-- the application-level idempotency code in saveMatchResult.
-- ---------------------------------------------------------------------------
COMMENT ON CONSTRAINT match_results_room_instance_unique
  ON public.match_results IS
  'Hardening Sprint 2: idempotency guard. realtime-server saveMatchResult '
  'tolerates 23505 unique_violation and treats it as a benign duplicate.';
