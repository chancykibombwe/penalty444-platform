# PR #175 — Wider Beta Readiness Check

**Status:** Audit / checklist only. No app code changed in this PR.

**Context:** The Home UI phase is locked via PR #164–#174 (Brand Foundation,
Home Landing Final Look, Live Strip Empty States, Home UI Implementation
Brief, Design System Tokens, Home Mobile Shell, Home Hero + Quick Actions,
Home Games + Stats, Home Desktop Layout, Home Desktop Visual Polish, Final
Home UI Audit). PR #162 (Unity Phase B1 Bridge Stub) remains parked as an
open draft and is untouched.

**Policy scope for this audit:** Free Play only. Wallet is read-only /
Coming Soon. No deposits, no withdrawals, no cash prizes, no real-money
activation. No fake data. No fake routes. `master` is the source of truth.
PR-only workflow.

**Method:** Every finding below is grounded in the current source tree
(`master` at the time this branch was cut, commit `be7b0bae`). Each claim
cites the file and, where useful, the line(s) that support it. No app code
was modified to produce this report.

---

## 1. Home / landing

- Home UI lock is documented in `docs/final-ui-direction-audit.md` (PR
  #163) and `docs/final-home-ui-audit.md` (PR #174, concluded **"READY FOR
  WIDER BETA HOME UI LOCK ✅"**).
- Mobile (`HomeMobileShell.tsx`, `HomeTopBar.tsx`, `BottomMobileNav.tsx`)
  and desktop (`components/home/desktop/HomeDesktopLayout.tsx` and
  siblings) layouts both exist and are wired into `apps/web/src/app/page.tsx`.
- No unsafe money/reward wording found on Home: hero CTA is "PLAY FREE",
  badge reads "444 Arena · Free Play Beta", quick actions are "QUICK
  MATCH" / "CREATE ROOM" (`HeroBanner.tsx`, `HomeQuickActions.tsx`).
- Coming-soon games (`Chess444`, `Draught444`, `Crush444`, `Card444`) are
  rendered via `GameCard.tsx`, which renders a disabled `<div
  aria-disabled>` — never a `<Link>` — when `comingSoon: true`. `href` for
  these entries is `""` (defense in depth, `page.tsx`).

**Status: GREEN.**

## 2. Auth

- `RequireAuth.tsx` gates protected routes with a client-side session
  check plus a `SIGNED_OUT` listener that calls `disconnectSocket()`.
- Guest play (`app/guest/page.tsx`) is a genuine single-player-vs-AI mode
  (local `Lane`/`ShotResult` resolution) — it does not expose multiplayer
  to anonymous users.
- Logout (`app/account/page.tsx`, `handleLogout`) calls
  `supabase.auth.signOut()` → `disconnectSocket()` → `router.replace("/")`.
  It does **not** call `clearActiveMatch()`, so active-match recovery
  state in `localStorage` survives a logout. Match-room re-entry is
  separately guarded by `clearActiveMatchIfPlayerMismatch()`
  (`lib/match/activeMatch.ts`), invoked in `MatchRoomPanel.tsx`, which
  clears the recovery record only if the resuming player doesn't match.

**Status: GREEN.** Logout not clearing active-match state is intentional
(supports legitimate reconnect-after-logout-then-login-again flows) and is
already mismatch-guarded; noted as a watch item, not a defect.

## 3. Lobby

- `app/lobby/page.tsx` renders `RankedMatchmakingPanel`,
  `PublicMatchOffersPanel`, `CreateRoomPanel`, `JoinRoomPanel`,
  `LobbyChatPanel`, and a "Beta Testing Help" section — all present and
  wired.
- No paid-entry language is active: `CreateRoomPanel.tsx` (line 133) and
  `PublicMatchOffersPanel.tsx` (line 318) hardcode `stakeLabel: "Free"`,
  rendered as "Free · Free Play only" in emerald text.
- Lobby help/feedback shortcuts are intact (Beta Testing Help section in
  `lobby/page.tsx`).

**Status: GREEN.**

## 4. Match flow

- `MatchRoomPanel.tsx` implements the full state machine: LEFT/CENTER/RIGHT
  picking, reveal, round counting via `MatchScoreboard`
  (`currentTurn`/`totalTurns` props, lines ~3071–3083), sudden death
  (`isSuddenDeath`, `phase === "SUDDEN_DEATH"`, "⚡ Sudden Death" UI at
  line 3058), and a `matchEndOutcome` victory/defeat branch.
- Rematch UI (vote/decline/request state) is implemented and does not
  block the base match-end flow — declining or timing out still resolves
  to a clear end screen.
- Match-end feedback shortcut is present and untouched: "Something went
  wrong?" (line 3355) and "Report issue from this match →" (line 3360).

**Status: GREEN.**

## 5. Reconnect / disconnect

- A 39-second reconnect grace period is implemented and commented
  explicitly ("Waiting 39 seconds for reconnect...", line 174) with a live
  on-screen countdown (`{disconnectCountdown}s...`, line 2895).
- Forfeit has an explicit confirmation step: "Forfeit this match? This
  will count as a loss." with a "Forfeit" button (lines 2606, 2918) — not
  a silent/accidental action.
- `CreateRoomPanel.tsx` also exposes a "Cancel Room" action for early
  cancellation before a match starts.
- As noted in §2, logout does not erase active-match recovery state, and
  match-room re-entry is guarded against player mismatch.

**Status: GREEN.**

## 6. Feedback / support

- Account page (`app/account/page.tsx`) renders `BetaFeedbackPanel` and
  exposes a `<div id="beta-feedback">` anchor.
- `app/beta-guide/page.tsx` links to `/account#beta-feedback` in two
  places (lines 201, 285) as its feedback CTA.
- Match-End feedback shortcut confirmed in §4.
- `app/support/page.tsx` has working "Report a Problem" / "Contact
  Support" sections.

**Status: GREEN.**

## 7. Account / stats / leaderboard

- Account page loads behind its own inline session check (independent
  pattern from `RequireAuth`, equally valid).
- `PlayerStatsStrip.tsx` (PR #171) never fabricates values: 0-match
  players see "New Player" / "Play your first match" rather than an
  invented rank; win rate/streak/wins all derive from `CompetitiveStats`
  and shared helpers (`formatWinRate`, `formatStreakLabel`); rank tiers
  come from the canonical `resolvePlayerTier` in `lib/player/ranks.ts`,
  which itself falls back to "Unranked" rather than guessing.
- `app/leaderboard/page.tsx` has working search (`ilike` query) and a
  rankBy toggle. The "Season" period chip is present but disabled with
  "not yet available" copy — it does not silently show wrong or fake
  data; "All Time" is the only active view.

**Status: GREEN.**

## 8. Wallet / economy safety

- `app/wallet/page.tsx` redirects to `/account` (`redirect("/account")`)
  — there is no standalone wallet page to expose money controls on.
- `components/account/WalletPanel.tsx` has an explicit comment: "Deposits
  / withdrawals are intentionally absent... the frontend NEVER initiates a
  money movement." All wallet CTAs are "Coming soon" badges, not active
  buttons.
- `lib/economy/mode.ts`'s `getPublicEconomyMode()` defaults to `"off"`
  (fail-closed) when `NEXT_PUBLIC_ECONOMY_MODE` is unset.
- `.env.example` confirms economy flags are conservative by default:
  `ECONOMY_ENABLED=false`, `ECONOMY_TEST_MODE=false`,
  `ECONOMY_REAL_MONEY_ENABLED=false`, `ECONOMY_RECONCILIATION_ENABLED=false`,
  `NEXT_PUBLIC_ECONOMY_MODE=off`.
- No active deposit/withdraw/payout/commission/cash-prize flow found
  anywhere in the reviewed surfaces.

**Status: GREEN.**

## 9. Tournaments

- `app/tournaments/page.tsx` and
  `components/tournament/TournamentEntryActions.tsx` prominently show
  "Free Entry" badges — tournaments do not imply paid competition.
- The only "entry fee" string found is inside an unreachable error-message
  template (`` `Could not reserve entry fee: ${lock.error}` ``), and it is
  gated behind the same economy-off checks covered in §8 — it cannot
  render with money-related content while economy mode is off.
- Tournament match/bracket logic was not touched by this audit and is out
  of scope per the hard guardrails.

**Status: GREEN.**

## 10. Admin / moderation

- Admin routes (`app/admin/page.tsx`, `app/admin/beta/page.tsx`) render
  "forbidden" / "Not authorized." states for non-admins rather than
  leaking any admin UI.
- Server-side admin API routes (`app/api/admin/{beta-dashboard,data,me}/route.ts`)
  gate on a server-only `ADMIN_EMAILS` env var, with an explicit comment:
  "Never use NEXT_PUBLIC_ADMIN_EMAILS." No admin tool is exposed to
  normal users.

**Status: GREEN.**

## 11. Deployment / infrastructure

- `.env.example` documents the required variables comprehensively:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_REALTIME_URL`,
  `REALTIME_INTERNAL_URL`, `REALTIME_INTERNAL_SECRET`, `ADMIN_EMAILS`,
  `CRON_SECRET`, `TOURNAMENT_AUTO_START_ENABLED`, `SOCKET_JWT_ENFORCE`,
  and the economy flags listed in §8.
- `REALTIME_INTERNAL_URL=http://localhost:4000` in `.env.example` is a
  **local-dev default only**; production deployment must set this (and
  `NEXT_PUBLIC_REALTIME_URL`) to the real Railway realtime backend URL.
  This is a configuration responsibility at deploy time, not a code gap.
- The repo has multiple security/hardening docs
  (`docs/database-security.md`, `docs/github-security-checklist.md`,
  `docs/hardening-sprint-1-checklist.md`,
  `docs/hardening-sprint-2-checklist.md`, `docs/security/`,
  `docs/socket-security.md`, `docs/supabase-security-checklist.md`) but
  **no single consolidated deployment runbook** tying env vars, Vercel
  project settings, and Railway realtime config together in one place.

**Status: YELLOW.** No known broken build/config, but the missing
consolidated runbook is a real onboarding/ops risk once more people touch
deployment. Recommend a follow-up docs-only PR, not a blocker for
controlled wider beta.

## 12. Browser / device sanity

This environment's outbound network policy blocks reaching the production
Vercel URL, so this section is **source-grounded only** — it verifies
responsive structure and Tailwind breakpoint usage in code, not live
rendered pixels in a real browser. This should be read as a code-level
sanity check, not a substitute for a manual pass by a human with browser
access.

- **Mobile 360px / 390px:** Home mobile chrome (`HomeMobileShell.tsx`,
  `HomeTopBar.tsx`, `BottomMobileNav.tsx`) uses `md:hidden` to scope
  itself to mobile widths; `GamesGrid.tsx` uses `grid-cols-2` by default
  (2×2 for the 4 coming-soon tiles, no orphaned half-row) up to `sm:`;
  `PlayerStatsStrip.tsx` uses a 4-column compact grid with `compact`
  sizing tuned for narrow widths.
- **Desktop 1280px / 1440px:** `HomeDesktopLayout.tsx` and siblings
  (`DesktopHeader`, `DesktopSidebar`, `DesktopQuickActions`,
  `DesktopFeaturedGames`, `DesktopRightRail`, etc.) are scoped with
  `md:`/`lg:`-style breakpoints; `GamesGrid.tsx` switches to
  `sm:grid-cols-4` for the wider layout.
- **Chrome/Edge:** No browser-specific CSS hacks or vendor-prefixed
  workarounds were found in the touched Home files beyond standard
  Tailwind output and the existing `-webkit-appearance` reset in
  `globals.css` for number inputs — nothing that would be expected to
  diverge between Chromium-based browsers.
- **Global dark theme:** `globals.css` sets `color-scheme: dark` and
  always-dark root tokens (`#0a0e14` background) with no
  `prefers-color-scheme: light` path, so there is no light-mode flash
  risk to check across devices.

**Status: YELLOW (verification method limited).** Recommend one manual
pass at 360/390/1280/1440 in an actual Chrome/Edge session before or
immediately after wider beta opens, specifically on Home and the match
room (the two most animation/layout-heavy surfaces).

## 13. Risk register

| Area | Status | Risk | Required action before wider beta | Owner |
|---|---|---|---|---|
| Home / landing | GREEN | None found | None | — |
| Auth | GREEN | Active-match state survives logout (by design, mismatch-guarded) | None; monitor for edge-case reports | Later |
| Lobby | GREEN | None found | None | — |
| Match flow | GREEN | None found | None | — |
| Reconnect / disconnect | GREEN | None found | None | — |
| Feedback / support | GREEN | None found | None | — |
| Account / stats / leaderboard | GREEN | "Season" leaderboard view is a visible disabled chip | None; already labeled "not yet available" | Later |
| Wallet / economy safety | GREEN | None found | None | — |
| Tournaments | GREEN | Unreachable error string mentions "entry fee" | None; unreachable while economy is off | Later |
| Admin / moderation | GREEN | None found | None | — |
| Deployment / infrastructure | YELLOW | No single consolidated deployment runbook (env vars + Vercel + Railway in one doc) | Docs-only follow-up PR | ChatGPT |
| Browser / device sanity | YELLOW | Verified from source only; no live browser pass possible in this environment | One manual QA pass at 360/390/1280/1440 in Chrome/Edge | Manual |

## 14. Final recommendation

**READY FOR CONTROLLED WIDER BETA**

All safety-critical areas (auth, economy/wallet, tournaments, admin,
match flow, reconnect/forfeit, feedback/support) are GREEN with
evidence-backed findings and no fake data, fake routes, or active
money-movement surfaces. The two YELLOW items (deployment runbook
consolidation, and a manual cross-device visual pass) are watch items
that can be handled as fast follow-ups and do not block opening wider
beta.
