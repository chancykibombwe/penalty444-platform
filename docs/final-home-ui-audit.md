# Final Home UI Audit

**Date:** 2026-07-04
**Branch:** `audit/final-home-ui-audit`
**PR:** PR #174 — Final Home UI Audit (docs-only)
**Audit scope:** Home page (`/`) after the Home UI series — PRs #167–#173.

---

## 1. What was reviewed

- **Codebase at `master`** = `ecb97d68` (PR #173 — Home Desktop Visual Polish), which includes:
  - #167 Home UI Implementation Brief (docs)
  - #168 Home UI Design System / Tokens Alignment
  - #169 Home Mobile Shell
  - #170 Home Hero + Quick Actions
  - #171 Home Games + Stats
  - #172 Home Desktop Layout
  - #173 Home Desktop Visual Polish
- **Production deployment:** https://penalty444-platform-at1y.vercel.app/ (live Vercel build of the same Home).
- **Desktop review link:** https://penalty444-platform-at1y.vercel.app/ — checked at 1280 px and 1440 px.
- **Mobile review link:** https://penalty444-platform-at1y.vercel.app/ — checked with DevTools mobile emulation at 360 px and 390 px.
- **Method:** local `tsc` + production build, plus live browser QA against the production URL using DevTools-protocol viewport emulation and layout measurements (documented per check below), plus source greps for copy-safety.

## 2. Viewports checked

| Viewport | Mode | Result |
|---|---|---|
| 360 px | mobile emulation | PASS |
| 390 px | mobile emulation | PASS |
| 1280 px | desktop | PASS |
| 1440 px | desktop | PASS |

## 3. Passed checks

1. **No horizontal overflow** — at all four widths, `document.documentElement.scrollWidth === clientWidth` (360/360, 390/390, 1265/1265 @1280, 1425/1425 @1440). The Featured Games rail scrolls internally only.
2. **No duplicate / broken navigation** —
   - Mobile (360/390): exactly **one** visible fixed bottom nav (`aria-label="Home mobile"`); the global Navbar's own bottom nav correctly hides on `/`. Home top bar visible; global desktop header hidden below `md` on `/`.
   - Desktop (1280/1440): global Navbar is the single primary nav; the Home `DesktopHeader` is a light contextual strip (no second brand-lockup nav, no duplicate bell after #173). `DesktopSidebar` links only to existing routes (`/`, `/lobby`, `/tournaments`, `/leaderboard`, `/account`).
   - Mobile column is `display:none` at `lg+`; desktop tree is `display:none` below `lg` — the two Home variants never render together.
3. **No unsafe money/reward wording** — rendered-copy scan of the production Home found no "earn money", "Invite & Earn", "real rewards", coin-currency, deposit/withdrawal offers, or "VIEW ALL TOURNAMENTS". The only matches are **negated / disclaiming** copy (see §4).
4. **Wallet remains Soon / Coming Soon only** — mobile bottom nav Wallet = disabled "Soon" item (not a link); desktop sidebar Wallet = disabled "Soon" item (not a link); global Navbar `WalletPill` = "Wallet Coming Soon" linking to the existing read-only `/wallet` Coming-Soon page. No balance shown anywhere; no activation.
5. **Coming-soon games do not link to fake routes** — DOM check on production: Chess444 / Draught444 / Crush444 / Card444 (both the mobile grid and desktop rail instances) render inside `aria-disabled` divs, **not** anchors; data-layer `href` is `""`.
6. **Practice remains Coming Soon** — desktop PRACTICE tile is a disabled non-link with a "Coming Soon" pill. Quick Match / Create Room / Join Room link to `/lobby` only.
7. **Desktop Featured Games rail looks intentional** — native scrollbar hidden (measured 0 px scrollbar height via `.no-scrollbar`), scroll-snap alignment, right-edge fade + trailing spacer soften the card cut-off (PR #173).
8. **Mobile Home matches the locked mobile direction** — 360/390 render the locked order: HomeTopBar (wordmark + ⚡ FREE PLAY + bell) → hero (PLAY FREE) → Quick Match / Create Room cards → Featured Games (Penalty444 live + coming-soon grid) → real-data stats strip (New Player defaults confirmed for logged-out state) → bottom nav. 360 uses the same structure with tightened spacing; no content dropped.
9. **Desktop Home matches the locked desktop direction closely enough** — 1280/1440 render: left sidebar + BETA SEASON / FREE PLAY MODE / GIVE FEEDBACK panel, contextual header, large hero, 4-up quick actions (4 columns confirmed at `xl`), FEATURED GAMES rail, stats strip, RECENT MATCHES + LEADERBOARD panels, right rail with LIVE ARENA (action: **VIEW LOBBY →**) / BETA CHALLENGES / ONLINE PLAYERS / INVITE FRIENDS. All locked labels verbatim.
10. **Vercel/production build passes** — the production URL serves the current Home; locally `npx tsc --noEmit -p apps/web/tsconfig.json` exits 0 and `npm run build` (Next 16) passes with `/` statically prerendered.
11. **Data honesty** — no fake data anywhere: Recent Matches / Leaderboard / Live Arena load real read-only data (or safe branded empty states); ONLINE PLAYERS deliberately shows a "Presence soon" branded state instead of a fabricated count.

## 4. Minor known visual notes (non-blocking)

- **News item mentions "Prize pools … planned for a future release. Not available in beta."** — pre-existing News & Announcements copy (predates the Home UI series). It *disclaims* availability rather than offering rewards, so it is beta-safe, but it is the only place the words "prize pools" render on Home. Optional future cleanup if stricter copy policy is wanted.
- **Hero/footer "No real money · No cash prizes"** — intentional negated safety copy (locked), listed here only because it matches keyword scans.
- **ONLINE PLAYERS panel is a static branded empty state** — by design (presence lives on the realtime server, out of scope for the UI series). A future PR can wire real presence.
- **Desktop right-rail panels load with brief "Loading…" text** — expected client-side fetch behavior; resolves to real data or branded empty states.
- **At exactly 1024–1279 px (`lg` → `<xl`)** — desktop quick actions render 2×2 instead of 4-up; intentional responsive step, looks clean.

## 5. Final recommendation

**READY FOR WIDER BETA HOME UI LOCK** ✅

The Home UI series (#167–#173) is visually complete, beta-safe, honest with data, and stable across the four locked viewports on the live production build. No corrective PR is required; the notes in §4 are optional polish only.

---

*This PR is docs-only: no app code, no layout changes, no backend / Supabase / auth / socket / wallet / tournament / admin / Unity (PR #162) changes. Locked beta-support surfaces untouched.*
