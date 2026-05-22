-- =============================================================================
-- Phase 10 — Real Economy System Foundation v1
-- =============================================================================
-- Scope:
--   Foundational schema for a server-authoritative competitive economy.
--   Adds wallets, append-only ledger, escrow locks, settlement events,
--   audit events, and tournament prize-pool columns.
--
-- NON-NEGOTIABLE INVARIANTS:
--   1. Balance is DERIVED from the ledger. UPDATE on wallets allowed only
--      via the service-role helpers; never directly by clients.
--   2. wallet_ledger_entries is APPEND-ONLY. No UPDATE / DELETE grants.
--   3. Every money-moving op carries a unique idempotency_key. Duplicate
--      inserts return a 23505 unique_violation that callers treat as a
--      benign no-op.
--   4. settlement_events is keyed by (room_code, match_instance,
--      settlement_type) so the same match cannot be settled twice.
--   5. audit_events is APPEND-ONLY for forensic / compliance review.
--
-- WHAT THIS MIGRATION DOES NOT DO:
--   - No real payment integration (Stripe / mobile money / crypto).
--   - No deposits / withdrawals RPCs (foundation only).
--   - No payouts wired into the live match flow yet — gameplay continues
--     to use the legacy `lock_wallet_stake` / `settle_wallet_stakes` RPCs
--     until the economy feature flag is enabled.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. wallets
-- ---------------------------------------------------------------------------
-- One row per (user_id, currency). available + locked are materialised
-- projections of the ledger; the invariant is enforced by the service-role
-- helpers, not by triggers (to keep the legacy stake path unchanged).
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'P4C',  -- placeholder: "Penalty 444 Coin"
  available_balance_minor BIGINT NOT NULL DEFAULT 0,
  locked_balance_minor BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT wallets_currency_not_empty CHECK (char_length(trim(currency)) > 0),
  CONSTRAINT wallets_status_valid CHECK (
    status IN ('active', 'suspended', 'locked')
  ),
  CONSTRAINT wallets_available_non_negative CHECK (available_balance_minor >= 0),
  CONSTRAINT wallets_locked_non_negative CHECK (locked_balance_minor >= 0),
  CONSTRAINT wallets_user_currency_unique UNIQUE (user_id, currency)
);

COMMENT ON TABLE public.wallets IS
  'Per-user wallet projection. Balance is DERIVED from wallet_ledger_entries; '
  'these columns are kept materialised by service-role helpers for read speed.';

COMMENT ON COLUMN public.wallets.available_balance_minor IS
  'Balance available to spend (minor units, e.g. cents). MUST equal '
  'SUM(delta) over ledger entries where direction affects "available".';

COMMENT ON COLUMN public.wallets.locked_balance_minor IS
  'Balance currently held in escrow. MUST equal SUM of unsettled escrow_locks.';

-- ---------------------------------------------------------------------------
-- 2. wallet_ledger_entries
-- ---------------------------------------------------------------------------
-- APPEND-ONLY double-entry-style ledger. Every money movement is one row.
CREATE TABLE IF NOT EXISTS public.wallet_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets (id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL,
  direction TEXT NOT NULL,                  -- 'credit' | 'debit'
  amount_minor BIGINT NOT NULL,             -- always positive
  balance_before_minor BIGINT NOT NULL,
  balance_after_minor BIGINT NOT NULL,
  reference_type TEXT,                      -- 'match' | 'tournament' | 'manual' ...
  reference_id TEXT,                        -- room_code / tournament_id / ...
  idempotency_key TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT wallet_ledger_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT wallet_ledger_direction_valid CHECK (
    direction IN ('credit', 'debit')
  ),
  CONSTRAINT wallet_ledger_transaction_type_valid CHECK (
    transaction_type IN (
      'deposit',
      'withdrawal',
      'escrow_lock',
      'escrow_release',
      'escrow_payout',
      'escrow_refund',
      'tournament_entry_fee',
      'tournament_prize_payout',
      'tournament_entry_refund',
      'manual_adjustment'
    )
  ),
  CONSTRAINT wallet_ledger_idem_unique UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS wallet_ledger_wallet_idx
  ON public.wallet_ledger_entries (wallet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_user_idx
  ON public.wallet_ledger_entries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_reference_idx
  ON public.wallet_ledger_entries (reference_type, reference_id);

COMMENT ON TABLE public.wallet_ledger_entries IS
  'APPEND-ONLY ledger. Every money movement is one row. Balance is the '
  'sum of credits minus debits per wallet_id, materialised on wallets.';

COMMENT ON COLUMN public.wallet_ledger_entries.idempotency_key IS
  'Stable, deterministic key. Retries collapse onto the same row via the '
  'UNIQUE (user_id, idempotency_key) constraint.';

-- ---------------------------------------------------------------------------
-- 3. escrow_locks
-- ---------------------------------------------------------------------------
-- Funds in flight (per-player stake). One row per locked stake.
-- For matches: (room_code, match_instance, user_id) is unique.
-- For tournament entries: (tournament_id, user_id, scope='entry') is unique.
CREATE TABLE IF NOT EXISTS public.escrow_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,                       -- 'match' | 'tournament_entry'
  room_code TEXT,                            -- present when scope='match'
  match_instance INTEGER,                    -- present when scope='match'
  tournament_id UUID REFERENCES public.tournaments (id) ON DELETE RESTRICT,
  amount_minor BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'P4C',
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,

  CONSTRAINT escrow_locks_amount_positive CHECK (amount_minor > 0),
  CONSTRAINT escrow_locks_scope_valid CHECK (
    scope IN ('match', 'tournament_entry')
  ),
  CONSTRAINT escrow_locks_status_valid CHECK (
    status IN ('pending', 'locked', 'settled', 'refunded', 'failed')
  ),
  CONSTRAINT escrow_locks_match_columns CHECK (
    (scope = 'match' AND room_code IS NOT NULL AND match_instance IS NOT NULL)
    OR scope <> 'match'
  ),
  CONSTRAINT escrow_locks_tournament_columns CHECK (
    (scope = 'tournament_entry' AND tournament_id IS NOT NULL)
    OR scope <> 'tournament_entry'
  )
);

-- Per-player uniqueness for match escrows.
CREATE UNIQUE INDEX IF NOT EXISTS escrow_locks_match_user_unique
  ON public.escrow_locks (room_code, match_instance, user_id)
  WHERE scope = 'match';

-- Per-player uniqueness for tournament entry escrows.
CREATE UNIQUE INDEX IF NOT EXISTS escrow_locks_tournament_user_unique
  ON public.escrow_locks (tournament_id, user_id)
  WHERE scope = 'tournament_entry';

CREATE INDEX IF NOT EXISTS escrow_locks_user_status_idx
  ON public.escrow_locks (user_id, status);
CREATE INDEX IF NOT EXISTS escrow_locks_room_status_idx
  ON public.escrow_locks (room_code, status)
  WHERE scope = 'match';

COMMENT ON TABLE public.escrow_locks IS
  'Per-player escrow. Status flow: pending → locked → settled | refunded | failed. '
  'Wallet locked_balance_minor MUST equal SUM(amount_minor) where status=locked.';

-- ---------------------------------------------------------------------------
-- 4. settlement_events
-- ---------------------------------------------------------------------------
-- Records that a match / tournament has been settled. Idempotency anchor.
CREATE TABLE IF NOT EXISTS public.settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,                       -- 'match' | 'tournament'
  room_code TEXT,                            -- match settlements
  match_instance INTEGER,                    -- match settlements
  tournament_id UUID REFERENCES public.tournaments (id) ON DELETE RESTRICT,
  settlement_type TEXT NOT NULL,             -- 'match_payout' | 'match_refund' | 'tournament_payout' | 'tournament_refund'
  status TEXT NOT NULL DEFAULT 'pending',
  processed_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT settlement_events_scope_valid CHECK (
    scope IN ('match', 'tournament')
  ),
  CONSTRAINT settlement_events_status_valid CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'reversed')
  ),
  CONSTRAINT settlement_events_match_columns CHECK (
    (scope = 'match' AND room_code IS NOT NULL AND match_instance IS NOT NULL)
    OR scope <> 'match'
  ),
  CONSTRAINT settlement_events_tournament_columns CHECK (
    (scope = 'tournament' AND tournament_id IS NOT NULL)
    OR scope <> 'tournament'
  ),
  CONSTRAINT settlement_events_type_valid CHECK (
    settlement_type IN (
      'match_payout',
      'match_refund',
      'match_draw_refund',
      'tournament_payout',
      'tournament_refund'
    )
  )
);

-- Per-match uniqueness — same (room_code, match_instance, settlement_type)
-- cannot be settled twice.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_events_match_unique
  ON public.settlement_events (room_code, match_instance, settlement_type)
  WHERE scope = 'match';

CREATE UNIQUE INDEX IF NOT EXISTS settlement_events_tournament_unique
  ON public.settlement_events (tournament_id, settlement_type)
  WHERE scope = 'tournament';

COMMENT ON TABLE public.settlement_events IS
  'Idempotency anchor for settlement. Status flow: pending → processing → '
  'completed | failed | reversed. Application asserts no duplicate writes.';

-- ---------------------------------------------------------------------------
-- 5. audit_events
-- ---------------------------------------------------------------------------
-- APPEND-ONLY audit trail for every economy-relevant action.
CREATE TABLE IF NOT EXISTS public.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL DEFAULT 'system',
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_type TEXT,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT audit_events_actor_kind_valid CHECK (
    actor_kind IN ('user', 'system', 'admin', 'realtime_server')
  ),
  CONSTRAINT audit_events_severity_valid CHECK (
    severity IN ('info', 'warning', 'error', 'critical')
  )
);

CREATE INDEX IF NOT EXISTS audit_events_event_type_idx
  ON public.audit_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_reference_idx
  ON public.audit_events (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON public.audit_events (actor_id, created_at DESC);

COMMENT ON TABLE public.audit_events IS
  'APPEND-ONLY audit trail. All ledger / escrow / settlement transitions '
  'emit one row. Read-only for the client; no UPDATE / DELETE grants.';

-- ---------------------------------------------------------------------------
-- 6. tournaments — prize pool foundation columns
-- ---------------------------------------------------------------------------
-- Foundation only: these columns may be NULL until economy is enabled.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS entry_fee_minor BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'P4C',
  ADD COLUMN IF NOT EXISTS rake_bps INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_structure JSONB NOT NULL DEFAULT '{"1":1.0}'::jsonb,
  ADD COLUMN IF NOT EXISTS prize_pool_minor BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournaments'::regclass
      AND conname = 'tournaments_entry_fee_non_negative'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_entry_fee_non_negative
      CHECK (entry_fee_minor >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournaments'::regclass
      AND conname = 'tournaments_rake_bps_range'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_rake_bps_range
      CHECK (rake_bps >= 0 AND rake_bps <= 10000);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tournaments'::regclass
      AND conname = 'tournaments_prize_pool_non_negative'
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_prize_pool_non_negative
      CHECK (prize_pool_minor >= 0);
  END IF;
END
$$;

COMMENT ON COLUMN public.tournaments.entry_fee_minor IS
  'Entry fee in minor units. 0 means free entry. Phase 10 foundation only — '
  'collection is gated behind the ECONOMY_ENABLED feature flag.';

COMMENT ON COLUMN public.tournaments.rake_bps IS
  'Platform rake in basis points (0-10000). Capped at 10000 (100%).';

COMMENT ON COLUMN public.tournaments.payout_structure IS
  'JSON map from finishing position (string) to share fraction. '
  'Default {"1":1.0} = 100%% to first place.';

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wallets'
      AND policyname = 'wallets_self_read'
  ) THEN
    CREATE POLICY wallets_self_read ON public.wallets
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wallet_ledger_entries'
      AND policyname = 'wallet_ledger_self_read'
  ) THEN
    CREATE POLICY wallet_ledger_self_read ON public.wallet_ledger_entries
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'escrow_locks'
      AND policyname = 'escrow_locks_self_read'
  ) THEN
    CREATE POLICY escrow_locks_self_read ON public.escrow_locks
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END
$$;

-- settlement_events and audit_events: NO client read policies → service role only.

-- ---------------------------------------------------------------------------
-- 8. updated_at trigger for wallets
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.economy_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallets_touch_updated_at ON public.wallets;
CREATE TRIGGER wallets_touch_updated_at
  BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.economy_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. economy_apply_ledger_entry RPC
-- ---------------------------------------------------------------------------
-- The ONLY function allowed to insert into wallet_ledger_entries with a
-- balance projection onto wallets. Service-role only (RLS keeps clients out).
--
-- Atomically (single SQL txn):
--   1. Lock the wallet row (SELECT ... FOR UPDATE).
--   2. Verify non-negative outcome.
--   3. Apply the move to the requested pocket (available | locked | transfer).
--   4. Insert the ledger row with balance_before / balance_after stamped.
--   5. Return the row.
--
-- "transfer" pockets move money between available <-> locked without
-- changing total wallet equity (used for escrow lock / release).
--   - direction=debit + pocket=transfer  → available -= amount, locked += amount
--   - direction=credit + pocket=transfer → locked    -= amount, available += amount
CREATE OR REPLACE FUNCTION public.economy_apply_ledger_entry(
  p_wallet_id UUID,
  p_user_id UUID,
  p_transaction_type TEXT,
  p_direction TEXT,
  p_amount_minor BIGINT,
  p_pocket TEXT,
  p_idempotency_key TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS public.wallet_ledger_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_balance_before BIGINT;
  v_balance_after BIGINT;
  v_new_available BIGINT;
  v_new_locked BIGINT;
  v_row public.wallet_ledger_entries%ROWTYPE;
BEGIN
  IF p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'economy_apply_ledger_entry: amount must be positive';
  END IF;

  IF p_direction NOT IN ('credit', 'debit') THEN
    RAISE EXCEPTION 'economy_apply_ledger_entry: invalid direction %', p_direction;
  END IF;

  IF p_pocket NOT IN ('available', 'locked', 'transfer') THEN
    RAISE EXCEPTION 'economy_apply_ledger_entry: invalid pocket %', p_pocket;
  END IF;

  -- Lock the wallet row for the duration of this transaction.
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = p_wallet_id AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'economy_apply_ledger_entry: wallet not found';
  END IF;

  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'economy_apply_ledger_entry: wallet status %', v_wallet.status;
  END IF;

  v_new_available := v_wallet.available_balance_minor;
  v_new_locked    := v_wallet.locked_balance_minor;

  IF p_pocket = 'available' THEN
    v_balance_before := v_new_available;
    IF p_direction = 'credit' THEN
      v_new_available := v_new_available + p_amount_minor;
    ELSE
      v_new_available := v_new_available - p_amount_minor;
    END IF;
    v_balance_after := v_new_available;
  ELSIF p_pocket = 'locked' THEN
    v_balance_before := v_new_locked;
    IF p_direction = 'credit' THEN
      v_new_locked := v_new_locked + p_amount_minor;
    ELSE
      v_new_locked := v_new_locked - p_amount_minor;
    END IF;
    v_balance_after := v_new_locked;
  ELSE  -- transfer
    v_balance_before := v_new_available;
    IF p_direction = 'debit' THEN
      -- available → locked
      v_new_available := v_new_available - p_amount_minor;
      v_new_locked    := v_new_locked    + p_amount_minor;
    ELSE
      -- locked → available
      v_new_locked    := v_new_locked    - p_amount_minor;
      v_new_available := v_new_available + p_amount_minor;
    END IF;
    v_balance_after := v_new_available;
  END IF;

  IF v_new_available < 0 OR v_new_locked < 0 THEN
    RAISE EXCEPTION 'economy_apply_ledger_entry: balance would go negative '
      'available=% locked=%', v_new_available, v_new_locked;
  END IF;

  INSERT INTO public.wallet_ledger_entries (
    wallet_id,
    user_id,
    transaction_type,
    direction,
    amount_minor,
    balance_before_minor,
    balance_after_minor,
    reference_type,
    reference_id,
    idempotency_key,
    metadata
  )
  VALUES (
    p_wallet_id,
    p_user_id,
    p_transaction_type,
    p_direction,
    p_amount_minor,
    v_balance_before,
    v_balance_after,
    p_reference_type,
    p_reference_id,
    p_idempotency_key,
    p_metadata
  )
  RETURNING * INTO v_row;

  UPDATE public.wallets
  SET
    available_balance_minor = v_new_available,
    locked_balance_minor = v_new_locked
  WHERE id = p_wallet_id;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.economy_apply_ledger_entry(
  UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
