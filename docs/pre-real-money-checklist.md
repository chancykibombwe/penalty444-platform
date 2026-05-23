# Pre-Real-Money Launch Checklist

> Phase 12 — every box on this page MUST be ticked before
> `ECONOMY_REAL_MONEY_ENABLED` can flip to `true`.

The realtime server already enforces the JWT blocker at startup
(`apps/realtime-server/src/index.ts → economyLaunchBlockers`) — it
refuses to bind the port when real money is enabled without JWT
enforcement. The rest of these blockers are organisational and require
the operator to confirm.

## Hard blockers

### Security

- [ ] `SOCKET_JWT_ENFORCE=true` in production env. (Server fails closed
      without it, per Phase 12 TASK 10.) Roll out per the staged plan
      in `docs/socket-auth-plan.md` § Phase 2.
- [ ] Every socket event handler that mutates state checks
      `socket.data.userId === claimedPlayerId` and rejects on mismatch.
- [ ] `player:register` and `tournament:subscribe` reject anonymous
      sockets in enforce mode (Sprint 5 TASK 7).
- [ ] All `/internal/*` endpoints require `x-realtime-internal-secret`.
      Audit: `rg "isAuthorizedInternalRequest" apps/realtime-server`.
- [ ] No browser-facing route writes to `wallets`,
      `wallet_ledger_entries`, `escrow_locks`, `settlement_events`, or
      `audit_events`. RLS verified per `docs/rls-audit-checklist.md`.
- [ ] **Realtime CORS is allow-listed (Sprint 5 TASK 3).**
      Production `ALLOWED_ORIGINS` env contains every legitimate
      browser origin. Empty `ALLOWED_ORIGINS` in production is a
      startup-fatal condition.
- [ ] **Web security headers shipped (Sprint 5 TASK 5).** Verify with
      `curl -I https://<host>/` — `X-Frame-Options`, `X-Content-Type-Options`,
      `Referrer-Policy`, `Permissions-Policy`, and (in prod)
      `Strict-Transport-Security` are all present.
- [ ] CSP rolled out per `docs/security/runtime-security.md` § 3.
      Soft blocker — does not gate real money but should land before
      public launch.
- [ ] Dependency audit clean to the baseline documented in
      `docs/security/npm-audit-report.md`. No new high-severity
      vulnerabilities outstanding.
- [ ] Env validation passes at boot (Sprint 5 TASK 8): every fatal
      env in production is `present`.

### Economy correctness

- [ ] Phase 12 reconciliation worker scheduled (cron / interval). The
      worker is **off by default**; flip
      `ECONOMY_RECONCILIATION_ENABLED=true` AND wire a periodic call to
      `POST /internal/economy/reconcile`.
- [ ] Phase 12 settlement retry worker has been exercised in staging
      against deliberately-injected stuck `processing` rows.
- [ ] Tournament prize payout is **implemented**. Today
      `settleTournamentEconomy` refuses to complete when
      `prize_pool_minor > 0` and writes `requires_payout`. That guard
      cannot be removed until a real payout pipeline exists.
- [ ] Tournament cancellation refund fanout has been exercised end-to-end
      and audited (`POST /internal/economy/tournament/refund-fanout`).
- [ ] Legacy stakes migration plan executed at least through Step 3
      (see `docs/legacy-stakes-migration.md`).
- [ ] Wallet consistency reconciliation has run for ≥ 24h without
      detecting drift on a sample size of 200 wallets.
- [ ] `MAX_LEDGER_AMOUNT_MINOR` cap is set conservatively. Current
      default lives in `apps/realtime-server/src/economy/config.ts`.

### Operations

- [ ] Production database backup plan in place (Pro plan daily backups +
      off-site copy). Free Supabase plan is NOT sufficient.
- [ ] Staging Supabase project exists and mirrors production schema.
- [ ] Branch protection enabled on `master`: required PR review,
      required status checks (`tsc` for both apps), no force pushes.
- [ ] Dependency vulnerability review: `npm audit --omit=dev` passes
      on both `apps/web` and `apps/realtime-server`. Any unfixable
      criticals documented and accepted.
- [ ] Legacy wallet schema reconciled: the legacy `public.wallets` table
      with `(balance, locked_balance, total_winnings)` columns has been
      either renamed, dropped, or migrated into the Phase 10 schema
      (`available_balance_minor`, `locked_balance_minor`). Tracked by
      the Phase 10 migration push being clean (no `column does not
      exist` errors).
- [ ] Reconciliation scheduler active (cron / interval calling
      `POST /internal/economy/reconcile`).
- [ ] Pager / on-call channel routed for `severity=critical` audit
      events (`settlement.manual_review_required`,
      `escrow.manual_review_required`, `wallet.balance_drift_detected`).
- [ ] Admin tooling can:
  * Read a wallet snapshot for any user.
  * Read the ledger entries for any user.
  * Force-refund a `manual_review` escrow with a service-role write.
  * Mark a `manual_review` settlement as `processing` to re-enter the
    pipeline.
- [ ] Runbook entry for "stuck settlement / orphan escrow".

### Payments (not in scope for Phase 12)

- [ ] Payment provider selected (Mobile Money, card, crypto, etc.).
- [ ] Deposit endpoint + KYC pipeline designed.
- [ ] Withdrawal review queue + AML thresholds designed.
- [ ] Per-user daily / weekly velocity limits.
- [ ] Chargeback / dispute handling.
- [ ] Fraud signal feed (device fingerprint, IP reputation, ...).

### Legal / compliance (not in scope for Phase 12)

- [ ] Terms of service updated with money-handling language.
- [ ] Jurisdiction analysis (skill-game vs. gambling).
- [ ] Tax / 1099-equivalent reporting pipeline.
- [ ] Age verification on signup.
- [ ] Self-exclusion / responsible gaming controls.

## Soft blockers (high-priority follow-ups)

- [ ] Anomaly detection job: alert on > N refunds / hour per user, on
      balance drift, on settlement velocity spikes. Tracked in
      `docs/anomaly-detection.md` (TBD Phase 13).
- [ ] Backups / point-in-time-recovery verified for the ledger table.
- [ ] Database CI ensures every economy table has RLS enabled (planned
      via a `pg_class` check in CI).
- [ ] Per-currency rake configuration is data-driven, not hard-coded.

## Verification

Before flipping `ECONOMY_REAL_MONEY_ENABLED=true`:

1. `curl -H 'x-realtime-internal-secret: …' /internal/economy/health` →
   `blockers: []`.
2. `POST /internal/economy/reconcile` → no failures.
3. `/internal/economy/escrows/stuck` → empty or only known
   `manual_review` rows.
4. `/internal/economy/settlements/stuck` → empty or only known
   `manual_review` rows.
5. Cross-check ledger sum vs. wallet balance for a 200-wallet sample;
   zero drift.

If any of the above is non-empty, **do not flip the flag**.
