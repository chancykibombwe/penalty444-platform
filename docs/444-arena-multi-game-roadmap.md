# 444 ARENA Multi-Game Roadmap

## 1. Vision

444 ARENA is a competitive online skill-game arena. The platform hosts multiple 1v1 and multiplayer skill games under a single identity — shared profiles, shared rankings, shared tournaments, and eventually a shared economy.

**Penalty444 is the first flagship game, not the whole platform.**

It exists to prove the platform: real-time match infrastructure, server-authoritative result settlement, reconnect-grace handling, ranked progression, leaderboards, and deployment discipline. Every decision made during the Penalty444 beta should be made as if five more games will use the same backend.

The name "444 ARENA" is intentional. It signals that the arena outlasts any single game.

---

## 2. Current Focus: Penalty444 Beta

Before any expansion, Penalty444 must be production-trustworthy. The current priority list:

- Stable real-time matches with clean state machines
- Public rooms (offer-based) and private rooms (invite codes)
- Disconnect/reconnect grace with server-enforced timers — no frontend shortcuts
- Result persistence via `match_results` with correct `winner_id` / `loser_id` / `is_draw`
- `player_stats` ELO progression driven by server (not DB triggers or frontend deltas)
- Global leaderboard using only `player_stats.rank_points` — trusted source
- Account and public profile polish (hero identity, global rank, recent form, achievements)
- Safe wallet/free-play state — `WalletPanel` is read-only; no real money movement yet
- Season leaderboard deferred until `season_player_stats` is aligned with real progression

**Nothing in this list is cosmetic.** Each item is a trust gate for what comes after.

---

## 3. Shared Platform Systems

Every game added to 444 ARENA will rely on the following infrastructure. These systems should be designed with multi-game usage in mind from the start, even when only Penalty444 is live.

| System | Notes |
|---|---|
| **Auth** | Supabase Auth, single account per player across all games |
| **Profiles** | `profiles` + `player_stats` per `game_id` — already parameterised |
| **Global identity** | `CompetitiveProfileCard`, `AchievementGrid`, `RankBadge` are game-agnostic components |
| **Match history** | `match_results` scoped by `game_id` — ready for multi-game |
| **Achievements** | Currently derived from `CompetitiveStats`; future: cross-game achievement catalog |
| **Leaderboards** | Per-game leaderboard first; cross-arena "overall" leaderboard later |
| **Tournaments** | `tournaments` table scoped by `game_id` — designed for reuse |
| **Wallet/economy** | Deferred — must not activate until all games have stable settlement |
| **Moderation** | Not yet started; required before economy activation |
| **Staging/deployment** | Formal staging discipline must precede any wallet or new-game rollout |

The `game_id = "penalty444"` column exists throughout the schema precisely because more games are planned.

---

## 4. Game 1: Penalty444

**Status:** Web beta, live.

### Current web version
- Real-time 5-round penalty shootout (player vs player)
- Server-authoritative shot resolution (`resolveShot`, `resolveRound`)
- Public offers visible in the lobby; private rooms via invite code
- ELO-based `rank_points` progression with placement period (first 10 matches)
- Tier ladder: Bronze → Silver → Gold → Platinum → Diamond → Elite → Champion
- Global leaderboard, public player profiles, head-to-head stats, rivalry system
- `WalletPanel` renders in free-play mode; no wallet writes

### Tournaments
Tournaments are schema-ready (`tournaments` table, `winner_id`, bracket support) but not fully productionised. Tournament readiness is a near-term priority before moving on to new games.

### Unity 3D — future
A Unity client for Penalty444 is planned as a premium game experience. See Section 5 for build phases.

---

## 5. Unity 3D Penalty444

Unity comes **after** core platform trust is established. The backend contracts (socket events, match state machine, result settlement) must be stable and documented before any Unity client connects to them. Unity is a client skin, not a replacement.

### Why Unity, not just web
The web version proves the game is fun and fair. Unity adds:
- 3D stadium, goalkeeper, ball physics, crowd, animations
- Celebrations and cosmetics (skins, kits, boots)
- Native mobile experience (iOS/Android via Unity Mobile)
- Spectator replays using recorded shot/result data

### Build phases

| Phase | Scope |
|---|---|
| **1. Offline scene** | Unity project with 3D penalty scene, local AI goalkeeper, no backend. Proves assets and feel work. |
| **2. Backend-connected prototype** | Unity client connects to existing WebSocket server using same socket events as the web client. Auth via Supabase token. |
| **3. Mobile app shell** | Unity Mobile target. Camera angles, touch input, haptics. App store prototype. |
| **4. Cosmetics** | Skins, stadiums, celebrations, seasonal kits. Economy-gated if wallet is live by then. |

### Rules
- Do not change the backend socket API to suit Unity. Unity adapts to the server.
- Unity replays must use stored `match_results` data, not client-side simulation.
- Do not ship Unity to production before the web version has completed at least one full tournament cycle.

---

## 6. Game 2: Crush Duel / 444 Crush Duel

**Status:** Planned.

A 1v1 real-time puzzle battle in the style of Candy Crush — but skill-based, competitive, and with a clear winner. The name is working; the final branding must not reference Candy Crush Saga or King's trademarks.

### Concept
- Both players receive the same procedurally generated board (same seed, fairness guaranteed)
- Match timer: 30s or 60s (configurable per game mode)
- Each player makes moves independently on their own copy of the board
- Highest score at timer end wins; draws possible
- Chain combos and cascade bonuses rewarded
- No direct interaction with the opponent's board (no PvP attacks initially)

### Technical requirements

| Area | Requirement |
|---|---|
| **Board generation** | Deterministic seeded RNG; same seed sent to both clients at match start |
| **Move validation** | Server validates every move or client sends full move log for post-game audit |
| **Scoring** | Match-points per cleared tile, multipliers for combos |
| **Combo engine** | Cascade detection, special tile logic, bonus triggers |
| **Timer** | Server-issued `expiresAt` timestamp; no client countdowns |
| **Result settlement** | Server compares final scores, writes `match_results` with `game_id = "crush_duel"` |
| **Anti-cheat** | Replay validation: server replays move log against board to verify final score |
| **Ranked mode** | Server-authoritative score submission only; client score display is optimistic |

### Economy note
Crush Duel is the most obvious candidate for casual wagered games once the economy is live. **Do not rush this.** Anti-cheat and server-authoritative scoring must be watertight before any stakes are involved.

---

## 7. Game 3: Draughts (Checkers)

**Status:** Planned.

A classical turn-based strategy game. Straightforward enough to build quickly, culturally resonant in African markets, and a good test of the shared tournament and matchmaking systems.

### Requirements

| Area | Requirement |
|---|---|
| **Move validation** | Server-side legal-move engine (no client trust) |
| **Captures** | Single and multi-jump captures; mandatory capture rule |
| **Promotions** | Pawn reaching back rank becomes King with full diagonal movement |
| **Timers** | Per-turn clock (e.g. 30s/move) with increment; server-issued |
| **Reconnect** | Standard disconnect-grace; board state serialised in match session |
| **Result** | Win by elimination or opponent time-out; draw by repetition or agreement |
| **Ranking** | Uses same `player_stats` + ELO system as Penalty444, scoped to `game_id = "draughts"` |

---

## 8. Game 4: Chess

**Status:** Planned (later than Draughts).

Chess is the deepest strategy mode and the most demanding technically. It should follow Draughts, which validates the board-game infrastructure.

### Requirements

| Area | Requirement |
|---|---|
| **Legal move engine** | Full FIDE ruleset: castling, en passant, promotion, repetition, 50-move rule |
| **Clock modes** | Bullet, blitz, rapid time controls with increment; server-authoritative |
| **End conditions** | Checkmate, stalemate, insufficient material, threefold repetition, 50-move draw, agreement |
| **Anti-cheat** | Engine detection is a hard requirement before ranked Chess is live |
| **Ranking** | Same ELO system scoped to `game_id = "chess"` |
| **Tournaments** | Chess is the most natural fit for structured bracket and Swiss-system tournaments |
| **Spectators** | Live game observation; analysis/replay after completion |

---

## 9. Leaderboards and Seasons

### Current state
- **Global leaderboard** (`/leaderboard`): trusted, uses `player_stats.rank_points`, placement filter applied, correct.
- **Season leaderboard**: hidden/deferred. `season_player_stats.rank_points` uses flat `+3/+1/-1` DB trigger deltas that do not match the server ELO system. Not shown until this is fixed.

### Future

| Leaderboard | Scope | Prerequisite |
|---|---|---|
| Global All-Time | Per game | Already live for Penalty444 |
| Season | Per game | Fix `season_player_stats` to mirror real ELO; add placement filter |
| Cross-arena overall | All games | After ≥2 games are live and stable |
| Friends | Per game | After social graph is built |

Seasons should reset ELO or at minimum provide a seasonal snapshot. The reset strategy (soft reset, hard reset, or separate season rating) must be designed before seasons are activated. Season 1 must not start with broken rank data.

---

## 10. Wallet / Economy

The wallet system exists in the schema (`wallets`, `wallet_ledger`, `escrow_locks`, `public_offers`) and the UI renders a safe free-play state. **No real money movement is active.**

### Prerequisites before any economy activation

All of the following must be true before enabling real stakes:

- [ ] All active games have stable disconnect/reconnect with no contested result paths
- [ ] Server-authoritative result settlement has been audited with no known bypass
- [ ] Dispute resolution flow is designed and documented
- [ ] Moderation tooling exists (flag, review, ban)
- [ ] Staging environment is fully separate from production with deployment gate
- [ ] Legal review for relevant jurisdictions is complete
- [ ] Anti-cheat for any game involving stakes is deployed and validated
- [ ] Escrow lock/release cycle tested under concurrent load

### Economy scope

When activated, the wallet should support all games without per-game rewrites. The `public_offers` table already includes `game_id`. Economy features:

- Skill-game wagers (not gambling — outcome based on player performance, not chance)
- Entry fees for paid tournaments
- Cosmetic purchases (Unity skins, profile frames, etc.)
- No loot boxes; no randomised pay-to-win mechanics

---

## 11. Suggested Build Order

This is the recommended sequencing. Do not skip steps.

| Step | Work |
|---|---|
| **1** | Finish Penalty444 beta trust: reconnect edge cases, result integrity, full match lifecycle |
| **2** | Tournament readiness: bracket engine, seeding, progression, notifications |
| **3** | Account and public profile polish: hero identity, achievements, head-to-head, share links |
| **4** | Season leaderboard fix: align `season_player_stats` with real ELO; add placement filter |
| **5** | Formal staging/deployment discipline: staging branch, deploy gate, migration review process |
| **6** | Multi-game architecture audit: review all queries for `game_id` scoping, extract shared hooks |
| **7** | Unity offline prototype: no backend, just assets and feel |
| **8** | Crush Duel web prototype: board generation, move validation, timer, result settlement |
| **9** | Draughts prototype: legal move engine, clock, reconnect, ELO scoped to draughts |
| **10** | Chess prototype: full ruleset, anti-cheat requirement gates progression |
| **11** | Wallet/economy activation: only after all prerequisite checklist items are complete |

---

## 12. Agent Guidance

Rules for AI agents working on the 444 ARENA codebase:

1. **Do not treat Penalty444 as the only product.** Database tables, socket events, and components should remain game-agnostic where possible. The `game_id` column is not decorative.

2. **Do not start the economy.** Do not write to `wallets`, `wallet_ledger`, or `escrow_locks`. Do not remove the "coming soon" gates from `WalletPanel`. Do not create real-money offer flows. The prerequisites in Section 10 must be checked off first.

3. **Do not start Unity.** Do not create Unity project files, modify the socket protocol for Unity compatibility, or add Unity-specific endpoints. Unity work begins only after the backend contracts are stable and documented.

4. **Do not show untrusted season stats.** `season_player_stats.rank_points` uses flat DB trigger deltas, not ELO. Do not render Season Rank, Season RP, or Season Tier until this is fixed.

5. **One branch, one PR, one focused task.** Do not combine gameplay changes with UI changes. Do not combine schema migrations with frontend polish. Small, reviewable, reversible.

6. **Preserve master as the source of truth.** All deployments come from master. Feature branches merge via PR. Do not commit secrets, do not force-push to master, do not skip type checks.

7. **Server authority is non-negotiable.** Do not move result resolution, scoring, timer expiry, or progression to the client. All game outcomes are decided by the server.

8. **Reconnect grace is sacred.** Do not modify disconnect timers, grace window logic, or pick-lock behaviour without a full review of the match state machine. A submitted pick must stay submitted even if the player disconnects.

9. **Ask before touching shared infrastructure.** Changes to auth, the profiles schema, `match_results`, `player_stats`, `tournaments`, or the socket event protocol affect every current and future game. Scope changes narrowly and document them.

10. **The platform serves players, not the other way around.** Prioritise fairness, data correctness, and stability over feature velocity. A broken ranked match destroys trust faster than a missing feature loses users.
