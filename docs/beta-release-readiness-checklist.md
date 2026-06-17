# Beta Release Readiness Checklist

> **Document version:** Post-PR-#100 lock  
> **Platform:** 444 ARENA / Penalty444  
> **Repo:** `chancykibombwe/penalty444-platform`  
> **Status:** Controlled Free Play beta — not yet publicly promoted

This is the final controlled beta readiness checklist. Complete every
section before sharing the platform link with beta testers outside the
core team.

---

## 1. Purpose

This document is the operational gate for the 444 ARENA / Penalty444 Free
Play controlled beta. It consolidates:

- The current locked platform state (what is live and what is intentionally
  disabled)
- Required environment variables per service
- A manual smoke test checklist for two-player verification
- Browser and device coverage requirements
- Admin operational checks
- Log targets to monitor during a soak
- Known intentional limitations (not bugs)
- A do-not-touch list
- Release decision gates (Green / Yellow / Red)

Pass every Green gate before sharing the platform with beta testers.

---

## 2. Beta Scope

The following table defines what is and is not enabled for the controlled
beta. This scope must not change without an explicit decision and a new PR.

| Feature | Status |
|---|---|
| Penalty444 Free Play (casual, private, public, quick/ranked) | **Live** |
| Leaderboard / ranking / placement | **Live** |
| Tournaments (Free Entry, manual host start) | **Live** |
| Account / profile page | **Live** |
| Admin / debug dashboard | **Live — internal only** |
| Wallet / balance | **Coming Soon — disabled** |
| Deposits | **Disabled** |
| Withdrawals | **Disabled** |
| Paid matches / stakes | **Disabled** |
| Paid tournaments / entry fees | **Disabled** |
| Prize pools | **Disabled** |
| Unity / 3D match renderer | **Planning only — not integrated** |
| Chess444 | **Coming Soon — not playable** |
| Draught444 | **Coming Soon — not playable** |
| Crush444 | **Coming Soon — not playable** |
| Card444 | **Coming Soon — not playable** |
| Season leaderboard | **Deferred — not shown** |
| Real-money economy | **Disabled (ECONOMY\_ENABLED=false)** |

---

## 3. Current Live Platform State

The following areas are confirmed functional in the locked codebase.

### Core platform

- **Home page** — game selector, stats strip, activity feed, live match
  previews, tournament preview
- **Auth** — sign-up, sign-in, sign-out, session persistence
- **Lobby** — Quick Match / Ranked Free Match, create private room, join by
  code, public offer list (Open Challenges), ranked queue panel

### Match

- **Private rooms** — create with 3 or 5 rounds, join by code
- **Public offers** — create, cancel (host only), join by accepting an offer
- **Ranked matchmaking** — enqueue, cancel, server-side match, auto-room
- **Match room** — staging countdown, pick UI, server-authoritative result,
  round transitions, score display, final result overlay
- **Reconnect / forfeit** — disconnect grace window, reconnect resumes,
  timeout triggers forfeit (server-authoritative)
- **Rematch** — vote, accept, decline, room reset flow

### Progress and social

- **Leaderboard** — top players by rank points, placement filter, your rank
  bar with placement / ranked states
- **Account page** — profile card, competitive stats, wallet panel
  (Coming Soon state), match history tab
- **Public player profiles** — per-player stats, head-to-head, rival system

### Tournaments

- **Tournament list** — upcoming, active, completed
- **Tournament detail / lobby** — bracket view, entry, check-in, withdraw
- **Tournament match flow** — bracket advancement, tournament result overlay
- **Beta policy pills** — Free Entry, Manual Start, No Cash Prizes,
  Wallet Coming Soon

### Admin

- **`/admin`** — server-side access gate (`ADMIN_EMAILS` + Bearer JWT)
- **Health cards** — match count, tournament count, ranked/placement player
  counts, realtime URL configured status, economy mode
- **Recent matches table** — last 20 matches
- **Tournament list** — last 15 tournaments with entry/match counts
- **Player snapshot** — top 15 players by rank points with
  Placement X/10 or ranked tier badge

---

## 4. Locked Beta Safety Rules

The following invariants must not regress. Treat any violation as a
Red release gate failure.

| Rule | Notes |
|---|---|
| No fake wallet balances | WalletPanel shows placeholder when no ledger row exists |
| No fake transaction history | Ledger is empty for beta users; empty state shown |
| No fake player counts | Home page activity is real or hidden |
| No fake online counts | "X players online" must be real data or not shown |
| No fake tournaments | Only real tournaments from Supabase are shown |
| No fake prize pools | Match room and tournaments show "Coming soon" |
| No fake rank claims | Leaderboard reads only from real `player_stats.rank_points` |
| No fake season countdowns | Season leaderboard is deferred; no countdown shown |
| No fake future-game availability | Chess/Draught/Crush/Card are `comingSoon: true` — non-clickable |
| Completed matches must not appear live | `match_results` status + live match filtering |
| Placement players (< 10 matches) must not appear fully ranked | `getPlacementStatus()` gate in all ranking surfaces |
| Admin data is internal only | `/admin` blocked by server-side `ADMIN_EMAILS` check |
| Wallet "Deposit" and "Withdraw" must not be clickable CTAs | Both show "Coming soon" badge only |
| Available balance hint must not imply spendability | "Deposits and withdrawals are disabled during Free Play beta." |

---

## 5. Required Environment Variables

### 5.1 Vercel (web — `apps/web`)

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_REALTIME_URL` | **Yes** | Socket.IO server URL (Railway/production). Falls back to `http://localhost:4000` in dev. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Required by `/api/admin/data` route. Server-only — never `NEXT_PUBLIC_*`. |
| `ADMIN_EMAILS` | **Yes** | Comma-separated list of admin email addresses. Server-only — never `NEXT_PUBLIC_ADMIN_EMAILS`. |
| `NEXT_PUBLIC_ECONOMY_MODE` | No — defaults to `"off"` | Must remain unset or `"off"` during beta. Setting to `"test"` or `"live"` changes only the wallet badge label; does not activate economy. |
| `UNITY_PROTOTYPE_ROUTE_ENABLED` | No — omit in production | Server-only. If unset (or not `"true"`), `/dev/unity-prototype` returns 404 in production. Do not set in production. |
| `VERCEL_ENV` | Auto-set by Vercel | Used by the Unity prototype page guard. Not set manually. |

> **Note:** Supabase URL and anon key are currently hardcoded in
> `apps/web/src/lib/supabase/client.ts` (pointing to the production project
> `pwfgcblgjgoywefsotga.supabase.co`). They are not consumed from Vercel env
> vars. If the project moves to env-var-based config, add
> `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 5.2 Realtime server (Railway — `apps/realtime-server`)

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | **Yes — fatal** | Project API URL (not dashboard URL). Server refuses to start if missing in production. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes — fatal** | Service-role key. Never sent to clients. Server refuses to start if missing in production. |
| `REALTIME_INTERNAL_SECRET` | **Yes — fatal** | Shared secret for `/internal/*` endpoints. Server refuses to start if missing in production. |
| `ALLOWED_ORIGINS` | **Yes — fatal** | Comma-separated list of allowed frontend origins for CORS + socket handshake. Server refuses to start if missing in production. |
| `SOCKET_JWT_ENFORCE` | **Yes — set to `true`** | Enforces JWT verification on all authenticated socket actions. Must be `true` in production. |
| `ECONOMY_ENABLED` | No — defaults to `false` | Must remain `false` during beta. Setting to `true` activates economy escrow paths. |
| `NODE_ENV` | Auto-set by Railway | Controls fatal vs warn severity for env problems. |

> **Security reminder:** `SUPABASE_SERVICE_ROLE_KEY` on the realtime server
> is a different deployment secret from the one on Vercel. Both are
> server-only. Neither must ever appear in a `NEXT_PUBLIC_*` variable,
> client bundle, or network response visible to users.

### 5.3 Variables that must remain absent or disabled in beta

| Variable | Required state | Risk if wrong |
|---|---|---|
| `NEXT_PUBLIC_ADMIN_EMAILS` | Must not exist | Would expose admin email list to all browser clients |
| `NEXT_PUBLIC_ECONOMY_MODE` | Unset or `"off"` | UI-only risk (badge label); economy not activated by this alone |
| `ECONOMY_ENABLED` (realtime) | `false` or unset | Activates escrow lock/release paths |
| `UNITY_PROTOTYPE_ROUTE_ENABLED` | Unset in production | Exposes dev-only bridge sandbox to users |

---

## 6. Production Deployment Checklist

- [ ] Vercel production deploy is green (no build errors, no TypeScript errors)
- [ ] Railway realtime service is running and reporting healthy
- [ ] `NEXT_PUBLIC_REALTIME_URL` on Vercel points to the production Railway URL
- [ ] `SOCKET_JWT_ENFORCE=true` confirmed on Railway (verify via
      `/internal/economy/health` — should report `SOCKET_JWT_ENFORCE: on`)
- [ ] `ALLOWED_ORIGINS` on Railway includes the production Vercel domain and any
      preview origins that should be allowed
- [ ] `ECONOMY_ENABLED` on Railway is `false` or unset
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set on both Vercel and Railway; not exposed
      in any frontend bundle or network response
- [ ] `ADMIN_EMAILS` is set on Vercel (server-only)
- [ ] `UNITY_PROTOTYPE_ROUTE_ENABLED` is not set on Vercel production
- [ ] No direct commits to `master` — all changes land via PR
- [ ] No pending critical or open PRs that could regress the beta (PR #93 draft
      must not be merged)

---

## 7. Manual Smoke Test Checklist

Run this checklist with two accounts before every beta soak or production
deploy. Both testers should use a clean session (no leftover active room).

### 7.1 Auth

- [ ] Logged-out visit to `/lobby` redirects to sign-in
- [ ] Logged-out visit to `/match/ANYCODE` redirects safely (no crash)
- [ ] Sign-in with valid credentials works; player identity loads
- [ ] Sign-out disconnects socket and redirects to home or sign-in
- [ ] After sign-out, reloading `/lobby` requires sign-in again

### 7.2 Lobby

- [ ] Lobby loads for a logged-in user (no console errors)
- [ ] Quick Match button is visible and connects to the ranked queue
- [ ] Ranked queue can be cancelled before a match is found
- [ ] Create Private Room works: generates a room code
- [ ] Join Private Room by code works: second player joins, match starts
- [ ] Create Public Offer works: offer appears in the list for another player
- [ ] Public Offer can be cancelled by the host
- [ ] A non-host player cannot cancel another user's offer
- [ ] Accepting a public offer starts the match for both players

### 7.3 Match

- [ ] Both players are assigned roles (KICKER / KEEPER) and see the pick UI
- [ ] Pick timer counts down server-authoritatively
- [ ] Both players submit picks; round resolves with GOAL / SAVE / DRAW
- [ ] Result display shows correctly (reveal animation → result label)
- [ ] Kicker timeout (no pick): result is SAVE (server picks keeper's lane wins)
- [ ] Keeper timeout (no pick): result is GOAL (server picks kicker's lane wins)
- [ ] Both timeout simultaneously: result is DRAW
- [ ] Scores accumulate correctly across rounds
- [ ] Sudden death triggers correctly when scores are level after max rounds
- [ ] Match end: final result screen displays correct winner / draw
- [ ] "Rematch" vote: both players can vote; room resets correctly
- [ ] Rematch does not leave ghost state from the previous match

### 7.4 Reconnect and forfeit

- [ ] Disconnect one player mid-match (close tab or block network)
- [ ] Remaining player sees a "player reconnecting" indicator
- [ ] Reconnect within the grace window: match resumes from correct state
- [ ] No reconnect within grace window: forfeit is triggered; remaining player
      is awarded the win; match result is saved
- [ ] After forfeit, the disconnected player sees an appropriate result screen
      on reload (not a broken/loading state)

### 7.5 Ranking and leaderboard

- [ ] A player with fewer than 10 matches shows "Placement" (not a tier) on
      the stats strip, profile card, and leaderboard bar
- [ ] A player with 10 or more matches shows their real tier and rank points
- [ ] The leaderboard does not list placement players in the ranked section
- [ ] No "Last season" or season rank labels appear anywhere
- [ ] The "Your rank" bar on the leaderboard shows placement or ranked state
      correctly

### 7.6 Tournaments

- [ ] Tournament list shows real tournaments only (no fake entries)
- [ ] Tournament cards show "Free Entry", "Manual Start", "No Cash Prizes"
      policy pills
- [ ] No prize pool amount is shown for any tournament
- [ ] Joining a tournament works; entry status updates
- [ ] Withdrawing from a tournament works
- [ ] Tournament detail / lobby loads without errors
- [ ] Host can start a tournament (if in `registration` or `check_in` state)
- [ ] Completed and cancelled tournaments show honest status labels

### 7.7 Wallet

- [ ] Wallet panel says "Arena Wallet · Coming Soon"
- [ ] No deposit button is clickable
- [ ] No withdrawal button is clickable
- [ ] No balance amount is shown unless backed by a real ledger row
- [ ] Available balance hint reads "Deposits and withdrawals are disabled
      during Free Play beta."
- [ ] Locked balance hint reads "No active reservations." when escrow is empty
- [ ] Empty wallet state: "Wallet Coming Soon. Free Play only — no deposits or
      withdrawals yet."
- [ ] Economy mode badge shows "Free Play" (not "Test Mode" or "Live · Real
      Money")
- [ ] No paid match labels in the lobby (stake shows "Free")
- [ ] No prize pool value in the match room (shows "Coming soon")

### 7.8 Admin

- [ ] An admin user (in `ADMIN_EMAILS`) can open `/admin` while logged in
- [ ] A logged-out user visiting `/admin` sees a sign-in prompt, not data
- [ ] An incognito / non-admin account visiting `/admin` is blocked (403)
- [ ] Admin dashboard loads data: health cards, recent matches, tournaments,
      players
- [ ] Placement players in the player snapshot show "Placement X/10" badge
- [ ] Ranked players show their tier correctly
- [ ] `SUPABASE_SERVICE_ROLE_KEY` does not appear in any network response
      visible in browser DevTools
- [ ] `/admin` is not linked from the public navbar or any user-facing page

### 7.9 Future games (Coming Soon)

- [ ] Chess444 card on the home page is non-clickable ("Coming Soon")
- [ ] Draught444 card on the home page is non-clickable ("Coming Soon")
- [ ] Crush444 card on the home page is non-clickable ("Coming Soon")
- [ ] No queue, lobby, or match route exists for any future game
- [ ] `/dev/unity-prototype` returns 404 in production
      (confirm by visiting the URL directly)

---

## 8. Browser and Device Test Matrix

Run the match smoke test on at least the following:

| Platform | Priority | Notes |
|---|---|---|
| Desktop Chrome (latest) | **Required** | Primary development browser |
| Desktop Firefox (latest) | Recommended | Second most common desktop browser |
| Desktop Edge (latest) | Recommended | Windows default |
| Mobile Chrome Android | **Required** | Largest mobile share |
| Mobile Safari iPhone (iOS 16+) | Recommended | iOS users |
| Narrow viewport (375 px width) | **Required** | Test lobby, match room, leaderboard |
| Slow 3G throttle (Chrome DevTools) | Recommended | Test lobby load, match start, admin load |

Minimum coverage before wider beta: desktop Chrome + mobile Chrome Android +
narrow viewport.

---

## 9. Two-Player Test Matrix

Run full match smoke tests in at least these configurations:

| Configuration | Why |
|---|---|
| Same browser, normal window + incognito | Cheapest two-account setup; catches auth cookie isolation bugs |
| Two different browsers (Chrome + Firefox) | Catches browser-specific rendering or socket behaviour |
| Two different user accounts (different emails) | Tests real matchmaking, not a single account double-joining |
| Desktop + mobile | Tests responsive match room under real conditions |
| Slow network simulation (one player) | Catches pick timer behaviour under latency |

A full two-player match test covers: lobby → match → at least one full round
trip → rematch or exit.

---

## 10. Admin Operational Checklist

After each production deploy or before a beta soak:

- [ ] Open `/admin` and confirm it loads without error
- [ ] Check **recent matches**: verify timestamps are recent and data looks
      correct (no phantom or duplicate room codes)
- [ ] Check **active tournaments**: any stuck in `in_progress` with no
      advancing matches? Investigate before opening to testers
- [ ] Check **player snapshot**: at least some players should show as ranked
      if matches have been played; placement badge visible for new accounts
- [ ] Check **health cards**: `rankedPlayersCount` and `placementPlayersCount`
      should be non-negative integers; `realtimeUrlConfigured` should be true;
      `economyMode` should be `not_set` or `off`
- [ ] Verify the admin page is not linked from the main navbar or any
      user-facing surface
- [ ] If a realtime issue is reported: tail Railway logs for the log prefixes
      in Section 11

---

## 11. Logs to Watch

Reference for log tailing during a beta soak. All prefixes are emitted by
the realtime server (`apps/realtime-server`).

| Log prefix / pattern | What it means |
|---|---|
| `[Security] unauthenticated action blocked` | Anonymous client tried an auth-required action. Occasional is expected. Spike = client bug. |
| `[Security] jwt_player_mismatch` | Player id in payload doesn't match verified socket user. Should be ~0 in production. |
| `[Security] rate limit exceeded` | Too many actions from one socket. Check if it's a legitimate player or a bad client. |
| `[socket:lifecycle] connect` | Socket connected. Normal. |
| `[socket:lifecycle] disconnect` | Socket disconnected. Check reason field. |
| `[socket:reconnect] attempt` | Reconnect loop started. Normal after any disconnect. |
| `[socket:reconnect] failed_giving_up` | Should never fire (`reconnectionAttempts: Infinity`). Critical if seen. |
| `[Disconnect] reconnect` | Player reconnected within grace window. Match should resume. |
| `[Disconnect] forfeit_triggered` | Grace window expired. Winner awarded. Match result saved. |
| `[Settlement] result insert created` | Match result saved to `match_results`. Normal per match. |
| `[Settlement] duplicate result skipped` | Idempotency deduplication. Occasional is fine. Frequent = client retry loop. |
| `Failed to save match result` | Critical. Should be 0. |
| `[Progression] applied` | Rank point delta applied to `player_stats`. Normal per match. |
| `[Progression] .*failed` | Critical. Should be 0. |
| `[Ranked] enqueue` | Player entered the ranked queue. |
| `[Ranked] matched` | Two players matched; room created. |
| `[publicOffer:cancel]` | Public offer removed. |
| `[publicOffer:hostGrace]` | Host disconnect grace armed for a public offer. |
| `[TournamentAdvance] applied` | Bracket advanced after tournament match. |
| `[TournamentAdvance] winner conflict` / `failed` | Critical. Should be 0. |
| `[Economy] .*escrow lock failed` | Should be 0 (economy off). If seen, check `ECONOMY_ENABLED`. |
| `CORS.*rejected` / `origin.*not allowed` | Frontend origin not in `ALLOWED_ORIGINS`. Check config. |

---

## 12. Known Intentional Limitations

The following are not bugs. They are intentional beta-phase limitations.

| Limitation | Why intentional |
|---|---|
| No real wallet / deposits / withdrawals | Beta policy. Compliance and legal review required. See `docs/wallet-architecture-guardrails.md`. |
| No Unity / 3D live match renderer | Planning stage only. See `docs/unity-3d-prototype-plan.md`. |
| No paid tournament entry fees | Beta policy. Economy must be approved first. |
| No future games playable (Chess444 etc.) | Planning stage only. See `docs/future-games-framework-plan.md`. |
| No public prize pools | Beta policy. |
| No season leaderboard | `season_player_stats` uses flat DB trigger deltas, not the ELO system. Deferred until fixed. |
| Admin dashboard internal only | By design. No public link. |
| Some UI polish still possible | Cosmetic items remain. Not release blockers. |
| Guest match mode (`/guest`) is limited | Guest vs AI is a stub; not a full matchmaking path. |
| Tournament host-start is manual | No automated tournament scheduling yet. Host must manually start. |

---

## 13. Do-Not-Touch List Before Beta

The following areas must not be changed during the controlled beta phase
without a full review, a new dedicated PR, and explicit sign-off:

| Area | Why protected |
|---|---|
| Penalty444 gameplay rules (lane picks, shot resolution, scoring) | Core game integrity |
| Match timer logic (pick window, staging countdown, forfeit timer) | Server authority; changes break existing sessions |
| Reconnect / disconnect grace window | Sensitive state machine; regression risk is high |
| Result saving (`saveMatchResult`, `progression.ts`) | Data integrity |
| Socket.IO event names and payload contracts | Breaking change for all connected clients |
| Supabase RLS policies | Security boundary |
| Wallet / economy backend | Must not activate during beta |
| Tournament bracket logic | Affects live tournament state |
| Ranking / ELO calculations | Affects leaderboard integrity |
| Admin access control (`ADMIN_EMAILS` gate, Bearer JWT check) | Security boundary |
| Realtime CORS / origin enforcement (`origins.ts`) | Security boundary |
| PR #93 draft branch | Must not be merged |

---

## 14. Release Decision Gates

### Green — Okay for controlled beta

All of the following must be true:

- [ ] Vercel production build is green (no errors)
- [ ] Realtime server is running and `SOCKET_JWT_ENFORCE=on`
- [ ] Full two-player smoke test passes (Section 7)
- [ ] Admin dashboard accessible to admin users only
- [ ] Wallet shows "Coming Soon" — no deposit / withdrawal enabled
- [ ] No fake data visible anywhere (balances, transactions, player counts,
      prize pools, future-game availability)
- [ ] No critical console errors or runtime crashes in the smoke test
- [ ] `/dev/unity-prototype` returns 404 in production

### Yellow — Internal testing only, not for wider sharing

Any of the following:

- Minor UI layout issue that doesn't affect game flow
- Preview-deploy-only issue not reproducible in production
- Admin dashboard cosmetic/visual polish problem
- Non-blocking copy or labelling inconsistency
- A single browser/device-specific rendering quirk that doesn't affect gameplay

### Red — Do not share with anyone outside core team

Any of the following:

- Match cannot complete (stuck loading, result not showing, room not cleaned up)
- Unauthenticated user can access or interact with any multiplayer feature
- Wallet appears live — deposit or withdrawal button is clickable
- Any fake paid data appears (fake balance, fake transaction, fake prize pool,
  fake entry fee)
- Admin data is visible to a non-admin or unauthenticated user
- `SOCKET_JWT_ENFORCE` is off in production
- Match results are not being saved to `match_results`
- Reconnect grace does not trigger; forfeit fires immediately on disconnect
- `SUPABASE_SERVICE_ROLE_KEY` is visible in any browser network response

---

## 15. Recommended Next Phase After Controlled Beta

After a successful controlled beta soak (48–72 hours, Section 3 of
`docs/phase-9-beta-soak-plan.md`):

1. **Bug triage only.** Categorize reported issues as Red/Yellow/Green.
   Fix only Red and critical Yellow issues before widening access.
2. **Do not activate the wallet.** The compliance checklist in
   `docs/wallet-architecture-guardrails.md` must be completed first.
3. **Do not integrate Unity.** The prototype plan in
   `docs/unity-3d-prototype-plan.md` Phase B has not started.
4. **Do not implement a second game.** The acceptance criteria in
   `docs/future-games-framework-plan.md` Section 17 must be met first.
5. **Do not merge PR #93 (draft/experimental).** It remains blocked.
6. **Widen beta access gradually** after at least one clean 72-hour soak with
   no Red issues and a manageable Yellow backlog.
7. **Season leaderboard** can be considered after `season_player_stats` ELO
   alignment is fixed in a dedicated PR.

---

## 16. Final Beta Statement

> **Penalty444 is ready for controlled Free Play beta only if all Green gates
> in Section 14 pass.**
>
> The platform is Free Play only. No real money is involved. No deposits,
> withdrawals, paid matches, paid tournaments, or prize pools are active.
> Future games (Chess444, Draught444, Crush444, Card444) are visible as
> Coming Soon and are not playable.
>
> Do not share the link more broadly until the smoke test in Section 7 has
> been completed end-to-end with two real accounts, and every Green gate has
> been ticked.
