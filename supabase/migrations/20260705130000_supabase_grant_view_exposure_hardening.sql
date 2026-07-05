-- =============================================================================
-- Supabase Grant & View Exposure Hardening
-- =============================================================================
-- Source: full-platform audit (docs/full-platform-audit.md) — findings DB-1 and
-- DB-2. Grant/view surface only: no schema redesign, no function-body changes,
-- no new tables/views, no economy activation.
--
-- Two exposure gaps remained after the earlier hardening sprint:
--
--   1. public.economy_apply_ledger_entry(...) — a SECURITY DEFINER function
--      that credits/debits wallets + wallet_ledger_entries. Its creating
--      migration (20260522104000) did `REVOKE ALL ... FROM PUBLIC` only. In
--      this project PostgREST-exposed functions are also EXECUTE-granted to
--      anon/authenticated (see 20260610120000, whose comment confirms the
--      legacy wallet RPCs "are currently EXECUTE-granted to PUBLIC, anon, and
--      authenticated"), so a REVOKE FROM PUBLIC alone leaves anon/authenticated
--      able to call it directly via /rest/v1/rpc. This migration revokes those
--      roles and (re)grants only service_role — mirroring the exact pattern of
--      20260610120000 for the legacy wallet RPCs.
--
--   2. public.audit_events_recent — a view over the service-role-only
--      audit_events table, created (20260523093000) without security_invoker.
--      Without it the view runs with its owner's privileges and bypasses the
--      underlying table's RLS/grant lockdown; combined with default public-schema
--      SELECT grants, a client could read 14 days of audit trail. This migration
--      makes the view security_invoker (so the querying role's privileges +
--      RLS apply) AND revokes client SELECT, leaving only service_role.
--
-- Trust model: service_role (the realtime server + server API/ops routes) is
-- the only intended caller/reader of both objects and keeps full access.
--
-- Safety verified against the codebase:
--   • economy_apply_ledger_entry has NO caller anywhere in apps/ (economy is
--     off; the function is dormant). Revoking anon/authenticated cannot break
--     any current flow.
--   • audit_events_recent has NO reference anywhere in apps/. Its only intended
--     reader is the service-role ops endpoint.
--
-- No money moves. No frontend / realtime / admin app-code / Home / Unity
-- changes. Economy stays fail-closed.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. economy_apply_ledger_entry — close the direct-RPC execute surface
-- ---------------------------------------------------------------------------
-- Exact signature (from 20260522104000_economy_foundation_v1.sql):
--   economy_apply_ledger_entry(
--     p_wallet_id UUID, p_user_id UUID, p_transaction_type TEXT,
--     p_direction TEXT, p_amount_minor BIGINT, p_pocket TEXT,
--     p_idempotency_key TEXT, p_reference_type TEXT DEFAULT NULL,
--     p_reference_id TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'
--   )
-- Identity argument types: (UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT,
-- TEXT, JSONB). There is exactly one overload.
REVOKE EXECUTE ON FUNCTION public.economy_apply_ledger_entry(
  UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.economy_apply_ledger_entry(
  UUID, UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, JSONB
) TO service_role;


-- ---------------------------------------------------------------------------
-- 2. audit_events_recent — invoker-safety + revoke client SELECT
-- ---------------------------------------------------------------------------
-- security_invoker requires PostgreSQL 15+ (Supabase default). Guarded so the
-- migration is safe on any version; the REVOKE below is the primary control
-- and applies regardless of version.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'ALTER VIEW public.audit_events_recent SET (security_invoker = true)';
  END IF;
END
$$;

-- The view must not be readable by clients — audit_events is operator-only.
REVOKE ALL ON public.audit_events_recent FROM PUBLIC, anon, authenticated;

-- The service-role ops path (/internal/economy/ops/audit) still reads it.
GRANT SELECT ON public.audit_events_recent TO service_role;


-- =============================================================================
-- Verification (run manually as an operator; no real user ids / secrets)
-- =============================================================================
-- a) EXECUTE grants for the function — expect service_role only (no anon /
--    authenticated / PUBLIC):
--      SELECT grantee, privilege_type
--      FROM information_schema.role_routine_grants
--      WHERE routine_schema = 'public'
--        AND routine_name = 'economy_apply_ledger_entry';
--
-- b) Function identity + SECURITY DEFINER + owner:
--      SELECT p.proname,
--             pg_get_function_identity_arguments(p.oid) AS args,
--             pg_get_userbyid(p.proowner)               AS owner,
--             p.prosecdef                               AS security_definer
--      FROM pg_proc p
--      JOIN pg_namespace n ON n.oid = p.pronamespace
--      WHERE n.nspname = 'public'
--        AND p.proname = 'economy_apply_ledger_entry';
--
-- c) SELECT grants for the view — expect service_role only:
--      SELECT grantee, privilege_type
--      FROM information_schema.role_table_grants
--      WHERE table_schema = 'public'
--        AND table_name = 'audit_events_recent';
--
-- d) View security options — expect reloptions to include security_invoker=true
--    (PG15+):
--      SELECT relname, reloptions
--      FROM pg_class
--      WHERE relname = 'audit_events_recent';
--
-- Negative examples (comments only — must FAIL for a non-service-role client):
--   -- as anon / authenticated, direct RPC call → permission denied (42501):
--   --   SELECT public.economy_apply_ledger_entry(
--   --     '00000000-0000-0000-0000-000000000000'::uuid,
--   --     '00000000-0000-0000-0000-000000000000'::uuid,
--   --     'manual_adjustment','credit', 100, 'available', 'k', NULL, NULL, '{}'::jsonb);
--   -- as anon / authenticated, direct view read → permission denied:
--   --   SELECT * FROM public.audit_events_recent;
-- =============================================================================
