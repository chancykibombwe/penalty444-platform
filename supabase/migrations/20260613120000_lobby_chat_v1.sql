-- =============================================================================
-- Lobby Chat / Arena Chat v1 (Penalty444)
-- =============================================================================
-- Scope: a single global lobby chat table so logged-in beta testers can post
-- short, plain-text messages visible to other logged-in users.
--
-- Security model (matches PR #138 beta_feedback and the project's RLS style —
-- see 20260612120000_beta_feedback_v1.sql and
-- 20260523080000_rls_security_hardening.sql):
--
--   * RLS ON.
--   * authenticated users may SELECT only VISIBLE messages
--     (status = 'visible'); hidden / flagged rows are invisible to clients.
--   * authenticated users may INSERT only their OWN visible message
--     (user_id = auth.uid() AND status = 'visible').
--   * authenticated users have NO UPDATE / DELETE policy — a tester can post
--     and read visible chat but can never edit, delete, hide, or flag rows.
--   * The service role bypasses RLS, so a future admin moderation tool can
--     hide / flag rows. No moderation surface is exposed to clients here.
--
-- This table holds NO money, NO gameplay state, and NO PII beyond the auth
-- user id and the free-text message a tester chooses to type. Usernames are
-- resolved separately from the publicly-readable `profiles` table; this table
-- never stores email or display name.
-- =============================================================================

CREATE TABLE public.lobby_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible',
  -- Reserved for future scoped rooms; locked to 'global' for v1.
  room TEXT NOT NULL DEFAULT 'global',

  CONSTRAINT lobby_chat_messages_message_not_empty CHECK (
    char_length(trim(message)) > 0
  ),
  -- Defensive server-side cap mirroring the 280-char client limit so an
  -- oversized payload can never bloat the table.
  CONSTRAINT lobby_chat_messages_message_max_len CHECK (
    char_length(message) <= 280
  ),
  CONSTRAINT lobby_chat_messages_status_valid CHECK (
    status IN ('visible', 'hidden', 'flagged')
  ),
  CONSTRAINT lobby_chat_messages_room_valid CHECK (
    room IN ('global')
  )
);

COMMENT ON TABLE public.lobby_chat_messages IS
  'Global lobby chat. Clients may SELECT visible rows and INSERT own visible '
  'rows only; edit / delete / moderate are service-role (admin) only. No '
  'money / gameplay state. Usernames resolved from public.profiles.';

COMMENT ON COLUMN public.lobby_chat_messages.status IS
  'Moderation state set by admins via the service role: visible → hidden | '
  'flagged. Clients always insert the default ''visible'' and only ever read '
  'visible rows.';

COMMENT ON COLUMN public.lobby_chat_messages.room IS
  'Reserved for future scoped chat rooms. Locked to ''global'' in v1.';

-- ---------------------------------------------------------------------------
-- Indexes
--   * (status, created_at DESC) — the client fetch: newest visible messages.
--   * (user_id, created_at DESC) — future per-user rate limiting / moderation.
-- ---------------------------------------------------------------------------
CREATE INDEX idx_lobby_chat_messages_status_created
  ON public.lobby_chat_messages (status, created_at DESC);
CREATE INDEX idx_lobby_chat_messages_user_created
  ON public.lobby_chat_messages (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.lobby_chat_messages ENABLE ROW LEVEL SECURITY;

-- Read: authenticated users see VISIBLE messages only. Hidden / flagged rows
-- are filtered out at the policy level, not just in the query.
CREATE POLICY lobby_chat_messages_select_visible
  ON public.lobby_chat_messages
  FOR SELECT
  TO authenticated
  USING (status = 'visible');

-- Insert: authenticated users may post their OWN visible message only. The
-- WITH CHECK forces ownership and prevents a client from inserting a row that
-- is pre-hidden / pre-flagged or attributed to another user.
CREATE POLICY lobby_chat_messages_insert_own
  ON public.lobby_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'visible');

-- No UPDATE / DELETE policies for authenticated:
--   * Testers cannot edit, delete, hide, or flag any message.
-- The service role bypasses RLS for a future admin moderation view.

-- ---------------------------------------------------------------------------
-- Grants — privilege to attempt the op; RLS still gates the rows.
-- SELECT + INSERT for authenticated; deliberately NO UPDATE / DELETE.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT ON public.lobby_chat_messages TO authenticated;
