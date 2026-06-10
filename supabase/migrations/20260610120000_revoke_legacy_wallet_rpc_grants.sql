-- =============================================================================
-- Phase 8B beta lock — revoke public exposure of legacy wallet stake RPCs
-- =============================================================================
-- Background:
--   public.lock_wallet_stake(uuid, integer), public.unlock_wallet_stake
--   (uuid, integer), and public.settle_wallet_stakes(uuid, uuid, integer)
--   exist live in this project as out-of-band drift — they were never
--   created by a tracked migration. They are SECURITY DEFINER, mutate
--   public.wallets.balance / locked_balance directly, and (per a
--   read-only Supabase audit) are currently EXECUTE-granted to PUBLIC,
--   anon, and authenticated, in addition to service_role.
--
--   None of the three functions verify auth.uid() against the supplied
--   user id(s). With anon/authenticated EXECUTE access, any client can
--   call them directly via PostgREST (e.g. POST /rest/v1/rpc/
--   settle_wallet_stakes) to move balances between arbitrary wallets,
--   bypassing the realtime server's match-settlement logic entirely.
--
-- Beta policy:
--   No wallet-mutating RPC may be reachable by anon or authenticated
--   clients. apps/realtime-server is the only caller of these RPCs and
--   it always uses the service-role Supabase client (see
--   apps/realtime-server/src/config.ts), so revoking PUBLIC/anon/
--   authenticated EXECUTE here does not change any application
--   behaviour — only closes the direct-RPC abuse path.
--
-- This migration intentionally does NOT drop these functions or alter
-- their bodies; it only tightens grants. Retiring them in favour of
-- economy_apply_ledger_entry is tracked separately.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.lock_wallet_stake(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unlock_wallet_stake(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_wallet_stakes(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lock_wallet_stake(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_wallet_stake(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_wallet_stakes(uuid, uuid, integer) TO service_role;
