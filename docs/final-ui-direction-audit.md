# Final UI / Launch Look — Direction Audit

**Phase:** Final UI / Launch Look (Priority 1)
**Status:** Direction audit — docs-only, no code changes
**Goal:** Make 444 ARENA look premium and ready for wider public beta / investor sharing.

---

## 0. Scope & guardrails

**In scope (the main product experience):**

- Home / landing page
- Main navigation (Navbar + mobile bottom nav)
- Lobby visual hierarchy
- Match room presentation
- Game cards / future games
- Mobile layout (360–390px)
- Brand consistency (color tokens, typography, spacing)

**Explicitly OUT of scope — LOCKED beta-support phase (do not reopen / do not polish):**

- Beta Guide (`/beta-guide`)
- Lobby Help shortcuts
- Account Feedback helper + panel
- Match-End Feedback UI

**Hard rules for every Final-UI PR that follows:**

- No backend, game-logic, socket, Supabase, RLS, auth, wallet/economy, tournament, or realtime-server changes.
- Free Play beta policy stays locked — no money / prize / stake / deposit / withdrawal wording.
- Unity / 3D stays a **parallel, feature-flagged sandbox** (`MatchRenderer3D`, `NEXT_PUBLIC_UNITY_MATCH_ENABLED`, default off). Final UI must **not** depend on or wait for 3D, and 3D must not block public beta.

**Method & caveat:** this audit is **source-grounded** (current `master`). It is *not* screenshot-based — the production URL is not reachable from the build environment, so visual specifics should be confirmed against the live site before each area PR.

---

## 1. Executive read

The platform is **functionally green** and already had two rounds of UI work (the "final" match room PR #131, the home redesign PR #132, plus assorted polish). It does **not** look unfinished — but it is not yet **launch-premium**. The gap is consistency and first-impression density, not missing screens.

Three themes dominate the gap to "premium":

1. **Brand tokens exist but aren't used.** `globals.css` defines a clean `arena-*` palette, yet components hardcode raw hex (`#3B9EFF` appears ~29×, `#E0A000` ~8×, etc.). The look is *close* but drifts card-to-card. Consolidating onto tokens is the single highest-leverage consistency win.
2. **The app still defaults to a light (white) theme.** `:root { --background: #ffffff }` with a dark override only under `prefers-color-scheme: dark`. Pages compensate with full-bleed dark wrappers, but this is the root cause of the PR #152 "blank button" bleed and is a latent trust/quality risk. A launch app should own its dark arena theme unconditionally.
3. **The home page is dense.** It carries ~10 stacked sections. For a tester it's fine; for an investor/first-time visitor the hero + primary CTA can get diluted. The narrative needs tightening, and live-activity strips need strong empty states (a small beta will often have little live data).

---

## 2. Surface-by-surface findings

### 2.1 Home / Landing — *biggest first-impression lever*

**Current sections (in order):** HeroBanner → Continue Playing → Live Game (Penalty444) → More Games → Player Stats → How It Works → Tournament Preview → Featured Live Matches → Global Activity Feed → News & Announcements → Support.

**Strengths:** strong hero (PR #132/#151), clear primary CTA ("▶ Play Free"), Free Play safety copy, real game card for Penalty444.

**Gaps to premium:**

- **Density / narrative.** 10 sections is a lot. Consider an investor/first-visit narrative: Hero → What it is (1 line) → Play Penalty444 → More games (Coming Soon) → Social proof (live/activity, *only if non-empty*) → How it works → News/Support. Some strips may be better collapsed or moved below the fold.
- **Empty-state quality.** Featured Live Matches / Global Activity Feed / Player Moments can look broken or sparse during a small beta. These need deliberate, branded empty states (they were a noted risk in earlier audits).
- **Hero could feel more premium** (depth, motion restraint, a single confident focal point) without becoming heavy.

### 2.2 Main navigation

**Current:** desktop top bar (Home / Lobby / Tournaments / Leaderboard / Account) + mobile 5-col bottom nav, brand "444" gradient chip, admin link (gated), wallet "Coming Soon" pill, notification bell, resume-match pill.

**Strengths:** consistent, accessible (`focus-visible`), auth-aware, mobile bottom nav is solid.

**Gaps:** bottom nav is **full** (5 cols) — no room for new items without a redesign (this is why Beta Guide went into Account, correctly). Brand mark is minimal; a launch look may want a slightly more distinctive wordmark/logo treatment. Active-state styling is good but uses mixed accent colors (cyan vs gold) — fold into the token pass.

### 2.3 Lobby visual hierarchy

**Current:** Ranked matchmaking (primary) → Public offers → Private rooms (Create/Join) → sidebar (Beta Help [locked], Play Again, Arena Chat).

**Strengths:** all the play paths are present and working.

**Gaps:** reads **utilitarian** rather than premium — stacked panels of similar visual weight. The *primary* play action (find a match) should dominate; secondary actions (private room, join code) should visibly recede. Atmospheric background exists but the panels themselves are flat. A hierarchy + spacing pass would make it feel intentional. (Note: the Beta Help card in the sidebar is **locked** — leave it.)

### 2.4 Match room presentation

**Current:** already received a "final visual upgrade" (PR #131) + scoreboard round checklist (PR #155). Result screen, lane picker, pre-start waiting card, sudden-death styling.

**Strengths:** the strongest surface — arena feel, score hierarchy, kicker emphasis, responsive.

**Gaps (smaller):** pre-start "waiting for opponent" card and the victory/defeat/draw result card are the highest-value polish targets for a "wow" moment. Mobile reveal pacing is already hardened. (The Match-End **Feedback link** is **locked** — do not touch that specific element.) This is also the surface 3D eventually upgrades, so keep DOM changes additive and flag-compatible.

### 2.5 Game cards / future games

**Current:** `GameCard` component; `COMING_SOON_GAMES = [Chess444, Draught444, Crush444]`.

**Concrete gaps:**

- **Card444 is missing** from `COMING_SOON_GAMES`, but it *is* listed in the Beta Guide / beta policy. **Brand inconsistency — fix.**
- **Coming-soon cards link to `/`** (`href: "/"`). Tapping a "Coming Soon" game silently navigates home — confusing. Make them non-navigational (or a proper "Coming Soon" affordance) so they read as intentionally inactive.
- Cards are good but could use a more premium, consistent treatment (consistent icon framing, status pill, glow) under the token pass.

### 2.6 Mobile layout

**Current:** substantial mobile hardening already (match usability PR #118/#119, admin mobile PR #149, per-surface `sm:` breakpoints).

**Gaps:** no *systematic* launch pass. Recommend one deliberate sweep at **360 / 375 / 390px** across Home, Lobby, Match room, Tournaments, Leaderboard, Account — checking horizontal overflow, tap targets (≥40px), and that primary CTAs sit above the fold and clear of the bottom nav.

### 2.7 Brand consistency — *highest-leverage systemic win*

**Findings:**

- A token system **exists** in `globals.css @theme inline` (`--color-arena-bg/surface/border/primary/purple/green/gold/red/muted`) but components mostly **hardcode hex**. Result: subtle drift.
- **Too many accent colors in play** across surfaces (cyan/blue `#3B9EFF`, gold `#E0A000`, emerald `#22C55E`, violet `#8B5CF6`, plus fuchsia/amber variants). A premium look needs a tight, *rule-based* palette: one primary, one competitive accent, one success/beta accent — used consistently.
- **Light-mode default** (`--background: #ffffff`) should be retired in favor of an always-dark arena theme so the product never flashes/bleeds white.

---

## 3. Recommended PR sequence (small, one area at a time)

> Numbering note: this audit is PR **#163** (the Unity B1 stub took #162), so the area PRs open at **#164+**. Each is small, additive, React-only, and excludes the locked beta-support surfaces.

| PR | Area | Goal / definition of done |
|---|---|---|
| **#164 — Brand foundation** | globals.css tokens + dark default | Retire white default → always-dark arena theme; document the palette rules (primary / competitive / beta accents). No per-component redesign yet. Low risk, unblocks consistency. |
| **#165 — Home / Landing final look** | `page.tsx`, home components | Tighten section narrative & density; premium hero; strong branded empty states for live/activity strips. |
| **#166 — Lobby final look** | `lobby/page.tsx`, lobby panels | Clear primary-vs-secondary hierarchy; primary "find match" dominates; spacing/weight pass. (Leave the locked Beta Help card.) |
| **#167 — Match room final look** | match presentation components | Polish pre-start waiting card + victory/defeat/draw result card for a "wow" moment. Additive & 3D-flag-compatible. (Leave the locked Match-End feedback link.) |
| **#168 — Game cards / future games** | `GameCard`, `COMING_SOON_GAMES` | Add Card444; make coming-soon cards intentionally inactive (no silent `/` nav); consistent card treatment. |
| **#169 — Mobile launch sweep** | cross-surface classes only | One systematic 360–390px pass for overflow / tap targets / above-the-fold CTAs across the main surfaces. |

Start with **#164 (brand foundation)** — it's low-risk, systemic, and makes every later PR cleaner.

---

## 4. Approved decisions (resolved)

These are the agreed answers that drive the area PRs:

1. **Brand identity:** a premium **text-based "444 ARENA" wordmark** for now (no logo mark yet). Visual language: **dark arena, neon cyan/blue primary, a controlled gold accent** for competitive moments.
2. **Primary audience:** **wider beta testers first**, investor/public-safe second. → keep utility prominent; stay launch-presentable, but don't over-index on investor polish yet.
3. **Future games:** **Penalty444 active**; **Chess444, Draught444, Crush444, Card444** all "Coming Soon" (Card444 must be added to `COMING_SOON_GAMES`).
4. **Theme:** commit to an **always-dark arena theme** (drop OS-preference / light-mode default).

---

## 5. 3D status (parallel, not blocking)

Unity / 3D stays **Phase B sandbox only**: feature-flagged (`NEXT_PUBLIC_UNITY_MATCH_ENABLED`, default off), not connected to live gameplay, server remains the single source of truth. The Final UI phase proceeds independently and must not wait on it. After the final UI is strong, 3D returns as the next major upgrade.
