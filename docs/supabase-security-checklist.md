# Supabase Security Checklist

> Hardening Sprint 3 — project posture in Supabase Studio.

## Project setup

- [ ] **Production project** is clearly labelled in Supabase Studio
      (`Settings → General → Project name`).
- [ ] **Staging project** spun up. Required before flipping
      `ECONOMY_REAL_MONEY_ENABLED=true` (see
      `docs/pre-real-money-checklist.md`).
- [ ] Project owners use 2FA. The Supabase access token used by CI / local
      scripts is a personal access token with the minimum scope.
- [ ] Free-plan limitations acknowledged:
      * No daily backups by default.
      * 7-day point-in-time-recovery requires Pro plan or above.
      * No log retention beyond 1 day on free.
      Document upgrade plan before real money.

## Database & RLS

- [ ] RLS enabled on every table listed in `docs/database-security.md`.
- [ ] Migration `20260523080000_rls_security_hardening.sql` applied.
- [ ] Verification SQL from `docs/database-security.md` passes (sections
      1, 3, 4, 5, 6).
- [ ] No table policy has `qual = 'true'` for INSERT/UPDATE/DELETE on a
      sensitive table.
- [ ] `wallet_ledger_entries` is verified APPEND-ONLY: clients have no
      INSERT or UPDATE; the only writer is the
      `economy_apply_ledger_entry` SECURITY DEFINER RPC (service role).
- [ ] `settlement_events` and `audit_events` have ZERO client-visible
      policies.

## API keys

- [ ] `anon` key — used in browser. Public exposure is expected.
- [ ] `service_role` key — server-only. Verified absent from any
      `NEXT_PUBLIC_*` env var. Rotated immediately if it appears in git.
- [ ] After Sprint 3, the previously-leaked service-role key (committed
      to `apps/realtime-server/.env`) **MUST be rotated** in
      `Settings → API → Reset service_role key`.
- [ ] Old service-role JWTs invalidated.
- [ ] Re-deploy `apps/realtime-server` and any web server context with
      the new key.

## Auth

- [ ] Email + password auth: passwords minimum 8 chars, breached-password
      protection enabled.
- [ ] OAuth providers reviewed; only ones in active use are enabled.
- [ ] JWT signing key rotation cadence documented.
- [ ] `auth.users` not directly readable from client (default — confirmed).
- [ ] Email rate-limiting on signup / password reset is at default or
      stricter.

## Storage

- [ ] No public buckets exist unless intentionally public (avatars, etc.).
- [ ] Service-role-only buckets used for any economy artefact (none exist
      today; reserved for KYC documents in a future phase).

## Realtime channels

- [ ] No public Realtime broadcasts of economy data. Today the realtime
      tier is reserved for socket.io game state; Supabase Realtime
      subscriptions are not used by economy code.
- [ ] If we ever add `supabase.channel()` consumers to the browser, every
      such channel must respect the same RLS rules as the underlying
      table.

## Logs & observability

- [ ] Postgres logs reviewed weekly for `permission denied` spikes —
      they indicate either a misconfigured frontend query or an attempted
      RLS bypass.
- [ ] Audit events from `audit_events` (Phase 12) are pulled into the
      ops dashboard before real money. Severity=critical events page on
      call.

## Backups

- [ ] Daily automated backups configured (Pro plan).
- [ ] Restore drill executed at least once before real money.
- [ ] Off-site copy of the latest backup retained.

## Dev / staging boundary

- [ ] Service-role key for production NEVER used in local dev.
- [ ] Local dev points at a separate Supabase project (or `supabase
      start` local stack).
- [ ] Test data seeding script (`apps/web/scripts/cancelStaleTournaments.ts`
      and friends) only runs against staging.

## Pre-real-money blocker

- [ ] All boxes above checked.
- [ ] `apps/realtime-server` startup `economyLaunchBlockers()` returns
      `[]` (Phase 12 enforcement).
- [ ] Reconciliation pass returns zero failures and zero
      `flaggedManualReview` rows.
