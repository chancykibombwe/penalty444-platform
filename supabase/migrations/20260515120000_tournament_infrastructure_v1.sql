-- =============================================================================
-- Tournament Infrastructure v1 (Penalty444)
-- =============================================================================
-- Scope: single-elimination, free matches, persistence only.
-- Out of scope: prize pools, payouts, admin dashboards, advanced seeding,
-- spectators, tournament_matches client writes (service role / realtime server).
--
-- Match policy (enforced in application layer; documented here):
--   • No rematch: one bracket slot maps to one room_code; match_instance = 1
--     in match_results. Rematch would violate the single-winner invariant.
--   • No early cancel: match:abortEarly must be rejected for tournament rooms.
--     Slots advance only via endMatch (forfeit / disconnect forfeit / gameplay).
--   • Single winner invariant: each tournament_matches row has at most one
--     winner_entry_id when status = completed | walkover.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums (text + CHECK on tables keeps migration simple; enums optional)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- tournaments
-- ---------------------------------------------------------------------------
CREATE TABLE public.tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL DEFAULT 'penalty444',
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  format TEXT NOT NULL DEFAULT 'single_elimination',
  max_players INTEGER NOT NULL,
  rounds_per_match INTEGER NOT NULL DEFAULT 3,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ,
  check_in_opens_at TIMESTAMPTZ,
  check_in_closes_at TIMESTAMPTZ,
  season_id UUID REFERENCES public.seasons (id) ON DELETE SET NULL,
  winner_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tournaments_game_id_not_empty CHECK (char_length(trim(game_id)) > 0),
  CONSTRAINT tournaments_name_not_empty CHECK (char_length(trim(name)) > 0),
  CONSTRAINT tournaments_status_valid CHECK (
    status IN (
      'draft',
      'registration',
      'check_in',
      'in_progress',
      'completed',
      'cancelled'
    )
  ),
  CONSTRAINT tournaments_format_valid CHECK (format IN ('single_elimination')),
  CONSTRAINT tournaments_max_players_power_of_two CHECK (
    max_players >= 2
    AND max_players <= 128
    AND (max_players & (max_players - 1)) = 0
  ),
  CONSTRAINT tournaments_rounds_per_match_positive CHECK (rounds_per_match >= 1),
  CONSTRAINT tournaments_check_in_window_order CHECK (
    check_in_opens_at IS NULL
    OR check_in_closes_at IS NULL
    OR check_in_closes_at >= check_in_opens_at
  ),
  CONSTRAINT tournaments_starts_after_check_in_close CHECK (
    starts_at IS NULL
    OR check_in_closes_at IS NULL
    OR starts_at >= check_in_closes_at
  ),
  CONSTRAINT tournaments_winner_only_when_completed CHECK (
    winner_id IS NULL
    OR status = 'completed'
  )
);

COMMENT ON TABLE public.tournaments IS
  'Tournament container. Bracket structure lives in tournament_matches; '
  'participants in tournament_entries. v1: single_elimination only.';

COMMENT ON COLUMN public.tournaments.status IS
  'Lifecycle: draft → registration → check_in → in_progress → completed '
  '(or cancelled). Transitions are application-controlled.';

COMMENT ON COLUMN public.tournaments.winner_id IS
  'Auth user id of the tournament champion. Set only when status = completed. '
  'Must align with the final tournament_matches.winner_entry_id.user_id.';

COMMENT ON COLUMN public.tournaments.season_id IS
  'Optional pin for match_results.season_id on tournament matches. '
  'Falls back to active season in realtime server when null.';

-- ---------------------------------------------------------------------------
-- tournament_entries
-- ---------------------------------------------------------------------------
CREATE TABLE public.tournament_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  seed INTEGER,
  status TEXT NOT NULL DEFAULT 'registered',
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tournament_entries_username_not_empty CHECK (
    char_length(trim(username)) > 0
  ),
  CONSTRAINT tournament_entries_status_valid CHECK (
    status IN (
      'registered',
      'checked_in',
      'eliminated',
      'winner',
      'withdrawn'
    )
  ),
  CONSTRAINT tournament_entries_seed_positive CHECK (seed IS NULL OR seed >= 1),
  CONSTRAINT tournament_entries_checked_in_consistency CHECK (
    (status = 'checked_in' AND checked_in_at IS NOT NULL)
    OR (status <> 'checked_in')
  ),
  CONSTRAINT tournament_entries_unique_player UNIQUE (tournament_id, user_id)
);

COMMENT ON TABLE public.tournament_entries IS
  'One row per player per tournament. username is a snapshot at registration time.';

COMMENT ON COLUMN public.tournament_entries.seed IS
  'Bracket seed assigned when the bracket is generated (nullable until then).';

COMMENT ON CONSTRAINT tournament_entries_unique_player ON public.tournament_entries IS
  'A player may register at most once per tournament.';

-- ---------------------------------------------------------------------------
-- tournament_matches (bracket slots)
-- ---------------------------------------------------------------------------
CREATE TABLE public.tournament_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments (id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  entry_one_id UUID REFERENCES public.tournament_entries (id) ON DELETE SET NULL,
  entry_two_id UUID REFERENCES public.tournament_entries (id) ON DELETE SET NULL,
  room_code TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  winner_entry_id UUID REFERENCES public.tournament_entries (id) ON DELETE SET NULL,
  next_match_id UUID REFERENCES public.tournament_matches (id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tournament_matches_round_positive CHECK (round_number >= 1),
  CONSTRAINT tournament_matches_slot_non_negative CHECK (slot_index >= 0),
  CONSTRAINT tournament_matches_status_valid CHECK (
    status IN (
      'pending',
      'ready',
      'in_progress',
      'completed',
      'walkover',
      'cancelled'
    )
  ),
  CONSTRAINT tournament_matches_unique_slot UNIQUE (
    tournament_id,
    round_number,
    slot_index
  ),
  CONSTRAINT tournament_matches_winner_is_participant CHECK (
    winner_entry_id IS NULL
    OR winner_entry_id = entry_one_id
    OR winner_entry_id = entry_two_id
  ),
  CONSTRAINT tournament_matches_winner_when_terminal CHECK (
    (
      status IN ('completed', 'walkover')
      AND winner_entry_id IS NOT NULL
    )
    OR (
      status IN ('pending', 'ready', 'in_progress')
      AND winner_entry_id IS NULL
    )
    OR (status = 'cancelled')
  ),
  CONSTRAINT tournament_matches_completed_timestamps CHECK (
    (
      status IN ('completed', 'walkover')
      AND completed_at IS NOT NULL
    )
    OR (status NOT IN ('completed', 'walkover'))
  ),
  CONSTRAINT tournament_matches_in_progress_started CHECK (
    (status = 'in_progress' AND started_at IS NOT NULL AND room_code IS NOT NULL)
    OR (status <> 'in_progress')
  ),
  CONSTRAINT tournament_matches_no_self_next CHECK (
    next_match_id IS NULL OR next_match_id <> id
  )
);

COMMENT ON TABLE public.tournament_matches IS
  'Bracket slot (single-elimination). One slot → at most one realtime room_code. '
  'Application must not allow rematch in the same slot (see match policy above).';

COMMENT ON COLUMN public.tournament_matches.room_code IS
  'Realtime room code when the match is started. Join to match_results via '
  '(room_code, match_instance) with match_instance = 1 for tournament games.';

COMMENT ON COLUMN public.tournament_matches.next_match_id IS
  'Bracket edge: winner of this slot advances into the referenced match slot.';

COMMENT ON COLUMN public.tournament_matches.winner_entry_id IS
  'Single winner invariant: at most one winner per slot when terminal. '
  'Must be entry_one_id or entry_two_id (or the sole entry on walkover).';

COMMENT ON CONSTRAINT tournament_matches_winner_is_participant ON public.tournament_matches IS
  'Single winner invariant: winner must be one of the slot participants.';

-- entry_* must belong to the same tournament_id (no subquery in CHECK — use trigger).
CREATE OR REPLACE FUNCTION public.tournament_matches_validate_entries()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entry_one_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.tournament_entries e
      WHERE e.id = NEW.entry_one_id
        AND e.tournament_id = NEW.tournament_id
    ) THEN
      RAISE EXCEPTION 'entry_one_id does not belong to this tournament';
    END IF;
  END IF;

  IF NEW.entry_two_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.tournament_entries e
      WHERE e.id = NEW.entry_two_id
        AND e.tournament_id = NEW.tournament_id
    ) THEN
      RAISE EXCEPTION 'entry_two_id does not belong to this tournament';
    END IF;
  END IF;

  IF NEW.winner_entry_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.tournament_entries e
      WHERE e.id = NEW.winner_entry_id
        AND e.tournament_id = NEW.tournament_id
    ) THEN
      RAISE EXCEPTION 'winner_entry_id does not belong to this tournament';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tournament_matches_validate_entries
  BEFORE INSERT OR UPDATE ON public.tournament_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.tournament_matches_validate_entries();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX idx_tournaments_game_id ON public.tournaments (game_id);

CREATE INDEX idx_tournaments_status ON public.tournaments (status);

CREATE INDEX idx_tournaments_created_by ON public.tournaments (created_by);

CREATE INDEX idx_tournaments_season_id ON public.tournaments (season_id)
  WHERE season_id IS NOT NULL;

CREATE INDEX idx_tournament_entries_tournament_id
  ON public.tournament_entries (tournament_id);

CREATE INDEX idx_tournament_entries_user_id
  ON public.tournament_entries (user_id);

CREATE INDEX idx_tournament_entries_tournament_status
  ON public.tournament_entries (tournament_id, status);

CREATE INDEX idx_tournament_matches_tournament_id
  ON public.tournament_matches (tournament_id);

CREATE INDEX idx_tournament_matches_tournament_status
  ON public.tournament_matches (tournament_id, status);

CREATE INDEX idx_tournament_matches_status
  ON public.tournament_matches (status);

CREATE INDEX idx_tournament_matches_room_code
  ON public.tournament_matches (room_code)
  WHERE room_code IS NOT NULL;

CREATE INDEX idx_tournament_matches_next_match_id
  ON public.tournament_matches (next_match_id)
  WHERE next_match_id IS NOT NULL;

CREATE INDEX idx_tournament_matches_round
  ON public.tournament_matches (tournament_id, round_number, slot_index);

-- ---------------------------------------------------------------------------
-- updated_at trigger (tournaments only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tournaments_set_updated_at
  BEFORE UPDATE ON public.tournaments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;

-- tournaments: authenticated read; creator may insert/update own (v1, no admin UI)
CREATE POLICY tournaments_select_authenticated
  ON public.tournaments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY tournaments_insert_creator
  ON public.tournaments
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY tournaments_update_creator
  ON public.tournaments
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- tournament_entries: read all; insert/update/delete own row only
CREATE POLICY tournament_entries_select_authenticated
  ON public.tournament_entries
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY tournament_entries_insert_own
  ON public.tournament_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY tournament_entries_update_own
  ON public.tournament_entries
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY tournament_entries_delete_own
  ON public.tournament_entries
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- tournament_matches: read only for clients; writes via service role / backend
CREATE POLICY tournament_matches_select_authenticated
  ON public.tournament_matches
  FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT / UPDATE / DELETE policies on tournament_matches for authenticated.
-- Realtime server (service role) advances brackets and assigns room_code.

-- ---------------------------------------------------------------------------
-- Grants (Supabase default: authenticated can use public schema)
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.tournaments TO authenticated;
GRANT INSERT, UPDATE ON public.tournaments TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournament_entries TO authenticated;

GRANT SELECT ON public.tournament_matches TO authenticated;

-- Service role bypasses RLS; used by apps/realtime-server for bracket ops.
