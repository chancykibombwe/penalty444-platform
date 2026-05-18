-- Scheduled tournament Phase 1: play_by deadlines, void (double no-show), BYE indexes.
-- Existing rows unchanged; new columns nullable.

ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS play_by TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_processed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tournament_matches.play_by IS
  'Deadline for participants to open/play this slot (set by scheduler in a later phase).';

COMMENT ON COLUMN public.tournament_matches.no_show_processed_at IS
  'Set when a no-show / walkover / void job has processed this slot (idempotency).';

-- status: add void (both absent — no winner from this branch)
ALTER TABLE public.tournament_matches
  DROP CONSTRAINT IF EXISTS tournament_matches_status_valid;

ALTER TABLE public.tournament_matches
  ADD CONSTRAINT tournament_matches_status_valid CHECK (
    status IN (
      'pending',
      'ready',
      'in_progress',
      'completed',
      'walkover',
      'void',
      'cancelled'
    )
  );

-- Terminal winner rules: completed/walkover need winner; void must have no winner
ALTER TABLE public.tournament_matches
  DROP CONSTRAINT IF EXISTS tournament_matches_winner_when_terminal;

ALTER TABLE public.tournament_matches
  ADD CONSTRAINT tournament_matches_winner_when_terminal CHECK (
    (
      status IN ('completed', 'walkover')
      AND winner_entry_id IS NOT NULL
    )
    OR (
      status = 'void'
      AND winner_entry_id IS NULL
    )
    OR (
      status IN ('pending', 'ready', 'in_progress')
      AND winner_entry_id IS NULL
    )
    OR (status = 'cancelled')
  );

-- void requires completed_at like other terminal outcomes
ALTER TABLE public.tournament_matches
  DROP CONSTRAINT IF EXISTS tournament_matches_completed_timestamps;

ALTER TABLE public.tournament_matches
  ADD CONSTRAINT tournament_matches_completed_timestamps CHECK (
    (
      status IN ('completed', 'walkover', 'void')
      AND completed_at IS NOT NULL
    )
    OR (status NOT IN ('completed', 'walkover', 'void'))
  );

CREATE INDEX IF NOT EXISTS idx_tournament_matches_status_play_by
  ON public.tournament_matches (status, play_by);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament_status_play_by
  ON public.tournament_matches (tournament_id, status, play_by);
