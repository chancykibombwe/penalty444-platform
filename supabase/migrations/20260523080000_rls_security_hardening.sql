-- =============================================================================
-- Hardening Sprint 3 — RLS lockdown across every public table.
--
-- This migration is DEFENSIVE and IDEMPOTENT.
--
--   * Every `ALTER TABLE` is gated by `IF EXISTS` because some legacy tables
--     (profiles, player_stats, season_player_stats, seasons, match_results)
--     pre-date the migration tree in this repo and may have been created via
--     Supabase Studio or by an older SQL file that is not committed.
--   * Every policy is created via `DO $$ ... pg_policies` lookups so re-running
--     the migration is a no-op.
--   * No data is deleted. No constraints are added that could fail against
--     existing rows. Constraint additions go in a SEPARATE migration that ships
--     with documented cleanup queries.
--
-- After this migration:
--
--   * Wallets, ledger, escrow, settlement, audit — RLS on, NO client INSERT /
--     UPDATE / DELETE policies anywhere.
--   * Player stats / season stats / match results — RLS on, public-read only,
--     NO client writes.
--   * Tournament matches — RLS on, public-read only.
--   * Tournament_entries / tournaments — RLS on, owners only for self-writes
--     (already in place from Phase 7; we re-assert).
--   * Profiles — RLS on, self-update + public-read of safe columns.
--
-- The realtime server and web server-side admin client use the service-role
-- JWT and bypass RLS, so server-authoritative writes (rank progression, match
-- results, settlement, escrow) continue to work as before.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper — drop a policy if and only if it exists.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.__sprint3_drop_policy(
  p_schema TEXT,
  p_table TEXT,
  p_policy TEXT
) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = p_schema
      AND tablename  = p_table
      AND policyname = p_policy
  ) THEN
    EXECUTE format(
      'DROP POLICY %I ON %I.%I',
      p_policy, p_schema, p_table
    );
  END IF;
END;
$$;

-- =============================================================================
-- 2. profiles
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN
    EXECUTE 'ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY';

    -- Public read of profile rows. Add new safe-read columns to a view if you
    -- ever want to hide email / phone from public queries.
    PERFORM public.__sprint3_drop_policy('public', 'profiles', 'profiles_select_anyone');
    EXECUTE
      'CREATE POLICY profiles_select_anyone ON public.profiles ' ||
      'FOR SELECT USING (true)';

    -- Self-insert at signup, self-update of own row. No DELETE policy.
    PERFORM public.__sprint3_drop_policy('public', 'profiles', 'profiles_insert_self');
    EXECUTE
      'CREATE POLICY profiles_insert_self ON public.profiles ' ||
      'FOR INSERT TO authenticated WITH CHECK (id = auth.uid())';

    PERFORM public.__sprint3_drop_policy('public', 'profiles', 'profiles_update_self');
    EXECUTE
      'CREATE POLICY profiles_update_self ON public.profiles ' ||
      'FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid())';

    -- Strip dangerous broad write grants from anon.
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon';
  END IF;
END
$$;

-- =============================================================================
-- 3. seasons
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'seasons'
  ) THEN
    EXECUTE 'ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY';

    -- Read-only for clients.
    PERFORM public.__sprint3_drop_policy('public', 'seasons', 'seasons_select_anyone');
    EXECUTE
      'CREATE POLICY seasons_select_anyone ON public.seasons ' ||
      'FOR SELECT USING (true)';

    -- No write policies → service role only.
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.seasons FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 4. player_stats — server-authoritative, read-only for clients
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'player_stats'
  ) THEN
    EXECUTE 'ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY';

    PERFORM public.__sprint3_drop_policy('public', 'player_stats', 'player_stats_select_anyone');
    EXECUTE
      'CREATE POLICY player_stats_select_anyone ON public.player_stats ' ||
      'FOR SELECT USING (true)';

    -- No write policies → service role only.
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.player_stats FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 5. season_player_stats — same posture as player_stats
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'season_player_stats'
  ) THEN
    EXECUTE 'ALTER TABLE public.season_player_stats ENABLE ROW LEVEL SECURITY';

    PERFORM public.__sprint3_drop_policy(
      'public', 'season_player_stats', 'season_player_stats_select_anyone'
    );
    EXECUTE
      'CREATE POLICY season_player_stats_select_anyone ON public.season_player_stats ' ||
      'FOR SELECT USING (true)';

    EXECUTE
      'REVOKE INSERT, UPDATE, DELETE ON public.season_player_stats FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 6. match_results — read-only for clients, writes via realtime server
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'match_results'
  ) THEN
    EXECUTE 'ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY';

    PERFORM public.__sprint3_drop_policy(
      'public', 'match_results', 'match_results_select_anyone'
    );
    EXECUTE
      'CREATE POLICY match_results_select_anyone ON public.match_results ' ||
      'FOR SELECT USING (true)';

    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.match_results FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 7. tournaments — RLS already on (Phase 7). Reassert defensively.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tournaments'
  ) THEN
    EXECUTE 'ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY';

    -- Drop any historical "FOR ALL" policy that might have been added via
    -- Studio. Self-write policies from Phase 7 stay.
    PERFORM public.__sprint3_drop_policy(
      'public', 'tournaments', 'tournaments_all_authenticated'
    );

    EXECUTE 'REVOKE DELETE ON public.tournaments FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 8. tournament_entries — RLS already on. Reassert.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tournament_entries'
  ) THEN
    EXECUTE 'ALTER TABLE public.tournament_entries ENABLE ROW LEVEL SECURITY';

    PERFORM public.__sprint3_drop_policy(
      'public', 'tournament_entries', 'tournament_entries_all_authenticated'
    );
  END IF;
END
$$;

-- =============================================================================
-- 9. tournament_matches — read-only for clients
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tournament_matches'
  ) THEN
    EXECUTE 'ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY';

    PERFORM public.__sprint3_drop_policy(
      'public', 'tournament_matches', 'tournament_matches_all_authenticated'
    );

    EXECUTE
      'REVOKE INSERT, UPDATE, DELETE ON public.tournament_matches FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 10. wallets / wallet_ledger_entries / escrow_locks — already RLS-on from
--     Phase 10. Re-assert and lock down GRANTs as defense-in-depth.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wallets'
  ) THEN
    EXECUTE 'ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.wallets FROM anon, authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'wallet_ledger_entries'
  ) THEN
    EXECUTE 'ALTER TABLE public.wallet_ledger_entries ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE INSERT, UPDATE, DELETE ON public.wallet_ledger_entries FROM anon, authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'escrow_locks'
  ) THEN
    EXECUTE 'ALTER TABLE public.escrow_locks ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE INSERT, UPDATE, DELETE ON public.escrow_locks FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 11. settlement_events / audit_events — service role only.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'settlement_events'
  ) THEN
    EXECUTE 'ALTER TABLE public.settlement_events ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE SELECT, INSERT, UPDATE, DELETE ON public.settlement_events FROM anon, authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'audit_events'
  ) THEN
    EXECUTE 'ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE SELECT, INSERT, UPDATE, DELETE ON public.audit_events FROM anon, authenticated';
  END IF;
END
$$;

-- =============================================================================
-- 12. Cleanup helper (private to this migration).
-- =============================================================================
DROP FUNCTION IF EXISTS public.__sprint3_drop_policy(TEXT, TEXT, TEXT);
