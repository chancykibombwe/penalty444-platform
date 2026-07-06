# Post-Hardening Beta Verification Checklist

> Documentation only. This file adds no code, migrations, or config. It is an
> operator checklist to run against **production** after the blocker-class audit
> fixes were merged, before inviting more controlled wider-beta testers.
> Contains **no secrets and no real user IDs** — the SQL snippets return only
> schema/grant metadata.

---

## 1. Purpose

This checklist verifies that the merged hardening PRs are actually live and
correct **in production** — Vercel, Railway, and Supabase — and that core
beta flows (login, match, persistence, reconnect, feedback, wallet-safe,
Home UI) still behave. It is the gate between "hardening merged" and
"invite more testers." It complements, and should be run alongside,
`docs/deployment-runbook-production-safety.md` (the env-gate runbook) — this
document adds the *post-fix* verification specific to PRs #178–#182.

Scope reminder for the beta being verified: **Controlled wider beta · Free
Play only · Wallet Coming Soon / read-only · not a public launch · not a
real-money launch.**

---

## 2. Merged hardening PRs

- **#178** — Deployment Runbook & Production Safety Gates (docs)
- **#179** — Realtime Production JWT Guard & Socket Binding Hardening
- **#180** — Tournament RLS Write Guard Hardening (migration)
- **#181** — Supabase Grant & View Exposure Hardening (migration)
- **#182** — Match Result Room-Code Idempotency Hardening (realtime + migration)

Migration timestamps to look for (Supabase migration history):
`20260705120000` (#180), `20260705130000` (#181), `20260705140000` (#182).

---

## 3. Deployment verification

- [ ] Vercel: latest **production** deployment is `Ready` (no build/runtime error).
- [ ] Railway: latest realtime-server deployment is running (booted cleanly).
- [ ] Railway was **redeployed after PR #179 and PR #182** merged (deploy commit ≥ those merges).
- [ ] Railway shows **no crash loop** (no repeated restart in the deploy/logs view).
- [ ] Railway logs show **no fatal env error** — in particular no `[boot] FATAL: SOCKET_JWT_ENFORCE must be true in production` (from #179's guard).
- [ ] Railway logs do **not** show repeated match-result persistence failures — no recurring `Failed to save match result` and no repeating `reason=match_instance_id_column_missing_retry_legacy` (a persistent fallback log means the #182 migration is not applied yet — see §4).

---

## 4. Supabase migration verification

- [ ] Migration `20260705120000` (#180) applied.
- [ ] Migration `20260705130000` (#181) applied.
- [ ] Migration `20260705140000` (#182) applied.
- [ ] `tournament_entries_protect_server_fields_trigger` exists (#180).
- [ ] `tournaments_protect_insert_fields_trigger` exists (#180).
- [ ] `beta_feedback_force_open_status_trigger` exists (#180).
- [ ] `economy_apply_ledger_entry` EXECUTE revoked from `anon`/`authenticated` (#181).
- [ ] `audit_events_recent` not selectable by `anon`/`authenticated` (#181).
- [ ] `match_results.match_instance_id` column exists (#182).
- [ ] `match_results_instance_id_unique` constraint exists (#182).
- [ ] `match_results_room_instance_unique` constraint removed (#182).

**Operator SQL — trigger existence** (expect all three rows):
```sql
SELECT tgname, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname IN (
  'tournament_entries_protect_server_fields_trigger',
  'tournaments_protect_insert_fields_trigger',
  'beta_feedback_force_open_status_trigger'
);
```

**Operator SQL — function execute grants** (expect `service_role` only; no `anon`/`authenticated`/`PUBLIC`):
```sql
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_schema = 'public'
  AND routine_name = 'economy_apply_ledger_entry';
```

**Operator SQL — view select grants** (expect `service_role` only) + invoker option:
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'audit_events_recent';

SELECT relname, reloptions
FROM pg_class
WHERE relname = 'audit_events_recent';   -- reloptions should include security_invoker=true (PG15+)
```

**Operator SQL — match_results column + constraints:**
```sql
-- Column present + NOT NULL + default:
SELECT column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'match_results'
  AND column_name = 'match_instance_id';

-- New constraint present, old one gone (expect only the *_instance_id_unique row):
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.match_results'::regclass
  AND conname IN ('match_results_instance_id_unique',
                  'match_results_room_instance_unique');
```

---

## 5. Production env gate verification

- [ ] Railway `NODE_ENV=production`.
- [ ] Railway `SOCKET_JWT_ENFORCE=true`.
- [ ] Railway `ALLOWED_ORIGINS` includes the production Vercel domain (and is not empty).
- [ ] Economy flags disabled: `ECONOMY_ENABLED=false`, `ECONOMY_TEST_MODE=false`, `ECONOMY_REAL_MONEY_ENABLED=false`, `ECONOMY_RECONCILIATION_ENABLED=false`.
- [ ] Vercel `NEXT_PUBLIC_ECONOMY_MODE=off`.
- [ ] Service-role keys are **not** exposed as any `NEXT_PUBLIC_*` variable (`SUPABASE_SERVICE_ROLE_KEY` server-side only).
- [ ] `ADMIN_EMAILS` stays server-side only (no `NEXT_PUBLIC_ADMIN_EMAILS`).

(Full env matrix + where-to-check lives in `docs/deployment-runbook-production-safety.md`.)

---

## 6. Gameplay smoke test

- [ ] Tester A signs in.
- [ ] Tester B signs in.
- [ ] Tester A creates a private room.
- [ ] Tester B joins with the room code.
- [ ] Both players can pick lanes (LEFT / CENTER / RIGHT).
- [ ] Reveal works.
- [ ] Score updates.
- [ ] Match ends.
- [ ] End screen appears.
- [ ] Feedback link is reachable from the match-end screen.
- [ ] No freeze during match end.

---

## 7. Match result persistence check

- [ ] One completed match creates exactly **one** `match_results` row.
- [ ] The row has `match_instance_id` populated.
- [ ] A duplicate persistence attempt does **not** create a duplicate row.
- [ ] Logs show `reason=inserted` for the normal save (from #182).
- [ ] A duplicate save, if observed, logs `reason=idempotent_existing` or `reason=skipped_in_memory` (from #182).
- [ ] Account "recent matches" still load.
- [ ] Leaderboard / player stats still load.

**Operator SQL — spot-check the latest rows (schema/counts only, no PII beyond usernames the app already shows):**
```sql
SELECT room_code, match_instance, match_instance_id, created_at
FROM public.match_results
ORDER BY created_at DESC
LIMIT 5;

-- Confirm no duplicate ids and none missing:
SELECT count(*) AS total,
       count(match_instance_id) AS non_null,
       count(DISTINCT match_instance_id) AS distinct_ids
FROM public.match_results;   -- expect total = non_null = distinct_ids
```

---

## 8. Reconnect / disconnect check

- [ ] A player refreshes mid-match.
- [ ] The 39-second reconnect UI appears.
- [ ] The player reconnects before the timeout.
- [ ] The match continues correctly after reconnect.
- [ ] If the timeout expires instead, the forfeit / end state behaves safely (opponent credited, clean end screen).
- [ ] No duplicate `match_results` row is produced by the reconnect path (verify via §7 SQL — still one row, one `match_instance_id`).

---

## 9. Feedback check

- [ ] Account feedback panel submits successfully.
- [ ] Match-end feedback shortcut works and reaches the feedback surface.
- [ ] A new `beta_feedback` row starts with `status = 'open'`.
- [ ] A normal client flow cannot create feedback as `resolved` / `triaged` / `wont_fix` (blocked by #180's `beta_feedback_force_open_status_trigger`).

**Operator SQL — recent feedback statuses (expect all `open` from client inserts):**
```sql
SELECT status, count(*)
FROM public.beta_feedback
GROUP BY status
ORDER BY status;
```

---

## 10. Wallet / economy safety check

- [ ] Wallet remains Coming Soon / read-only.
- [ ] No deposit action available.
- [ ] No withdrawal action available.
- [ ] No paid match creation (all rooms Free).
- [ ] No cash-prize wording.
- [ ] No prize-pool wording.
- [ ] No "Invite & Earn" wording.
- [ ] Economy remains off (flags per §5; `NEXT_PUBLIC_ECONOMY_MODE=off`).

---

## 11. Home UI check

- [ ] Home desktop loads at **1280px**.
- [ ] Home desktop loads at **1440px**.
- [ ] Home mobile loads at **360px**.
- [ ] Home mobile loads at **390px**.
- [ ] No horizontal overflow at any of the above.
- [ ] The hero visual from PR #177 does **not** block or overlap the CTA.
- [ ] **PLAY FREE** still opens the lobby flow.
- [ ] Future games remain Coming Soon / disabled (no dead links).
- [ ] Wallet remains "Soon" / "Coming Soon".

> Note: PR #177 (Home V2 Hero) is a separate, independently-reviewed change.
> If it is not yet merged to production, verify the current live hero instead
> and mark the "#177 hero" line N/A.

---

## 12. Stop conditions

Halt the invite (or roll back — see §13) if **any** of these is observed:

- Cannot log in.
- Lobby does not load.
- Players cannot create / join rooms.
- Players cannot pick lanes.
- A match result is not saved.
- `match_results` insert errors repeat in Railway logs.
- Stats / leaderboard break after a match.
- Wallet / economy appears active.
- Unsafe money wording appears.
- Admin / audit data is exposed to a normal user.
- Railway realtime server crash-loops.

---

## 13. Final beta decision

Record exactly one:

- **GREEN** — all checks pass → resume controlled wider beta (proceed with more invites).
- **YELLOW** — minor issues found → fix the listed items before more invites; re-run the affected sections.
- **RED** — a stop condition is present → pause beta and roll back the latest risky deployment (see the rollback plan in `docs/deployment-runbook-production-safety.md`).

---

## 14. Current status (fill in per run)

- Date checked: ______
- Checked by: ______
- Vercel status: ______
- Railway status: ______
- Supabase migration status: ______
- Match smoke result: ______
- Reconnect result: ______
- Feedback result: ______
- Wallet/economy safety result: ______
- Final decision (GREEN / YELLOW / RED): ______
