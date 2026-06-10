-- =============================================================================
-- Phase 8B beta lock — tournament creator RLS column lockdown
-- =============================================================================
-- Background:
--   `tournaments_update_creator` (Phase 7, 20260515120000) lets a creator
--   UPDATE their own tournament row with no column restrictions:
--
--     CREATE POLICY tournaments_update_creator
--       ON public.tournaments
--       FOR UPDATE
--       TO authenticated
--       USING (created_by = auth.uid())
--       WITH CHECK (created_by = auth.uid());
--
--   Today no client code calls `.from("tournaments").update(...)` — every
--   write to `public.tournaments` (manual start, advancement, cleanup,
--   no-show handling) goes through service-role API routes
--   (apps/web/src/lib/tournament/startTournament.ts, advancement.ts,
--   processTournamentCleanup.ts via createAdminClient()). But the RLS
--   policy as written would allow a creator to directly flip `status`,
--   set `winner_id`, change `created_by`, or rewrite the prize-pool /
--   entry-fee columns added in 20260522104000_economy_foundation_v1.sql,
--   if any future client-side update is ever added (intentionally or by
--   mistake).
--
-- Beta policy:
--   Tournament lifecycle, ownership, and financial fields are
--   server-authoritative. Creators may continue to edit safe metadata
--   (name, max_players, rounds_per_match, format, game_id, scheduling
--   timestamps) via `tournaments_update_creator`, but a BEFORE UPDATE
--   trigger rejects any change to the protected columns below unless the
--   write is performed by `service_role` (which bypasses this check, so
--   existing API routes — manual start, advancement, cleanup — continue
--   to work unchanged).
--
-- Protected columns:
--   status, winner_id, created_by, season_id, entry_fee_minor, currency,
--   rake_bps, payout_structure, prize_pool_minor
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tournaments_protect_lifecycle_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- service_role (server API routes, scheduled tick) is fully trusted and
  -- is the only writer allowed to change lifecycle/financial fields.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW.winner_id IS DISTINCT FROM OLD.winner_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.season_id IS DISTINCT FROM OLD.season_id
    OR NEW.entry_fee_minor IS DISTINCT FROM OLD.entry_fee_minor
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.rake_bps IS DISTINCT FROM OLD.rake_bps
    OR NEW.payout_structure IS DISTINCT FROM OLD.payout_structure
    OR NEW.prize_pool_minor IS DISTINCT FROM OLD.prize_pool_minor
  THEN
    RAISE EXCEPTION
      'tournaments: status, winner_id, created_by, season_id, and prize/entry-fee fields are server-authoritative and cannot be changed directly'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tournaments_protect_lifecycle_fields() IS
  'Phase 8B beta lock: blocks non-service-role UPDATEs to public.tournaments '
  'lifecycle/ownership/financial columns (status, winner_id, created_by, '
  'season_id, entry_fee_minor, currency, rake_bps, payout_structure, '
  'prize_pool_minor). service_role (server API routes) is exempt.';

DROP TRIGGER IF EXISTS tournaments_protect_lifecycle_fields_trigger
  ON public.tournaments;

CREATE TRIGGER tournaments_protect_lifecycle_fields_trigger
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.tournaments_protect_lifecycle_fields();
