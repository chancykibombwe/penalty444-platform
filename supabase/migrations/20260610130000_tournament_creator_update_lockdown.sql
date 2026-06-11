-- =============================================================================
-- Phase 8B beta lock -- tournament creator RLS column lockdown
-- =============================================================================
-- Background:
-- `tournaments_update_creator` (Phase 7, 20260515120000) lets a creator
-- UPDATE their own tournament row with no column restrictions.
--
-- Beta policy:
--   Tournament lifecycle and ownership fields are server-authoritative.
--   Creators may continue to edit safe metadata (name, max_players,
--   rounds_per_match, format, game_id, scheduling timestamps) via
--   `tournaments_update_creator`, but a BEFORE UPDATE trigger rejects any
--   change to the protected columns below unless the write is performed by
--   `service_role` (which bypasses this check, so existing API routes --
--   manual start, advancement, cleanup -- continue to work unchanged).
--
-- Protected columns (always):
--   status, winner_id, created_by, season_id
--
-- Protected columns (when present -- added by economy_foundation_v1):
--   entry_fee_minor, currency, rake_bps, payout_structure, prize_pool_minor
--
-- NOTE: Economy columns are guarded with a pg_attribute existence check so
-- this migration is safe to apply before or after the economy migration.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tournaments_protect_lifecycle_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_economy_cols boolean;
BEGIN
  -- service_role (server API routes, scheduled tick) is fully trusted and
  -- is the only writer allowed to change lifecycle/financial fields.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Check if economy columns exist on this table (added by economy_foundation_v1)
  SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = 'public.tournaments'::regclass
          AND attname = 'entry_fee_minor'
          AND NOT attisdropped
      ) INTO v_has_economy_cols;

  -- Always-protected lifecycle/ownership columns
  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW.winner_id IS DISTINCT FROM OLD.winner_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.season_id IS DISTINCT FROM OLD.season_id
  THEN
    RAISE EXCEPTION
      'tournaments: status, winner_id, created_by, and season_id are server-authoritative and cannot be changed directly'
      USING ERRCODE = '42501';
  END IF;

  -- Economy columns (only checked when they exist on the table)
  IF v_has_economy_cols THEN
    IF NEW.entry_fee_minor IS DISTINCT FROM OLD.entry_fee_minor
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.rake_bps IS DISTINCT FROM OLD.rake_bps
      OR NEW.payout_structure IS DISTINCT FROM OLD.payout_structure
      OR NEW.prize_pool_minor IS DISTINCT FROM OLD.prize_pool_minor
    THEN
      RAISE EXCEPTION
        'tournaments: prize/entry-fee fields are server-authoritative and cannot be changed directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tournaments_protect_lifecycle_fields() IS
  'Phase 8B beta lock: blocks non-service-role UPDATEs to public.tournaments '
  'lifecycle/ownership columns (status, winner_id, created_by, season_id) and, '
  'when present, economy columns (entry_fee_minor, currency, rake_bps, '
  'payout_structure, prize_pool_minor). service_role is exempt. '
  'Economy columns are checked dynamically so this trigger is safe before and '
  'after the economy_foundation migration.';

DROP TRIGGER IF EXISTS tournaments_protect_lifecycle_fields_trigger
  ON public.tournaments;

CREATE TRIGGER tournaments_protect_lifecycle_fields_trigger
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.tournaments_protect_lifecycle_fields();
