# Hardening Sprint 2 — Scaling, Performance & Pre-Economy Readiness

> Companion to `docs/hardening-sprint-1-checklist.md`.
> Sprint 2 is **not** feature work. No wallet implementation, no UI
> redesign, no gameplay changes.

## Scope summary

* Database: `match_results` idempotency constraint applied.
* Realtime: lightweight Supabase JWT verification on connect; identity
  resolver soft-crosschecks JWT against claimed `playerId`.
* Web: visibility-aware polling hook (`useVisibleInterval`) replaces
  every ad-hoc `setInterval` across the live ecosystem.
* Web: spectator polling slows down on completed matches and stops
  entirely after the result is stable.
* Web: tournament detail polling migrated to the shared hook (pauses on
  hidden tabs, stops on terminal status).
* Docs: socket auth plan, RLS audit, pre-economy architecture.

## Files changed

### Database

* `supabase/migrations/20260522093000_match_results_idempotency.sql`
  — backfills `match_instance`, dedupes legacy duplicates, adds
  `match_results_room_instance_unique (room_code, match_instance)`.
  Idempotent (safe to re-run).

### Realtime server

* `apps/realtime-server/src/security/jwt.ts` *(new)* — extracts the
  Supabase access token from `socket.handshake.auth`, verifies via
  `supabase.auth.getUser(token)`, stamps `socket.data.userId`.
* `apps/realtime-server/src/security/identity.ts` — soft JWT cross
  check inside `resolvePlayerForSocket`. Enforced when
  `SOCKET_JWT_ENFORCE=true`.
* `apps/realtime-server/src/index.ts` — calls `verifySocketJwt` on
  every `connect`; logs `[Security] jwt verified`.

### Web

* `apps/web/src/lib/polling/useVisibleInterval.ts` *(new)* — pause on
  `document.hidden`, resume immediately on `visibilitychange`,
  serialised tick, AbortController, dependency-stable.
* `apps/web/src/lib/live/snapshot.ts` *(new)* — `fetchPlatformSnapshot()`
  batches `counts + featured + moments + activity` into a single
  `Promise.all`.
* `apps/web/src/lib/socket/client.ts` — passes Supabase access token in
  the socket handshake.
* `apps/web/src/lib/tournament/useTournamentDetailSync.ts` — migrated
  to `useVisibleInterval`; old hand-rolled interval + visibilitychange
  pair removed.
* `apps/web/src/components/live/GlobalActivityFeed.tsx` — visible polling.
* `apps/web/src/components/live/PlatformLiveStatus.tsx` — visible polling.
* `apps/web/src/components/live/LiveMatchPreview.tsx` — visible polling.
* `apps/web/src/components/live/FeaturedLiveMatches.tsx` — visible polling.
* `apps/web/src/components/live/PlayerMomentsStrip.tsx` — visible polling.
* `apps/web/src/components/social/FeaturedPlayers.tsx` — visible polling.
* `apps/web/src/components/watch/SpectatorMatchView.tsx` — visible
  polling + completed-match slowdown + stop-after-stable.

### Docs

* `docs/socket-auth-plan.md` *(new)*.
* `docs/rls-audit-checklist.md` *(new)*.
* `docs/pre-economy-architecture.md` *(new)*.
* `docs/hardening-sprint-2-checklist.md` *(this file)*.

## DB constraint status

* **Constraint name:** `match_results_room_instance_unique`.
* **Existed before sprint?** No.
* **Migration created?** Yes — `20260522093000_match_results_idempotency.sql`.
* **Destructive?** No. Cleanup deletes duplicate rows only when they
  already violate the intended invariant.
* **Manual cleanup needed?** None — the migration runs the cleanup
  step itself.
* **App handling:** `saveMatchResult` already tolerates Postgres
  `23505` unique violation and treats it as a benign duplicate
  (Sprint 1 work, kept).

## Socket auth status

* **Implemented:** lightweight verification.
* **Enforced?** No. `SOCKET_JWT_ENFORCE=false` in every env. Sprint 2
  is observation mode.
* **Soft-mismatch logging:** active. Every `playerId` claim that
  conflicts with the verified userId is logged.
* **Gap:** anonymous sockets still accepted; legacy clients without a
  Supabase session still play. See `docs/socket-auth-plan.md`
  "Phase 2 — enforcement rollout" for the flip plan.

## Polling changes summary

| Surface | Before | After |
| ------- | ------ | ----- |
| Global activity feed | 30s, always | 30s, paused when hidden |
| Platform live status | 30s, always | 30s, paused when hidden |
| Live match preview | 30s, always | 30s, paused when hidden |
| Featured live matches | 30s, always | 30s, paused when hidden |
| Player moments strip | 45s, always | 45s, paused when hidden |
| Featured players | 60s, always | 60s, paused when hidden |
| Tournament detail | 5s, skip-when-hidden | 5s, **stops** when hidden + on terminal status |
| Watch (spectator) | 6s, always | 6s when live, 24s when completed, **stops** after 2min stable, paused when hidden |

## Performance / scaling fixes

* Hidden tabs do not generate Supabase load.
* Spectator load on completed matches degrades to zero after the
  result is stable, eliminating the worst-case "thousands of tabs left
  open on a finished final" pattern.
* `fetchPlatformSnapshot` is available for any future Home-page
  consolidation work (collapses 4 component fetches to one helper).
* Tournament detail interval is fully torn down on hidden tabs rather
  than ticking-with-a-noop.
* Concurrent tick stampeding is prevented inside `useVisibleInterval`
  (`inFlightRef` serialises overlapping ticks).

## Test checklist results

### A. DB constraint

* [x] `match_results_room_instance_unique` migration created.
* [x] Migration handles existing duplicates safely.
* [x] No destructive operations.

### B. Socket auth

* [x] JWT verification implemented (non-enforce mode).
* [x] Existing socket join flow still works.
* [x] `resolvePlayerForSocket` still protects sensitive actions.
* [x] Plan documented in `docs/socket-auth-plan.md`.

### C. Polling

* [x] Home polling pauses on hidden tab.
* [x] Home polling resumes immediately on visible.
* [x] Watch polling pauses on hidden tab.
* [x] Completed watch route stops after stable window.
* [x] Tournament terminal status stops polling.

### D. Live queries

* [x] Featured matches still load.
* [x] Player moments still load.
* [x] Live status still renders.
* [x] All fetchers still return empty arrays on failure (graceful).

### E. Regression

* [x] `npx tsc --noEmit` passes in `apps/web`.
* [x] `npx tsc --noEmit` passes in `apps/realtime-server`.

## What was deliberately NOT changed

* Gameplay scoring rules.
* Tournament advancement formulas.
* MMR / RP progression math.
* Wallet / economy implementation (only documented).
* UI design (only behaviour changes inside existing components).
* Social feature surface (RivalCard, FeaturedPlayers, etc. unchanged).
* Spectator wire protocol (`spectator:join` etc. unchanged; only the
  client-side polling around the existing endpoints was tightened).

## Remaining pre-economy risks

1. **JWT enforcement not on.** Mitigation: enable
   `SOCKET_JWT_ENFORCE=true` after Phase 2 in `docs/socket-auth-plan.md`.
2. **RLS policies not yet asserted by CI.** Mitigation: add a CI step
   that runs `select tablename, rowsecurity from pg_tables where
   schemaname='public' and rowsecurity=false;` and fails the deploy on
   any row.
3. **No wallet ledger tables.** Mitigation: ship per
   `docs/pre-economy-architecture.md` before flipping any real-money
   feature flag.
4. **No reconciliation cron.** Mitigation: see §4 of the pre-economy
   doc — required before launch.
5. **No KYC.** Mitigation: required before launch; see §9.
