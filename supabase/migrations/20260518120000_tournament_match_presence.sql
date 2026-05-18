-- Phase 5B: per-side tournament match presence and opponent join deadline.

ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS entry_one_present_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS entry_two_present_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opponent_join_by TIMESTAMPTZ;

COMMENT ON COLUMN public.tournament_matches.entry_one_present_at IS
  'When entry_one participant appeared for this match (Enter Match / room API).';

COMMENT ON COLUMN public.tournament_matches.entry_two_present_at IS
  'When entry_two participant appeared for this match (Enter Match / room API).';

COMMENT ON COLUMN public.tournament_matches.opponent_join_by IS
  'Deadline for the missing side to appear after the first presence was recorded.';

CREATE INDEX IF NOT EXISTS idx_tournament_matches_in_progress_opponent_join_by
  ON public.tournament_matches (status, opponent_join_by)
  WHERE status = 'in_progress' AND opponent_join_by IS NOT NULL;
