# Supabase RLS Audit Checklist

> Hardening Sprint 2 — TASK 9.
> Companion to `docs/hardening-sprint-1-checklist.md` (DB constraints).
> Owner: platform team.

## Goal

Document the **required** RLS posture for every table the web client
touches, so that:

1. Client tampering cannot mutate platform-critical state.
2. The realtime server (service role) remains the single authority for
   gameplay outcomes, tournament advancement, and future wallet ledger
   entries.
3. New tables added in future sprints inherit a predictable baseline
   (default-deny, explicit policies).

## Audit format

Each table answers four questions and lists residual risks:

* **Client read?** — what an anon/authed client can SELECT.
* **Client insert?** — what they may INSERT.
* **Client update?** — what they may UPDATE.
* **Service role only?** — operations that must go through the realtime
  server / edge functions.

---

## `player_stats`

| Op     | Allowed? | Policy summary |
| ------ | -------- | -------------- |
| SELECT | Yes      | Public read (leaderboards, profiles). |
| INSERT | No       | Service role only. Bootstrapped by realtime server on first match. |
| UPDATE | No       | Service role only. All RP/MMR mutations happen in `applyPlayerProgressionFromMatch`. |

Risks if misconfigured:

* If client UPDATE is allowed, RP/MMR can be self-inflated.
* If client INSERT is allowed, sybil rows can pollute the leaderboard.

Required RLS policies:

```sql
ALTER TABLE public.player_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY player_stats_public_read ON public.player_stats
  FOR SELECT USING (true);

-- No INSERT / UPDATE / DELETE policies → service role bypass only.
```

---

## `match_results`

| Op     | Allowed? | Policy summary |
| ------ | -------- | -------------- |
| SELECT | Yes      | Public read (history, profiles, head-to-head). |
| INSERT | No       | Service role only (`saveMatchResult` in realtime server). |
| UPDATE | No       | Immutable after insert. Service role only. |
| DELETE | No       | Service role only (manual cleanup). |

Risks if misconfigured:

* Client INSERT → fabricated wins / RP injection.
* Client UPDATE → score rewrites.

Required RLS:

```sql
ALTER TABLE public.match_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_results_public_read ON public.match_results
  FOR SELECT USING (true);
```

Pair with `match_results_room_instance_unique` constraint
(Sprint 2 migration `20260522093000_match_results_idempotency.sql`).

---

## `tournaments`

| Op     | Allowed? | Policy summary |
| ------ | -------- | -------------- |
| SELECT | Yes      | Public read. |
| INSERT | Limited  | Authed user may create draft tournaments where `created_by = auth.uid()`. |
| UPDATE | Limited  | Owner may edit draft state only; realtime server promotes lifecycle (`registration → in_progress → completed`). |
| DELETE | No       | Service role only. |

Required RLS:

```sql
ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tournaments_public_read ON public.tournaments
  FOR SELECT USING (true);

CREATE POLICY tournaments_owner_insert ON public.tournaments
  FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY tournaments_owner_update_draft ON public.tournaments
  FOR UPDATE USING (
    auth.uid() = created_by AND status = 'draft'
  );
```

Risks if misconfigured:

* Wide UPDATE → arbitrary winner_id rewrites.
* Wide DELETE → tournament history loss.

---

## `tournament_entries`

| Op     | Allowed? | Policy summary |
| ------ | -------- | -------------- |
| SELECT | Yes      | Public read for bracket UI. |
| INSERT | Limited  | Authed user may register themselves: `user_id = auth.uid()` AND parent tournament status in (`draft`,`registration`,`check_in`). |
| UPDATE | Limited  | Self-only updates for `checked_in_at`. All other fields service-role. |
| DELETE | Limited  | Self-only **before** check_in close; otherwise service role. |

Required RLS sketch:

```sql
ALTER TABLE public.tournament_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY tournament_entries_public_read ON public.tournament_entries
  FOR SELECT USING (true);

CREATE POLICY tournament_entries_self_insert ON public.tournament_entries
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
  );

CREATE POLICY tournament_entries_self_checkin ON public.tournament_entries
  FOR UPDATE USING (auth.uid() = user_id);
```

Risks if misconfigured:

* Wide UPDATE → seed manipulation, eliminating opponents.
* Allowing INSERT for other user_id → impersonation.

---

## `tournament_matches`

| Op     | Allowed? | Policy summary |
| ------ | -------- | -------------- |
| SELECT | Yes      | Public read. |
| INSERT | No       | Service role only (realtime server creates bracket). |
| UPDATE | No       | Service role only (`advanceTournamentFromRoom`). |
| DELETE | No       | Service role only. |

Required RLS:

```sql
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY tournament_matches_public_read ON public.tournament_matches
  FOR SELECT USING (true);
```

Risks if misconfigured:

* **Critical**: client UPDATE → bracket rewriting, fake winners,
  double-advancement (already mitigated in code with
  `room.bracketAdvanced` + winner conflict checks, but RLS is the
  defence in depth layer).

---

## Future wallet / economy tables

These tables **do not exist yet** but their RLS posture must be locked
in before the first row is written. See `docs/pre-economy-architecture.md`
for schema. Baseline:

| Table | Client read | Client insert | Client update |
| ----- | ----------- | ------------- | ------------- |
| `wallet_balances` | Self-only | No | No |
| `wallet_ledger` | Self-only | No | No |
| `match_escrow` | No | No | No |
| `tournament_escrow` | No | No | No |
| `payout_requests` | Self-only | Self-only | No |
| `audit_events` | No | No | No |

Implementation sketch:

```sql
ALTER TABLE public.wallet_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_balances_self_read ON public.wallet_balances
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY wallet_ledger_self_read ON public.wallet_ledger
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.match_escrow ENABLE ROW LEVEL SECURITY;
-- No client policies → service role bypass only.
```

Risks if misconfigured:

* Any client write to ledger / escrow tables is a **direct money-loss
  exploit**. Wallet tables must default-deny and **only** be mutated
  via service-role-signed RPCs.

---

## Operational checklist before every release

* [ ] No new table ships without an `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`.
* [ ] Every public-read policy is justified in this doc.
* [ ] Every INSERT/UPDATE policy is gated on `auth.uid() = ...` or
      service role.
* [ ] CI runs `select schemaname, tablename, rowsecurity from pg_tables`
      and fails the deploy if any `public.*` table has `rowsecurity = false`.
* [ ] Service-role keys never leak to the browser bundle.
