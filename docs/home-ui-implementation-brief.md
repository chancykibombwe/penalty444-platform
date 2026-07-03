# Home UI Implementation Brief

**Status:** Design locked — do not change. This is a developer handoff based on the approved Figma frames. **No code in this brief.**

**Locked design package (approved frames):**
- Home Mobile 390 — V1
- Home Mobile 360 — V1
- Home Desktop — V1

**Foundation already in place (reuse, don't reinvent):**
- Always-dark arena theme + `arena-*` design tokens — **PR #164 Brand Foundation Dark Arena Theme — merged.**
- Section-header / rhythm system on the Home page — **PR #165 Home Landing Final Look — merged.**
- Branded live-strip empty states via `LiveStripEmpty` — **PR #166 Home Live Strip Empty States — merged.**
- Unity / `MatchRenderer3D` — **PR #162 Unity Phase B1 Bridge Stub — still parked as an open draft and untouched.**
- Locked, do-not-touch surfaces: Beta Guide, Lobby Help shortcuts, Account Feedback panel/helper, Match-End Feedback UI, Unity/`MatchRenderer3D`.

---

## 1. Design goal

Replace the current Home **dashboard-style** look with a **premium 444 ARENA gaming-app experience** — confident hero, clear primary actions, a real games grid, and live/competitive context — consistent across Mobile (360 / 390) and Desktop V1. Presentation upgrade only; the platform's behavior, data, and Free Play policy are unchanged.

---

## 2. Approved mobile structure (360 / 390)

Top-to-bottom order:
1. **Top bar** — brand wordmark (444 ARENA), Free Play pill, notification button.
2. **Hero** — headline + primary CTA (`PLAY FREE`).
3. **Quick Match / Create Room** — quick-action cards row.
4. **Games grid** — Penalty444 (live) + coming-soon games.
5. **Stats strip** — the logged-in player's real stats.
6. **Bottom nav** — persistent mobile navigation.

> 360 vs 390: same structure and order; 360 tightens horizontal padding/gaps and may stack quick-action cards. No content is dropped between the two widths.

---

## 3. Approved desktop structure (V1)

- **Left sidebar** — primary navigation (persistent).
- **Top header** — brand + Free Play pill + notifications + account.
- **Large hero** — prominent headline + primary CTA.
- **Quick action cards** — Quick Match / Create Room / Join Room / Practice.
- **Featured games row** — horizontal games row.
- **Recent matches** — the player's recent results panel.
- **Leaderboard** — top players panel.
- **Right rail** — Live Arena / Beta Challenges / Online Players / Invite Friends.

---

## 4. Component list (+ mapping to current code)

| New component | Purpose | Current code to reuse / evolve |
|---|---|---|
| **HomeTopBar** | Mobile/desktop top bar | Split from global `components/layout/Navbar.tsx` — **must not break the global nav**; Home top bar is additive/wrapping, not a replacement of routing |
| **FreePlayPill** | Free Play pill / ⚡ FREE PLAY | New, small; matches the existing layout Free-Play strip wording |
| **NotificationButton** | Notifications entry | Reuse `components/live/NotificationBell.tsx` |
| **HomeHero** | Hero block | Evolve `components/home/HeroBanner.tsx` — **preserve its Beta Guide links (PR #151)** |
| **QuickActionCard** | Quick action tile | Reuse `components/home/QuickActionCard.tsx` |
| **GameCard** | Single game tile | Reuse `components/home/GameCard.tsx` — add **Card444**, remove silent `href:"/"` on coming-soon |
| **GamesGrid** | Grid/row wrapper for GameCards | New wrapper (currently an inline `.map` in `page.tsx`) |
| **PlayerStatsStrip** | Player stats | Reuse `components/home/PlayerStatsStrip.tsx` — enforce real data + New Player defaults |
| **BottomMobileNav** | Mobile bottom nav | Reuse the bottom-nav half of `Navbar.tsx` |
| **DesktopSidebar** | Left nav rail | New (desktop) |
| **DesktopHeader** | Desktop top header | New (desktop) |
| **RecentMatchesPanel** | Recent results | New UI over existing `lib/matches/matchHistory.ts` (read-only) |
| **LeaderboardPanel** | Top players | New UI over existing leaderboard `player_stats` query (read-only) |
| **RightRailPanel** | Live Arena / Beta Challenges / Online Players / Invite Friends | New wrapper reusing existing `components/live/*` + `LiveStripEmpty` |

---

## 5. Exact copy (use verbatim, uppercase as given)

`PLAY FREE` · `CREATE ROOM` · `QUICK MATCH` · `JOIN ROOM` · `PRACTICE` · `FEATURED GAMES` · `RECENT MATCHES` · `LEADERBOARD` · `LIVE ARENA` · `BETA CHALLENGES` · `ONLINE PLAYERS` · `INVITE FRIENDS`

- `PLAY FREE` → primary hero CTA → `/lobby`.
- `QUICK MATCH` / `CREATE ROOM` / `JOIN ROOM` / `PRACTICE` → quick-action cards (route to existing lobby flows; **PRACTICE only if a real destination exists** — otherwise mark as Coming Soon, do not fake it).
- `INVITE FRIENDS` → share/invite entry **only** — must NOT imply earning (see §7).

---

## 6. Data rules

- **All stats use the real logged-in player's data.** Figma sample numbers are placeholders — **never hardcode them.**
- **New-player defaults:** name `New Player`, win rate `0%`, `0`, `0`.
- **Real data sources (read-only, no new backend):**
  - Player stats → `player_stats` (as in Account/Leaderboard).
  - Recent matches → `lib/matches/matchHistory.ts` (`match_results`).
  - Leaderboard → existing `player_stats` leaderboard query.
  - Online players / Live Arena / Beta Challenges → existing `lib/live/activity.ts`.
- **Sparse/empty data → safe branded empty states** (reuse `LiveStripEmpty` from PR #166). No fake players, matches, or counts.
- **Wallet stays `Soon` / `Coming Soon`** — read-only, no activation.

---

## 7. Beta-safe wording (forbidden)

Do **not** use anywhere: `prize pool`, `cash prizes`, `real rewards`, `coins as currency`, `deposits`, `withdrawals`, `earn money`, `Invite & Earn`. `INVITE FRIENDS` is invite-only — no earning/reward implication.

---

## 8. Implementation rules

- **First UI PR: no backend changes.**
- No match logic, no Socket.IO, no Supabase schema/RLS changes, no wallet/economy activation, no Unity/3D changes.
- **Home UI only.** Do not touch the locked beta-support surfaces or PR #162.
- Use `arena-*` brand tokens (neon cyan/blue primary, controlled gold accent, emerald beta) — not raw hex.
- Every PR validates `npx tsc --noEmit -p apps/web/tsconfig.json` (TS5101 baseUrl warning acceptable) and `npm run build` (must pass), and is opened as a **draft** for review; no self-merge.

---

## 9. Suggested PR breakdown

| PR | Scope | Notes |
|---|---|---|
| **#167 — Home UI Design System / Tokens Alignment** | Confirm/extend `arena-*` tokens, spacing/type scale, shared primitives (FreePlayPill, NotificationButton reuse). No layout yet. | Foundation for the rest |
| **#168 — Home Mobile Shell** | HomeTopBar + BottomMobileNav + page scaffold at 360/390. | Structure only, placeholder content |
| **#169 — Home Hero + Quick Actions** | HomeHero (preserve Beta Guide links) + QuickActionCard row (PLAY FREE / QUICK MATCH / CREATE ROOM / JOIN ROOM / PRACTICE). | Route to existing lobby flows |
| **#170 — Home Games + Stats** | GamesGrid + GameCard (add Card444, fix coming-soon nav) + PlayerStatsStrip (real data + New Player defaults). | |
| **#171 — Home Desktop Layout** | DesktopSidebar + DesktopHeader + large hero + quick actions + FeaturedGames row + RecentMatchesPanel + LeaderboardPanel + RightRailPanel. | Desktop V1 |
| **#172 — Home Data Wiring / Empty States Review** | Verify all panels use real data + safe empty states; wallet stays Coming Soon; final copy/beta-safe audit. | No new backend |

> **Numbering note:** the plan reuses labels #167–#172; on GitHub the actual numbers will be whatever is next at merge time (PR #162 Unity remains an open draft and does not consume these). Reconcile labels ↔ GitHub numbers when each PR opens.

---

## 10. This PR is docs-only

This implementation-brief PR contains **documentation only**:
- No app code.
- No Home component changes.
- No layout changes.
- No backend changes.
- No Supabase / Auth / Socket.IO / Wallet / Economy changes.
- No Unity changes.
- No PR #162 changes.

**Guardrail reminder for every implementation PR (#167+):** locked beta-support surfaces untouched; Unity/PR #162 untouched; no backend/match/socket/Supabase/wallet changes; Free Play policy locked; brand tokens + always-dark theme.
