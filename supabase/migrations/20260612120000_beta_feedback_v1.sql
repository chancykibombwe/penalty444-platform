-- =============================================================================
-- Beta Feedback / Bug Report system v1 (Penalty444)
-- =============================================================================
-- Scope: a single append-only table that lets logged-in beta testers submit
-- bug reports / feedback from inside the app.
--
-- Security model (matches the rest of the project — see
-- 20260515120000_tournament_infrastructure_v1.sql and
-- 20260523080000_rls_security_hardening.sql):
--
--   * RLS ON.
--   * authenticated users may INSERT only their OWN row (user_id = auth.uid()).
--   * authenticated users have NO SELECT / UPDATE / DELETE policy — a tester
--     can submit feedback but can never read, edit, or delete any feedback
--     (their own or anyone else's).
--   * The service role bypasses RLS, so an admin tool can read the queue later.
--     No admin-facing read surface is exposed to clients in this migration.
--
-- This table holds NO money, NO gameplay state, and NO PII beyond the
-- optional auth user id and a free-text message the tester chooses to type.
-- =============================================================================

CREATE TABLE public.beta_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Nullable so the column survives an ON DELETE SET NULL if the user is ever
  -- removed; the INSERT RLS policy still forces it to auth.uid() at write time.
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  route TEXT,
  room_code TEXT,
  user_agent TEXT,
  status TEXT NOT NULL DEFAULT 'open',

  CONSTRAINT beta_feedback_category_valid CHECK (
    category IN (
      'match',
      'auth',
      'mobile',
      'tournament',
      'leaderboard',
      'confusing_ui',
      'wallet_safety',
      'other'
    )
  ),
  CONSTRAINT beta_feedback_message_not_empty CHECK (
    char_length(trim(message)) > 0
  ),
  -- Defensive server-side cap mirroring the 1000-char client limit so an
  -- oversized payload can never bloat the table.
  CONSTRAINT beta_feedback_message_max_len CHECK (
    char_length(message) <= 1000
  ),
  CONSTRAINT beta_feedback_status_valid CHECK (
    status IN ('open', 'triaged', 'resolved', 'wont_fix')
  )
);

COMMENT ON TABLE public.beta_feedback IS
  'Append-only beta tester feedback / bug reports. Clients may INSERT own rows '
  'only; reads are service-role (admin) only. No money / gameplay state.';

COMMENT ON COLUMN public.beta_feedback.category IS
  'One of: match, auth, mobile, tournament, leaderboard, confusing_ui, '
  'wallet_safety, other. Validated by CHECK + the client picker.';

COMMENT ON COLUMN public.beta_feedback.status IS
  'Triage lifecycle, set by admins via the service role: open → triaged → '
  'resolved | wont_fix. Clients always insert the default ''open''.';

-- ---------------------------------------------------------------------------
-- Indexes — support the future admin triage queue (service-role reads).
-- ---------------------------------------------------------------------------
CREATE INDEX idx_beta_feedback_created_at ON public.beta_feedback (created_at DESC);
CREATE INDEX idx_beta_feedback_status ON public.beta_feedback (status);
CREATE INDEX idx_beta_feedback_category ON public.beta_feedback (category);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

-- Insert: authenticated testers may create feedback rows attributed to
-- themselves only. user_id is forced to the caller's auth uid.
CREATE POLICY beta_feedback_insert_own
  ON public.beta_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- No SELECT / UPDATE / DELETE policies for authenticated:
--   * Testers cannot read the feedback queue (their own or others').
--   * Testers cannot edit or delete submitted feedback.
-- The service role bypasses RLS for a future admin triage view.

-- ---------------------------------------------------------------------------
-- Grants — privilege to even attempt the op; RLS still gates the rows.
-- INSERT only for authenticated; deliberately NO SELECT grant.
-- ---------------------------------------------------------------------------
GRANT INSERT ON public.beta_feedback TO authenticated;
