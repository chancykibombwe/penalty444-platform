-- =============================================================================
-- Tournament / Feedback RLS Write-Guard Hardening
-- =============================================================================
-- Source: full-platform audit (docs/full-platform-audit.md) — findings DB-4,
-- ECON-3, and FEED (beta_feedback insert status). Defense-in-depth only:
-- no schema redesign, no new tables, no economy activation.
--
-- The existing RLS policies already scope writes to the owner
-- (user_id = auth.uid() / created_by = auth.uid()), and
-- `tournaments_protect_lifecycle_fields_trigger`
-- (20260610130000_tournament_creator_update_lockdown.sql) already blocks
-- non-service-role UPDATEs to tournament lifecycle/economy columns. This
-- migration closes the remaining WRITE gaps that policy `WITH CHECK` clauses
-- cannot express (they cannot compare columns or restrict enum values):
--
--   1. tournament_entries — a player could UPDATE their own row to a
--      server-owned status (winner / eliminated) or change seed /
--      tournament_id / user_id. INSERT + UPDATE guard added.
--   2. tournaments — the UPDATE lockdown does not cover INSERT, so a crafted
--      insert could forge a completed/won tournament or a non-zero entry fee /
--      prize pool. INSERT guard added.
--   3. beta_feedback — the INSERT policy checks only user_id, so a client
--      could submit feedback already marked triaged/resolved/wont_fix. INSERT
--      guard added to force the initial 'open' status.
--
-- Trust model (matches 20260610130000): the `service_role` bypasses every
-- guard below, so all server-authoritative paths continue unchanged:
--   • realtime server bracket progression (winner/eliminated/seed writes)
--   • /api/tournaments/* and /api/internal/* route handlers
--   • lib/tournament/* server modules (startTournament, advancement, cancel)
--   • admin beta-feedback status route
--
-- Verified against the current browser-client write paths (all remain allowed):
--   • CreateTournamentPanel      → tournaments INSERT status='registration'
--   • TournamentEntryActions      → tournament_entries INSERT status='registered'
--                                    (no seed) and UPDATE to
--                                    checked_in / registered / withdrawn
--   • lib/feedback/betaFeedback   → beta_feedback INSERT (status omitted →
--                                    default 'open')
--
-- No money moves. No frontend / realtime / admin / Home / Unity changes.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. tournament_entries — block player self-promotion / server-owned columns
-- ---------------------------------------------------------------------------
-- Self-service statuses a player may set on their OWN entry:
--   registered, checked_in, withdrawn
-- Server-owned outcome statuses (winner, eliminated) are set only via the
-- service role during bracket progression. seed, tournament_id and user_id
-- are immutable from the client.
CREATE OR REPLACE FUNCTION public.tournament_entries_protect_server_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- service_role (server API routes, realtime bracket progression) is fully
  -- trusted and bypasses every check below.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Narrow allow-list of statuses a player may set themselves. This rejects
  -- 'winner' and 'eliminated' on both INSERT and UPDATE.
  IF NEW.status NOT IN ('registered', 'checked_in', 'withdrawn') THEN
    RAISE EXCEPTION
      'tournament_entries: status "%" is server-authoritative; players may only set registered, checked_in, or withdrawn',
      NEW.status
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Seed is assigned by the bracket generator (service role) when the
    -- bracket is drawn. A player may not pre-seed themselves.
    IF NEW.seed IS NOT NULL THEN
      RAISE EXCEPTION
        'tournament_entries: seed is server-authoritative and cannot be set on insert'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Immutable / server-owned columns on a self-service update.
    IF NEW.seed IS DISTINCT FROM OLD.seed
      OR NEW.tournament_id IS DISTINCT FROM OLD.tournament_id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
    THEN
      RAISE EXCEPTION
        'tournament_entries: seed, tournament_id, and user_id are server-authoritative and cannot be changed directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tournament_entries_protect_server_fields() IS
  'Write-guard hardening: blocks non-service-role INSERT/UPDATE of '
  'tournament_entries to server-owned statuses (winner, eliminated) and '
  'immutable columns (seed, tournament_id, user_id). Players keep '
  'registered/checked_in/withdrawn self-service. service_role is exempt.';

DROP TRIGGER IF EXISTS tournament_entries_protect_server_fields_trigger
  ON public.tournament_entries;

CREATE TRIGGER tournament_entries_protect_server_fields_trigger
  BEFORE INSERT OR UPDATE ON public.tournament_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.tournament_entries_protect_server_fields();


-- ---------------------------------------------------------------------------
-- 2. tournaments — block forged completed/won/paid tournaments on INSERT
-- ---------------------------------------------------------------------------
-- The existing UPDATE lockdown (20260610130000) does not cover INSERT. A
-- creator may only open a tournament in a safe initial lifecycle state; the
-- advanced/terminal states and the champion/economy fields are set only by
-- the server path.
CREATE OR REPLACE FUNCTION public.tournaments_protect_insert_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_has_economy_cols boolean;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Safe initial lifecycle states for a creator-made tournament. The client
  -- creates with 'registration'; 'draft' is also allowed. check_in /
  -- in_progress / completed / cancelled are reached only via the server
  -- lifecycle path — a client cannot forge a running or finished tournament.
  IF NEW.status NOT IN ('draft', 'registration') THEN
    RAISE EXCEPTION
      'tournaments: a new tournament may only be created with status draft or registration (got "%")',
      NEW.status
      USING ERRCODE = '42501';
  END IF;

  -- No forged champion on creation. (The tournaments_winner_only_when_completed
  -- CHECK already ties winner_id to completed status; this is defense in depth
  -- against a future relaxation of that CHECK.)
  IF NEW.winner_id IS NOT NULL THEN
    RAISE EXCEPTION
      'tournaments: winner_id is server-authoritative and must be null on insert'
      USING ERRCODE = '42501';
  END IF;

  -- Economy columns exist once economy_foundation_v1 is applied. On a client
  -- insert they must stay at the free-play defaults (all zero). Paid
  -- tournaments require a future, explicitly-enabled and audited economy phase.
  -- Guarded by a pg_attribute existence check so this migration is safe to
  -- apply before or after economy_foundation_v1 (mirrors 20260610130000).
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.tournaments'::regclass
      AND attname = 'entry_fee_minor'
      AND NOT attisdropped
  ) INTO v_has_economy_cols;

  IF v_has_economy_cols THEN
    IF NEW.entry_fee_minor IS DISTINCT FROM 0
      OR NEW.prize_pool_minor IS DISTINCT FROM 0
      OR NEW.rake_bps IS DISTINCT FROM 0
    THEN
      RAISE EXCEPTION
        'tournaments: entry_fee_minor, prize_pool_minor, and rake_bps must be zero on a client insert (Free Play beta)'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tournaments_protect_insert_fields() IS
  'Write-guard hardening: blocks non-service-role INSERT of tournaments in an '
  'advanced/terminal status, with a winner_id, or with non-zero economy '
  'fields. Creators may only open draft/registration free-play tournaments. '
  'service_role is exempt. Complements the existing UPDATE lockdown trigger.';

DROP TRIGGER IF EXISTS tournaments_protect_insert_fields_trigger
  ON public.tournaments;

CREATE TRIGGER tournaments_protect_insert_fields_trigger
  BEFORE INSERT ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.tournaments_protect_insert_fields();


-- ---------------------------------------------------------------------------
-- 3. beta_feedback — force initial 'open' status on client insert
-- ---------------------------------------------------------------------------
-- The INSERT policy only checks user_id = auth.uid(); it cannot restrict the
-- status column. Testers must not be able to submit feedback that is already
-- triaged/resolved/wont_fix. The client omits status (DB default 'open'),
-- which is applied to NEW before this BEFORE INSERT trigger runs, so the guard
-- is transparent to the real client.
CREATE OR REPLACE FUNCTION public.beta_feedback_force_open_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION
      'beta_feedback: new feedback must start with status open (got "%"); the triage lifecycle is admin/service-role only',
      NEW.status
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.beta_feedback_force_open_status() IS
  'Write-guard hardening: a non-service-role INSERT into beta_feedback must '
  'carry status open. Admins move feedback through triaged/resolved/wont_fix '
  'via the service role. service_role is exempt.';

DROP TRIGGER IF EXISTS beta_feedback_force_open_status_trigger
  ON public.beta_feedback;

CREATE TRIGGER beta_feedback_force_open_status_trigger
  BEFORE INSERT ON public.beta_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.beta_feedback_force_open_status();


-- =============================================================================
-- Verification (run manually as an operator; no real user ids / secrets)
-- =============================================================================
-- 1) Confirm the three trigger functions exist:
--      SELECT proname FROM pg_proc
--      WHERE proname IN (
--        'tournament_entries_protect_server_fields',
--        'tournaments_protect_insert_fields',
--        'beta_feedback_force_open_status'
--      );
--
-- 2) Confirm the triggers are attached:
--      SELECT tgname, tgrelid::regclass AS table_name
--      FROM pg_trigger
--      WHERE tgname IN (
--        'tournament_entries_protect_server_fields_trigger',
--        'tournaments_protect_insert_fields_trigger',
--        'beta_feedback_force_open_status_trigger'
--      );
--
-- 3) Confirm existing policies are unchanged (still present):
--      SELECT policyname, cmd FROM pg_policies
--      WHERE tablename IN ('tournaments','tournament_entries','beta_feedback')
--      ORDER BY tablename, policyname;
--
-- Negative tests (as an AUTHENTICATED, non-service-role session — each should
-- fail with SQLSTATE 42501; shown as comments only, substitute real ids):
--   -- a) self-promote to winner (rejected):
--   --   UPDATE public.tournament_entries SET status='winner'
--   --   WHERE user_id = auth.uid();
--   -- b) change own seed (rejected):
--   --   UPDATE public.tournament_entries SET seed=1 WHERE user_id = auth.uid();
--   -- c) forge a completed tournament (rejected):
--   --   INSERT INTO public.tournaments (name, status, max_players, created_by)
--   --   VALUES ('x','completed',4, auth.uid());
--   -- d) forge feedback already resolved (rejected):
--   --   INSERT INTO public.beta_feedback (user_id, category, message, status)
--   --   VALUES (auth.uid(), 'other', 'x', 'resolved');
--
-- Positive tests (as AUTHENTICATED — each should SUCCEED):
--   -- e) register:
--   --   INSERT INTO public.tournament_entries (tournament_id, user_id, username, status)
--   --   VALUES ('<open-tournament-id>', auth.uid(), 'me', 'registered');
--   -- f) check in / withdraw:
--   --   UPDATE public.tournament_entries SET status='checked_in',
--   --     checked_in_at=now() WHERE user_id = auth.uid();
--   -- g) create a free-play tournament:
--   --   INSERT INTO public.tournaments (name, status, max_players, created_by)
--   --   VALUES ('friendly cup','registration',4, auth.uid());
--   -- h) submit feedback (status omitted → 'open'):
--   --   INSERT INTO public.beta_feedback (user_id, category, message)
--   --   VALUES (auth.uid(), 'other', 'looks great');
-- =============================================================================
