-- =============================================================================
-- Phase 12 — Economy Operations & Reconciliation foundation migration.
--
-- Adds:
--   * settlement_events.retry_count / last_retry_at / failure_reason
--   * settlement_events.status values: 'requires_payout', 'manual_review'
--   * escrow_locks.status value:        'manual_review'
--   * settlement_events.tournament_type can now be 'tournament_refund'
--     (already permitted by Phase 10 CHECK — no change required).
--   * Optional view audit_events_recent for ops queries (last 14 days).
--
-- Does NOT change:
--   * Append-only contract for wallet_ledger_entries.
--   * RLS policies — all new columns inherit existing service-role posture.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. settlement_events — retry & failure metadata
-- ---------------------------------------------------------------------------
ALTER TABLE public.settlement_events
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.settlement_events'::regclass
      AND conname = 'settlement_events_retry_count_non_negative'
  ) THEN
    ALTER TABLE public.settlement_events
      ADD CONSTRAINT settlement_events_retry_count_non_negative
      CHECK (retry_count >= 0);
  END IF;
END
$$;

-- Expand the status CHECK to include the recovery / payout-gated states.
-- The original CHECK allowed (pending, processing, completed, failed, reversed).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.settlement_events'::regclass
      AND conname = 'settlement_events_status_valid'
  ) THEN
    ALTER TABLE public.settlement_events
      DROP CONSTRAINT settlement_events_status_valid;
  END IF;

  ALTER TABLE public.settlement_events
    ADD CONSTRAINT settlement_events_status_valid
    CHECK (
      status IN (
        'pending',
        'processing',
        'completed',
        'failed',
        'reversed',
        'requires_payout',
        'manual_review'
      )
    );
END
$$;

CREATE INDEX IF NOT EXISTS settlement_events_status_processing_idx
  ON public.settlement_events (status, created_at DESC)
  WHERE status IN ('processing', 'failed', 'requires_payout', 'manual_review');

COMMENT ON COLUMN public.settlement_events.retry_count IS
  'Phase 12: increments every time the reconciliation worker retries a stuck '
  'settlement. Bounded by MAX_SETTLEMENT_RETRIES in the realtime server.';

COMMENT ON COLUMN public.settlement_events.failure_reason IS
  'Phase 12: machine-readable reason the settlement could not complete. '
  'NULL on success or in-progress states.';

-- ---------------------------------------------------------------------------
-- 2. escrow_locks — manual_review terminal-ish status
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.escrow_locks'::regclass
      AND conname = 'escrow_locks_status_valid'
  ) THEN
    ALTER TABLE public.escrow_locks
      DROP CONSTRAINT escrow_locks_status_valid;
  END IF;

  ALTER TABLE public.escrow_locks
    ADD CONSTRAINT escrow_locks_status_valid
    CHECK (
      status IN (
        'pending',
        'locked',
        'settled',
        'refunded',
        'failed',
        'manual_review'
      )
    );
END
$$;

COMMENT ON COLUMN public.escrow_locks.status IS
  'Status flow: pending → locked → settled | refunded | failed. '
  'Phase 12 adds the ''manual_review'' branch reached only by the '
  'reconciliation worker when it cannot decide what to do safely.';

-- ---------------------------------------------------------------------------
-- 3. audit_events_recent — service-role view for ops queries
-- ---------------------------------------------------------------------------
-- Convenience view that the ops endpoints read. RLS is unnecessary because
-- the underlying `audit_events` table is already service-role-only.
CREATE OR REPLACE VIEW public.audit_events_recent AS
  SELECT id,
         actor_id,
         actor_kind,
         event_type,
         severity,
         payload,
         reference_type,
         reference_id,
         created_at
  FROM public.audit_events
  WHERE created_at >= now() - interval '14 days'
  ORDER BY created_at DESC;

COMMENT ON VIEW public.audit_events_recent IS
  'Phase 12 ops convenience: last 14 days of audit events. Read via the '
  '/internal/economy/ops/audit endpoint using the service-role key.';

-- ---------------------------------------------------------------------------
-- 4. settlement_events.settlement_type — add ''tournament_refund''
-- ---------------------------------------------------------------------------
-- Already permitted by the Phase 10 CHECK. No change required, kept here
-- as documentation.
