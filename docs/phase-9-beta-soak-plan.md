# Phase 9 — Beta Soak, Observability & Player Onboarding

**Status:** Planning (approved). No app code, schema, or economy changes are part of
this phase. This document is the operating plan for the beta soak that follows
the Phase 8B lock.

**Phase 8B status:** LOCKED.

**Current policy (carried into Phase 9, unchanged):**

- Free Play only
- Wallet read-only / "Coming soon"
- No deposits
- No withdrawals
- No paid/staked matches
- Quick Match = Ranked Free Match
- Private Rooms = Free only
- Public Offers = Free only (server-forced)
- Tournaments = Free Entry
- Tournaments = manual host start only
- `SOCKET_JWT_ENFORCE=true`
- Completed matches must not appear as Live
- Home must remain truthful

---

## 1. Phase 9 Overview

Phase 9 does **not** add product scope. It establishes:

- A repeatable **48–72h beta soak** procedure
- A **monitoring/logging** baseline operators can actually watch
- A **player support / incident checklist** for the most likely beta failure modes
- A **30-minute smoke test** to run before/after each soak and after any deploy
- A **first-time-user onboarding** pass on existing copy (mostly already good — one gap found)
- A short, **non-blocking hardening backlog** (config drift, logging gaps, a couple of
  small UX nits)

---

## 2. Monitoring / Logging Checklist

### 2.1 What already exists (good baseline)

| Category | Status | Example prefix |
|---|---|---|
| Auth/JWT rejections | Comprehensive, structured `key=value`, all under `[Security]` | `[Security] unauthenticated action blocked action=... socketId=...` |
| Public offer create/join lifecycle | Mostly covered (`diagLog` + structured) | `[publicOffer:hostGrace] GRACE_ARMED ...`, `publicOffer:matched sent` |
| Match result save / settlement | Structured, dedupe-aware | `[Settlement] result insert created roomCode=... instanceId=...` |
| Progression (player_stats / rank) | Structured, dedupe-aware | `[Progression] applied roomCode=... instanceId=... matchType=...` |
| Tournament advance/bracket | Very thorough, including race conditions | `[TournamentAdvance] applied {...}`, `[TournamentAdvance] winner conflict ...` |
| Rate limiting | Structured | `[Security] rate limit exceeded action=... limit=.../...ms` |

### 2.2 Gaps to close (recommended Phase 9 logging additions)

| Gap | Severity | Where | Recommendation |
|---|---|---|---|
| No success logs for ranked enqueue/cancel/matched | Medium | `socket/ranked.ts` | Add `[Ranked] enqueue playerId=... queueSize=...`, `[Ranked] cancel playerId=...`, `[Ranked] matched roomCode=... players=[a,b]` |
| No reconnect / forfeit-trigger logs | **High** | `gameplay/disconnectGrace.ts`, `socket/rooms.ts` | Add `[Disconnect] reconnect roomCode=... playerId=...` and `[Disconnect] forfeit_triggered roomCode=... playerId=... round=...`. This is the #1 thing operators need during a soak — "did this player actually disconnect, or did the server lose them?" |
| No public offer cancel success log | Medium | `socket/publicOffers.ts` | Add `[publicOffer:cancel] removed offerId=... playerId=...` |
| No rematch accept/decline/reset-complete logs | Medium | `socket/rematch.ts` | Add `[Rematch] accepted roomCode=...`, `[Rematch] declined roomCode=...`, `[Rematch] reset_complete roomCode=...` |
| `rooms.ts` lines ~258/540/611 — generic/unlabeled logs | Low | `socket/rooms.ts` | Give these a consistent `[Room]` prefix + roomCode for grep-ability |

### 2.3 What to actively watch during the soak

Suggested grep targets for log tailing:

- `[Security] unauthenticated action blocked` — spike = client/token bug, not
  necessarily an attack (see config note below)
- `[Security] .*jwt_player_mismatch` (non-soft, i.e. enforce-mode) — should be ~0
- `[Settlement] duplicate result skipped` — occasional is fine (idempotency
  working); frequent = client retry bug
- `Failed to save match result` — should be 0
- `[progression] .* failed` — should be 0
- `[tournament advance] .*failed|mismatch|conflict` — should be 0
- `[Economy] .* escrow lock failed` — should be 0 (economy is off, but log path
  still exists)

### 2.4 Config note carried over from Phase 8B verification

`SOCKET_JWT_ENFORCE=true` is policy for Phase 9, but the realtime-server's actual
runtime env var is what governs `requireAuthenticatedSocket`. **Before soak
starts**, confirm via the `/internal/economy/health` endpoint (or direct env
check) that `SOCKET_JWT_ENFORCE=on` is reported — this directly determines whether
"Anonymous ranked queue" rejections are real or no-ops.

---

## 3. 48–72 Hour Beta Soak Checklist

**Pre-soak (T-0):**

- [ ] Confirm `SOCKET_JWT_ENFORCE=on` via `/internal/economy/health`
- [ ] Confirm `ECONOMY_ENABLED=false`, `ECONOMY_REAL_MONEY_ENABLED=false`
- [ ] Run the 30-minute smoke test (Section 5) — must be 100% green before opening
      to beta users
- [ ] Start log tailing with the grep targets from 2.3
- [ ] Note current `match_results` row count and `player_stats` row count
      (baseline for sanity-checking growth rate)

**Every ~6–8 hours during soak:**

- [ ] Re-run the smoke test (or at least Quick Match + Private Room + one full match)
- [ ] Check for any `[Security]` enforce-mode rejections that aren't expected
      (real anonymous attempts)
- [ ] Check `[Disconnect] forfeit_triggered` count vs. actual reported disconnects
      (once added — see backlog)
- [ ] Spot-check 2–3 `match_results` rows against `player_stats` deltas to confirm
      progression applied correctly
- [ ] Check tournament cron: any tournaments stuck in `active` with no advancing
      matches?
- [ ] Check public offers list for stale/zombie offers (host disconnected, grace
      expired, offer not cleared)

**T+24h, T+48h, T+72h checkpoints:**

- [ ] Tally incidents using the operator checklist (Section 4) — categorize by type
- [ ] Review error rate trend (increasing = regression, flat/zero = healthy)
- [ ] Confirm no duplicate `match_results` rows for any `(room_code, match_instance)`
      pair
- [ ] Confirm no players stuck >10 min in an active match with no resolution

**End of soak:**

- [ ] Final smoke test pass
- [ ] Compile incident log + recommendations
- [ ] Decide go/no-go for Phase 9 hardening PRs vs. extending soak

---

## 4. Beta Incident Checklist (Operator Playbook)

For each incident type: **symptom → first checks → likely cause → mitigation**

### Player cannot join match

- Check: is `SOCKET_JWT_ENFORCE=on` and is the player's browser sending
  `accessToken`? (`[Security] unauthenticated action blocked` for their socketId)
- Check: rate limit hit? (`[Security] rate limit exceeded`)
- Check: is `getTrackedActiveRoom(playerId)` returning a stale room code (player
  thinks they're "already in a match")?
- Mitigation: ask player to refresh/re-login (forces fresh JWT); if stale
  active-room, this is the `activeRoom:clear` cosmetic path — safe to clear.

### Player stuck in active match

- Check: round timer logs (`[both-picks]`, disconnect-grace logs) — did the
  opponent disconnect without forfeit triggering?
- Check: `[Settlement]` logs for that roomCode — did the match already resolve
  server-side but the client didn't receive the event (socket drop)?
- Mitigation: if settlement already happened, advise refresh (client should
  re-sync from server state on reconnect). If genuinely stuck server-side, this
  is a P1 — capture roomCode + matchInstance for a follow-up bug.

### Tournament stuck

- Check: `[tournament advance]` logs for that tournamentId — look for `mismatch`,
  `conflict`, `slot missing`, `failed to load`
- Check: is the host expected to manually start (Phase 9 policy = manual start
  only) — is this just "waiting for host," not actually stuck?
- Mitigation: if a genuine bracket-advance failure, capture matchId +
  tournamentId; do not manually edit bracket rows without a migration-safe
  procedure.

### Match result not saved

- Check: `Failed to save match result` / `Supabase backend client is not
  configured` in logs for that roomCode
- Check: was a season active at the time? (`No active Penalty444 season found`)
- Mitigation: if Supabase was briefly unavailable, the match outcome may be lost
  — note for the player but do not attempt manual inserts without verifying
  idempotency keys.

### Duplicate result suspected

- Check: `[Settlement] duplicate result skipped (in-memory flag)` or `(db
  unique)` for that roomCode/instanceId — if present, the system correctly
  deduped; no action needed
- Check: query `match_results` for the `(room_code, match_instance)` pair to
  confirm only one row exists
- Mitigation: if a true duplicate exists despite the unique constraint, this is
  a P1 data-integrity bug — escalate, do not delete rows without confirming
  `player_stats` wasn't double-applied.

### Socket auth rejection spike

- Check: is this `(soft)` (non-enforce, just logging) or hard enforce-mode
  rejection?
- Check: did a client deploy go out without the updated socket auth client code
  (`apps/web/src/lib/socket/client.ts`)?
- Check: is it concentrated on one action (e.g., only `ranked:enqueue`) or
  platform-wide?
- Mitigation: if platform-wide and correlates with a deploy, this is a P1
  rollback candidate.

### Public offer not clearing

- Check: `[publicOffer:hostGrace]` logs for that offerId — was grace armed but
  never revived/removed?
- Check: is the offer's room still `matchEnded`? If so it should self-clear on
  next `publicOffer:join` attempt.
- Mitigation: if a zombie offer persists with no host socket connected and grace
  expired, this indicates the grace-timer cleanup didn't fire — capture offerId +
  hostPlayerId for follow-up.

### Wallet display confusion

- Check: is the player asking about deposits/withdrawals (expected — "Coming
  soon" badges) or about a balance discrepancy?
- Mitigation: reiterate Free Play policy copy ("Paid wallet features are not live
  yet. All beta matches and tournaments are Free Play."). If they report a
  balance *change*, that would be unexpected in Phase 9 — escalate as P1
  (economy should be fully off).

---

## 5. 30-Minute Beta Smoke-Test Script

Run end-to-end on both **desktop and mobile viewport** (or split: one pass
desktop, one pass mobile for the high-risk flows).

| # | Step | Expected result | Time |
|---|---|---|---|
| 1 | Load Home (logged out) | Page loads, no fake "Live" badges on completed matches, Featured Arenas pulses only if a real live match exists | 2 min |
| 2 | Login (existing test account) | Auth succeeds, profile/rank badge loads | 2 min |
| 3 | Quick Match — enqueue | "Ranked Free Match · 3 rounds" copy shown, `ranked:queued` received | 2 min |
| 4 | Quick Match — match found (2nd test account) | `ranked:matched`, both players land in room | 3 min |
| 5 | Private Room — create | Room code generated, "Private rooms are Free Play for now" shown | 2 min |
| 6 | Private Room — join (2nd account, separate session) | Joins via code, both players present | 2 min |
| 7 | Public Offer — create (Free) | Offer appears in public list with stakeLabel "Free" | 2 min |
| 8 | Public Offer — join + cancel (separate test) | Join works; cancel clears the offer from the list | 3 min |
| 9 | Full match — play to completion | Round picks register (`[match:pick] accepted`), match resolves, `match_results` row created, `player_stats` updated | 5 min |
| 10 | Disconnect / reconnect mid-match | Disconnect grace arms; reconnect within grace restores player to match | 3 min |
| 11 | Rematch — accept on both sides | New room/instance created, both players land in new match | 3 min |
| 12 | Tournament — create, join (2nd account), manual start, play one round | Bracket created, manual "Start Tournament" works, match room created, `[TournamentAdvance] applied` on completion | 8 min |
| 13 | Leaderboard / profile / account | Rank/placement displays correctly (e.g. "X / 10 — Placement Matches"), wallet shows "Coming soon" | 3 min |
| 14 | Mobile viewport pass (re-check 1, 3, 5, 9, 13) | Layout/nav usable, no overflow/clipping on key screens | 5 min |

(Total ~45 min if run thoroughly first time; ~30 min once familiar — trim step
12's "play one round" to just bracket creation + manual start for time-boxed
runs.)

---

## 6. First-Time-User Onboarding Review

Overall finding: **copy is already quite good** across most flows. One real gap
found.

| Topic | Current state | Verdict |
|---|---|---|
| **Free Play** | Lobby/Quick Match copy explains "Ranked Free Match · 3 rounds"; `economy/mode.ts` has a hint "Real money is disabled. All matches are free."; WalletPanel explicitly states "All beta matches and tournaments are Free Play." | Mostly clear, **but** the Home page `GameCard` shows a bare "Free Play" badge with **no inline explanation** — a brand-new visitor landing on Home sees this badge with zero context. |
| **Ranked Free Match / Quick Match** | `RankedMatchmakingPanel`: "Quick Match" / "Ranked Matchmaking" / "Ranked Free Match · 3 rounds. You'll be paired with the next available player." / "Results count toward your global stats and rank." | Clear and complete |
| **Wallet Coming Soon** | WalletPanel: "Deposits — Mobile money & card top-ups → Coming soon", "Withdrawals — Withdraw arena winnings → Coming soon", plus "Paid wallet features are not live yet..." | Clear and complete |
| **How to start a tournament** | CreateTournamentPanel: "Host a Tournament — Create a scheduled knockout event. Free entry, single elimination — your bracket goes live the moment you start it." + TournamentAdminActions: "No start time set. Start manually when your players are ready." + "Start Tournament" button | Clear and complete |
| **How to join a private room** | JoinRoomPanel: "Join Room — Enter a private room code shared by another player." CreateRoomPanel: "Start a private match and share the room code with your opponent." + "Private rooms are Free Play for now." | Clear and complete |
| **Placement 0/10** | RankBadge / CompetitiveProfileCard: "Placement Matches {played} / {required}", progress bar, "{required - played} more to qualify", and "Play 10 matches to qualify" for unranked | Excellent — multi-level clarity |

### Recommended onboarding fix (small, Phase 9-appropriate)

Add a one-line subtitle or info-icon tooltip to the Home page `GameCard` "Free
Play" badge — e.g. "Free Play — no real money, play to climb the rankings."
This is the single first-impression gap a brand-new visitor hits before
reaching any of the (already-clear) deeper copy.

---

## 7. Non-Blocking Hardening Backlog (Phase 9, small items only)

| Item | Current state | Action |
|---|---|---|
| **docs/env drift** | Root `.env.example` says `SOCKET_JWT_ENFORCE=false`; `apps/realtime-server/.env.example` says `true` ("production-safe default"), with conflicting comments | Align both files to reflect Phase 9 policy (`true`), and add a one-line note in each pointing at `docs/socket-auth-plan.md` for the rollout history |
| **Socket startup race before JWT verified** | Investigated — **no actual race**. `socket.data.authenticated` is synchronously initialized to `false` before `verifySocketJwt` resolves; `requireAuthenticatedSocket` reads this synchronously and correctly rejects in enforce mode during the verification window | No code change needed; document this in an ops/runbook note so it's not re-flagged as a bug later |
| **`activeRoom:clear` cosmetic identity check** | No auth check at all (by design — only clears an in-memory "Resume Match" hint, no wallet/game-state impact) | Optional: add `requireAuthenticatedSocket` purely for `[Security]` audit-log consistency with other handlers (no behavior change, low priority) |
| **Server-side room Free-only hardening** | Already done for all flows: ranked (`ranked.ts` → `"Free"`), private rooms (`rooms.ts` → `"Free"`, with explicit comment), tournaments (`lifecycle.ts` → `stakeLabel:"Free", stakeAmount:0`) | No action — verified complete |
| **Admin/debug visibility** | `/internal/economy/health`, `/escrows/stuck`, `/settlements/stuck` etc. exist (header-secret protected) but no web UI; no `/admin` routes in the web app | Out of scope for Phase 9 (no new UI); operators use curl/Postman against internal endpoints during soak |
| **Mobile UX polish** | Tailwind responsive breakpoints used broadly; bottom nav has mobile-aware padding (`pb-28 md:pb-6`) | No gaps found in this pass; revisit only if smoke test step 14 surfaces issues |

---

## 8. Recommended First PRs for Phase 9

Small, independent, low-risk — pick based on soak findings, roughly in priority
order:

1. **Add disconnect/reconnect/forfeit-trigger logging**
   (`gameplay/disconnectGrace.ts`, `socket/rooms.ts`) — highest-value gap for
   diagnosing "player stuck" incidents during soak.
2. **Add ranked enqueue/cancel/matched success logs** (`socket/ranked.ts`) —
   needed to monitor queue health.
3. **Fix `SOCKET_JWT_ENFORCE` doc/env drift** between root `.env.example` and
   `apps/realtime-server/.env.example`.
4. **Add public offer cancel + rematch accept/decline/reset-complete logs**
   (`socket/publicOffers.ts`, `socket/rematch.ts`).
5. **Home page "Free Play" badge — add a one-line explainer/tooltip**
   (`apps/web/src/components/home/GameCard.tsx`).
6. *(Optional, low priority)* Add `requireAuthenticatedSocket` audit logging to
   `activeRoom:clear` for consistency.

Each of these is a single-file or two-file diff, no schema/economy/match-logic
changes, and matches the "non-blocking hardening" scope.

---

## 9. Explicitly Out of Scope for Phase 9

- Real money, deposits, withdrawals, paid/staked matches, economy enablement of
  any kind
- Unity integration or any new game modes
- New product features or UI redesigns
- Admin dashboard UI (internal endpoints exist and are sufficient for now; a UI
  is a Phase 10+ consideration)
- Any change to match logic, wallet RPCs, schema, tournament bracket logic, or
  `SOCKET_JWT_ENFORCE` policy itself (already locked at `true`)
- Broad refactors of any kind
