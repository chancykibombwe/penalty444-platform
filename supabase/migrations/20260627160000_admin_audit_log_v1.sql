-- =============================================================================
-- Admin Audit Log v1 (Penalty444)
-- =============================================================================
-- Scope: an append-only record of admin moderation / triage actions so we can
-- see which admin changed what, when, and from which status to which.
--
-- Logged actions (v1):
--   * feedback_status_update  — beta_feedback.status changes
--   * chat_status_update      — lobby_chat_messages.status changes
--
-- Security model (matches the project's RLS style — see
-- 20260612120000_beta_feedback_v1.sql and
-- 20260523080000_rls_security_hardening.sql):
--
--   * RLS ON.
--   * NO client policy of any kind — no SELECT, INSERT, UPDATE, or DELETE for
--     anon or authenticated. Normal users can never read or write this table.
--   * Writes and reads happen exclusively through the service role (server-side
--     admin API routes), which bypasses RLS. The admin dashboard reads it via
--     the service role and returns only safe display fields.
--
-- This table holds NO money, NO gameplay state, and NO message content / PII.
-- It stores the acting admin's auth id, the action, the target row id, and the
-- old/new status strings, plus a small safe metadata object.
-- =============================================================================

CREATE TABLE public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Nullable + ON DELETE SET NULL so the audit row survives if the admin
  -- account is ever removed.
  admin_user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  old_status TEXT,
  new_status TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT admin_audit_log_action_valid CHECK (
    action IN ('feedback_status_update', 'chat_status_update')
  ),
  CONSTRAINT admin_audit_log_target_table_valid CHECK (
    target_table IN ('beta_feedback', 'lobby_chat_messages')
  ),
  -- metadata must be a JSON object (not an array / scalar).
  CONSTRAINT admin_audit_log_metadata_is_object CHECK (
    jsonb_typeof(metadata) = 'object'
  )
);

COMMENT ON TABLE public.admin_audit_log IS
  'Append-only audit trail of admin moderation/triage actions. Service-role '
  'only — no client policies. No money, gameplay, message content, or PII.';

COMMENT ON COLUMN public.admin_audit_log.action IS
  'feedback_status_update | chat_status_update.';

COMMENT ON COLUMN public.admin_audit_log.target_table IS
  'beta_feedback | lobby_chat_messages — the table whose row changed.';

COMMENT ON COLUMN public.admin_audit_log.metadata IS
  'Small safe context object (e.g. category/route/room). Never message body, '
  'email, or secrets.';

-- ---------------------------------------------------------------------------
-- Indexes — support the admin audit views (service-role reads).
-- ---------------------------------------------------------------------------
CREATE INDEX idx_admin_audit_log_created_at
  ON public.admin_audit_log (created_at DESC);
CREATE INDEX idx_admin_audit_log_admin_created
  ON public.admin_audit_log (admin_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_log_target_created
  ON public.admin_audit_log (target_table, target_id, created_at DESC);
CREATE INDEX idx_admin_audit_log_action_created
  ON public.admin_audit_log (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- Row Level Security — service role only.
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Intentionally NO policies for anon / authenticated:
--   * No SELECT  — normal users can never read the audit log.
--   * No INSERT  — clients can never write audit rows.
--   * No UPDATE / DELETE — the log is append-only and tamper-resistant.
-- The service role bypasses RLS and is the only writer/reader, used by the
-- server-side admin API routes.

-- Defensively revoke any default table grants so authenticated/anon cannot
-- even attempt an operation (RLS would block it, but fail closed on grants
-- too — mirrors the wallet/ledger hardening pattern).
REVOKE ALL ON public.admin_audit_log FROM anon, authenticated;
