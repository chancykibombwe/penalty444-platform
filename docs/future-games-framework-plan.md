# Future Games Framework Plan

> Status: **Planning** — Penalty444 is the only live game. This document
> defines the technical architecture for adding future games to 444 ARENA
> without breaking the current beta.
>
> Companion documents:
> - `docs/444-arena-multi-game-roadmap.md` — vision, build order, game concepts
> - `docs/unity-3d-prototype-plan.md` — Penalty444 3D renderer plan
> - `docs/wallet-architecture-guardrails.md` — economy architecture

---

## 1. Purpose

444 ARENA is a multi-game competitive skill arena. Penalty444 is the first
live game and the platform's trust proof. The architecture of auth, rooms,
matchmaking, tournaments, leaderboards, and progression must be designed to
support multiple games from the start — even while only one game is live.

This document defines:

1. The technical game adapter interface that separates game-specific logic
   from the shared platform infrastructure.
2. The routing and database design that scales to multiple games.
3. A game registry model that makes available/coming-soon state explicit and
   server-authoritative.
4. The realtime architecture options for multi-game isolation.
5. The guardrails that prevent future games from appearing as live or playable
   before they are ready.

**No second game is implemented by this PR.** Every code example and schema
in this document is architecture-only.

---

## 2. Current Game Model (Penalty444)

### Stack

| Layer | Role |
|---|---|
| `apps/web` (Next.js 15) | React UI, routing, Supabase auth client, socket client |
| `apps/realtime-server` (Node.js) | Socket.IO server — game authority, room state, result settlement |
| Supabase (PostgreSQL) | Auth, persistent game state (`match_results`, `player_stats`, `tournaments`) |

### Penalty444 match lifecycle

1. Player authenticates via Supabase (`apps/web/src/lib/auth/playerIdentity.ts`).
2. Player creates or joins a room via Socket.IO (`room:create` / `room:join`).
3. Server assigns `KICKER` / `KEEPER` roles per round. Match state lives in
   an in-memory `Room` object (`apps/realtime-server/src/types/room.ts`).
4. Each round: server starts a pick timer (`match:status`). Both clients
   independently emit `match:pick` with a `Lane` (`LEFT | CENTER | RIGHT`).
5. Server calls `resolveShot()` — the authoritative outcome function — and
   broadcasts `match:update` with the round result.
6. After `maxRounds` or sudden-death resolution: server emits `match:end` /
   `match:result`, persists to `match_results`, applies rank point delta to
   `player_stats`, and advances tournament bracket if applicable.
7. Rematch: server handles `match:rematch` votes; resets room state in-place.

### What is already multi-game-ready

- `match_results.game_id` — every result row is scoped to a game string.
- `player_stats.game_id` — rank points, wins, losses, draws are per game.
- `tournaments.game_id` — tournaments reference a specific game.
- The `GameCard` component (`src/components/home/GameCard.tsx`) supports
  `status: "live" | "coming-soon"` and `comingSoon: boolean` — already
  correctly gating future games.

### What is hardcoded to Penalty444 today

- `game_id = "penalty444"` is hardcoded in the realtime server's
  `progression.ts` and `index.ts`.
- The realtime server has no game type routing — all connections go to the
  Penalty444 match state machine.
- The match room components (`MatchRoomPanel`) are Penalty444-specific.
- The `Room` type in `types/room.ts` contains Penalty444-specific fields
  (`Lane`, `Role`, `picks`, `scores`, `maxRounds`).

---

## 3. Multi-Game Principle

> **Each game owns its rules. The platform owns everything else.**

The platform provides:

| Platform system | Responsibility |
|---|---|
| **Auth** | Single Supabase account across all games |
| **Matchmaking** | Queue, public offers, private rooms — game-agnostic routing |
| **Rooms** | Room creation, lifecycle, reconnect grace, spectators |
| **Tournaments** | Bracket engine, entry, advancement, results — game_id scoped |
| **Leaderboards** | Per-game ranking, placement, tier labels |
| **Player profiles** | Shared identity; per-game stats alongside global profile |
| **Admin tools** | Health, match log, player snapshot — game_id filterable |
| **Wallet** | Future: shared ledger, per-game entry fees and payouts |
| **Observability** | Logs, alerts, audit trail — game-agnostic |

Each game provides:

| Game system | Responsibility |
|---|---|
| **Game adapter** | Initial state, action validation, timeout handling, result determination |
| **Match renderer** | React component(s) that present the game to the player |
| **Action schema** | The set of valid player actions for this game |
| **State serializer** | Public state (safe to broadcast) vs private state (hidden per player) |

---

## 4. Game Registry Concept

A future `games` table (or server-side configuration object) defines every
game the platform knows about. It controls routing, UI availability, and
feature support — making game status server-authoritative rather than
scattered across frontend constants.

### Proposed registry shape

```typescript
type GameStatus = "live" | "beta" | "coming_soon" | "disabled";

type GameRegistryEntry = {
  // Identity
  game_id: string;            // "penalty444" | "draughts444" | "chess444" | "crush444"
  slug: string;               // URL slug: "penalty444", "draughts", "chess", "crush"
  display_name: string;       // "Penalty444", "Draught444", "Chess444", "Crush444"
  icon: string;               // Emoji or asset key: "⚽", "🪙", "♟", "💥"

  // Availability
  status: GameStatus;         // Controls UI badge and route access
  available_since?: string;   // ISO date — only set when status becomes "live"

  // Match configuration
  min_players: number;        // 1 (solo puzzle) or 2 (1v1)
  max_players: number;        // 2 for all current planned games
  turn_based: boolean;        // false for Penalty444, true for Chess/Draughts

  // Feature flags (what platform systems this game uses)
  supports_ranked: boolean;
  supports_private_rooms: boolean;
  supports_public_lobby: boolean;
  supports_tournaments: boolean;
  supports_spectators: boolean;
  supports_rematch: boolean;

  // Routing
  route_path: string;         // "/games/penalty444"
  lobby_path: string | null;  // "/lobby" for Penalty444; null if not applicable
  rules_path: string | null;  // Link to rules docs or in-app page

  // Realtime
  realtime_game_type: string; // Used by server to route to the right adapter
  renderer_component: string; // React component key for the match renderer
};
```

### Current registry state (documentation only)

| game_id | status | supported |
|---|---|---|
| `penalty444` | `live` | ranked, private rooms, public lobby, tournaments, spectators, rematch |
| `chess444` | `coming_soon` | — |
| `draughts444` | `coming_soon` | — |
| `crush444` | `coming_soon` | — |
| `card444` | `coming_soon` | — |

### Implementation options

**Option A — Database table (`games`):** Server-authoritative. The UI fetches
the registry on load. Game status changes deploy without a code push.
Preferred long-term.

**Option B — Server-side config object:** A TypeScript constant in the
realtime server and/or a Next.js RSC module. Simpler to start with; requires
a deploy to change status.

**Option C — Environment variable per game:** `CHESS444_STATUS=coming_soon`.
Too fragile for multiple games.

**Recommendation:** Start with Option B (config object) during the prototype
phase. Migrate to Option A (database table) when the second game approaches
launch. The `GameCard` component already reads a data array — only the data
source changes.

---

## 5. Game Adapter Interface

Each game on the realtime server must implement a `GameAdapter` interface.
The adapter is the only place game-specific logic lives. The platform's room,
matchmaking, tournament, and settlement systems call the adapter — they do not
branch on game type.

### Adapter interface (pseudocode / documentation only)

```typescript
interface GameAdapter<TState, TAction> {
  /**
   * Create initial game state when a match begins.
   * Called once per match; result stored in the Room.
   */
  createInitialState(players: RoomPlayer[], config: MatchConfig): TState;

  /**
   * Return true if the proposed action is legal in the current state.
   * Called before applyAction. Server rejects illegal actions.
   */
  isValidAction(state: TState, action: TAction, playerId: string): boolean;

  /**
   * Apply a validated action; return the new state.
   * Must be a pure function — no side effects, no I/O.
   */
  applyAction(state: TState, action: TAction, playerId: string): TState;

  /**
   * Called when a player's turn timer expires without an action.
   * Returns the state after timeout (e.g. auto-forfeit, random move, etc.)
   */
  handleTimeout(state: TState, timedOutPlayerId: string): TState;

  /**
   * Return true when the match has reached a terminal state.
   * Platform calls this after every applyAction and handleTimeout.
   */
  isMatchOver(state: TState): boolean;

  /**
   * Return the match result: winner id, draw flag, or null (in progress).
   * Only called when isMatchOver() returns true.
   */
  getResult(state: TState): MatchResult;

  /**
   * Serialize state safe to broadcast to all connected players.
   * Strips hidden information (e.g. opponent's hand in a card game).
   */
  getPublicState(state: TState): unknown;

  /**
   * Serialize state for a specific player (includes that player's
   * private information only — never the opponent's).
   */
  getPlayerState(state: TState, playerId: string): unknown;

  /**
   * Return true if a rematch is allowed from this terminal state.
   * Penalty444: always true. Chess/Draughts: true. Crush: possibly true.
   */
  supportsRematch(state: TState): boolean;

  /**
   * Produce the row to insert into match_results.
   * Called by the platform after result is confirmed.
   */
  toMatchResultRow(
    state: TState,
    room: Room,
    result: MatchResult
  ): MatchResultInsert;
}
```

### Penalty444 adapter mapping

| Adapter method | Penalty444 equivalent today |
|---|---|
| `createInitialState` | Room initialisation in `rooms.ts` (`roles`, `picks`, `scores`, `round`) |
| `isValidAction` | `isValidLane()` check in `matchPresentation.ts` (client); implicit server validation |
| `applyAction` | `match:pick` handler in `matchActions.ts` |
| `handleTimeout` | `timers.ts` → auto-pick or forfeit logic |
| `isMatchOver` | `matchOutcome.ts` → `isMatchOver()` |
| `getResult` | `matchOutcome.ts` → winner/draw determination |
| `getPublicState` | `match:update` payload — already omits private pick until revealed |
| `getPlayerState` | `match:status` payload — player sees own pick only |
| `supportsRematch` | `room:rematch` always supported for Penalty444 |
| `toMatchResultRow` | `matchActions.ts` → `saveMatchResult()` |

The adapter interface is a formalisation of what already exists. Refactoring
to this interface for Penalty444 is a future migration task — not a beta task.

---

## 6. Shared Platform Lifecycle

Every game on 444 ARENA follows this shared lifecycle. Game-specific
behaviour is isolated to the adapter steps (marked with ★):

```
1. Player authenticates (Supabase auth — shared)
2. Player selects game (game registry lookup — shared)
3. Player joins queue or creates room (matchmaking — shared)
4. Server creates room; calls adapter.createInitialState() ★
5. Server notifies clients: game-specific initial state via adapter.getPlayerState() ★
6. Client renders match using game-specific renderer ★

--- match loop ---
7. Player submits action (game-specific action type ★)
8. Server calls adapter.isValidAction() ★ — reject if false
9. Server calls adapter.applyAction() ★
10. Server broadcasts adapter.getPublicState() to all (shared broadcast)
11. Server sends adapter.getPlayerState() to each player (shared routing)
12. If adapter.isMatchOver(): go to step 13, else return to step 7

--- finalisation ---
13. Server calls adapter.getResult() ★
14. Server calls adapter.toMatchResultRow() ★ → inserts to match_results (shared)
15. Server applies rank point delta via progression system (shared, game_id scoped)
16. If tournament match: server advances bracket (shared)
17. Server emits match:result to clients (shared)
18. Clients display post-match screen using game-specific renderer ★
```

Steps 1–3, 10–11, 14–17 are shared platform code. Steps 4–9, 12–13, 18 call
the game adapter.

---

## 7. Game-Specific Differences

### Penalty444 (live)

- Simultaneous picks: both players act in the same round without seeing the
  opponent's choice. No turns.
- Very short rounds (10 s pick window). Fast lifecycle — a 5-round match
  takes under 3 minutes.
- Sudden death tiebreak.
- No hidden information — public state can be broadcast immediately.
- Adapter complexity: low. `isValidAction` is a single lane check.
- Anti-cheat: server resolves `resolveShot(kickerLane, keeperLane)` — client
  cannot influence the result.

### Chess444 (planned)

- Strictly turn-based: one player acts at a time.
- Legal move validation is the most complex adapter of all planned games.
  Requires a full FIDE ruleset engine: castling, en passant, promotion,
  threefold repetition, 50-move rule, insufficient material.
- Clock modes: bullet (< 3 min), blitz (3–10 min), rapid (> 10 min) with
  increment. Server-authoritative clock.
- End conditions: checkmate, stalemate, draw by repetition/agreement/timeout.
- Resign: player may concede at any time.
- **Anti-cheat is a hard gate.** Engine detection (computer assistance) must
  be solved before ranked Chess is live. Do not launch ranked Chess without
  this.
- Spectators are natural for Chess — live observation, post-game analysis.
- Consider an existing open-source legal-move library (e.g. `chess.js`)
  running server-side inside the adapter.

### Draught444 / Checkers444 (planned — recommended second game)

- Turn-based. Simpler legal-move space than Chess.
- Mandatory capture rule (player must capture if a capture is available in
  most variants). Must be enforced server-side.
- Single and multi-jump captures.
- King promotion when a piece reaches the back rank.
- End conditions: elimination, no legal moves, draw by agreement or
  repetition.
- Resign and timeout supported.
- Anti-cheat: lower risk than Chess — no known widely-used checkers engines
  at the level that Chess engines operate.
- A good second game because: similar turn-based adapter shape to Chess,
  lower legal-move complexity, no engine-detection requirement for launch.

### Crush444 (planned — after board games)

- Puzzle/score-race. Both players receive the same deterministic board
  (same seed, server-issued at match start).
- Asynchronous in structure: players make moves on their own copy of the
  board simultaneously.
- Timer-based: match ends at `expiresAt` (server-authoritative timestamp),
  not on a player action.
- Server validates the complete move log post-match (replay audit) to
  confirm the final score.
- Anti-cheat is critical: without server-side replay validation, score
  manipulation is trivial.
- No "turn" concept — the adapter's `handleTimeout` doubles as the
  match-end trigger.

### Card444 (planned — after Crush444)

- Hidden information: each player holds a hand the opponent cannot see.
  The adapter must never include opponent hand state in `getPublicState()`.
- Server-side deck authority: shuffling and dealing must occur server-side.
  Client cannot influence the shuffle.
- Anti-collusion: two players can coordinate to exploit game state if results
  are visible during play. The adapter must enforce information hiding strictly.
- Game variant flexibility: the rules of Card444 may vary (e.g. different
  trick-taking or matching variants). The adapter interface supports this by
  accepting a `config` object in `createInitialState`.
- Most complex anti-cheat and hidden-state requirements. Should wait until
  the adapter framework is proven on simpler games.

---

## 8. Realtime Architecture Options

### Option A — Single Socket.IO server with game-type routing (recommended)

The existing realtime server gains a `gameType` field on each room. Incoming
actions are routed to the appropriate adapter based on `room.gameType`. All
platform logic (auth, reconnect, forfeit, tournament, settlement) is shared.

```
connection → auth → room lookup → gameAdapter[room.gameType].isValidAction(...)
```

**Pros:** Reuses all existing auth, reconnect, and settlement logic. One
deployment. Shared metrics and logging.  
**Cons:** Game adapters share the same Node.js process — a buggy adapter
could affect other games. Mitigated by sandboxing adapter errors.

### Option B — Separate Socket.IO namespaces per game

Each game runs on a distinct namespace (`/penalty444`, `/chess444`). The
server process is shared but event namespaces are isolated.

**Pros:** Cleaner isolation of event handlers. Game-specific socket
middleware possible.  
**Cons:** Auth middleware and session management must be duplicated per
namespace. More complex deployment configuration.

### Option C — Separate server processes per game

Each game has its own Node.js process and deployment. Platform systems
(auth, tournament) run as separate services the game servers call into.

**Pros:** Full isolation — a Chess444 outage cannot affect Penalty444.
Independently scalable.  
**Cons:** Requires a service mesh, inter-service auth, and shared state
coordination. Significant operational overhead. Not needed until traffic
demands it.

### Recommendation

**Start with Option A** for all games up to the third or fourth live title.
Introduce Option B namespaces if per-game event isolation becomes valuable.
Consider Option C only when independent scaling or deployment isolation is
required by traffic.

The transition from A to B is low-risk: the adapter interface is unchanged,
only the routing layer moves from `room.gameType` branching to namespace
prefixes.

---

## 9. Routing and Frontend Architecture

### Current routes

| Route | Purpose |
|---|---|
| `/` | Home — game selector strip + stats |
| `/play` | Simple game/lobby picker for Penalty444 |
| `/lobby` | Penalty444 lobby (matchmaking, public offers, ranked queue) |
| `/match/[roomCode]` | Penalty444 match room |
| `/games/penalty444` | Penalty444 game hub page |
| `/leaderboard` | Penalty444 leaderboard |
| `/tournaments` | Penalty444 tournaments |
| `/tournaments/[id]` | Penalty444 tournament detail |

### Future route structure (options)

**Option 1 — Game-namespaced routes**
```
/games/[slug]               → game hub (replaces /games/penalty444)
/games/[slug]/lobby         → game-specific lobby
/games/[slug]/match/[code]  → match room with game-specific renderer
/games/[slug]/leaderboard   → per-game leaderboard
/games/[slug]/tournaments   → per-game tournaments
```

**Option 2 — Keep current top-level routes, add game_id filter**
```
/lobby?game=penalty444      → existing lobby, filtered
/leaderboard?game=chess444  → leaderboard filtered to chess
/tournaments?game=draughts  → tournaments filtered
```

**Option 3 — Hybrid (recommended)**
- Keep `/lobby`, `/leaderboard`, `/tournaments` as Penalty444-default routes
  during beta (no breaking changes).
- Add `/games/[slug]` hub pages per game as they approach launch.
- When ≥2 games are live, introduce a `/games` index page as the primary
  entry point. The current `/play` page can redirect there.
- `/match/[roomCode]` remains universal — the renderer component is selected
  based on the game type embedded in the room/match record.

### Current route stability guarantee

**No existing Penalty444 routes change as part of multi-game work.**
`/lobby`, `/match/[roomCode]`, `/leaderboard`, `/tournaments`, and
`/games/penalty444` must continue to resolve identically after any
multi-game routing layer is added.

---

## 10. Database Architecture Plan

### What already exists and is multi-game-ready

| Table | `game_id` column | Notes |
|---|---|---|
| `match_results` | Yes | All result rows scoped to game |
| `player_stats` | Yes | Separate rank/win/loss per game per player |
| `tournaments` | Yes (default `'penalty444'`) | Tournaments reference a game |
| `tournament_entries` | Via `tournament_id` | Inherited from tournament |
| `tournament_matches` | Via `tournament_id` | Inherited from tournament |

### Future tables to add (architecture only — no migrations in this PR)

**`games`** — game registry (Section 4).

**`game_variants`** — optional variant configuration per game_id
(e.g. Chess blitz vs rapid time controls; standard vs American draughts rules).

**`game_action_logs`** — append-only per-match action log for anti-cheat
replay and audit. Critical for Crush444 and Card444.
```
match_result_id    uuid references match_results(id)
game_id            text not null
sequence_number    int not null
player_id          uuid references auth.users(id)
action_type        text not null
action_payload     jsonb not null
server_timestamp   timestamptz not null default now()
```

**`game_rating_snapshots`** — periodic snapshot of a player's rating per game
for season/historical tracking. Avoids recomputing from the full match log.

### Extend vs separate tables

| Approach | Pros | Cons |
|---|---|---|
| Extend `match_results` with `game_id` (current) | Already done; zero migration needed | Result payload columns are Penalty444-shaped |
| Add `game_id`-scoped columns to `match_results` | Flexible | Nullable columns for other games; messy schema |
| Separate result table per game | Clean per-game schema | Cross-game queries harder; more migrations |
| JSONB `game_state` column in `match_results` | Flexible result payload | Unindexable, harder to query |

**Recommendation:** Keep the current `match_results` table extended with
`game_id`. Add a `game_state jsonb` column to `match_results` for
game-specific result details (e.g. final board position, move count). This
gives structured common fields (winner, scores, timestamps) while allowing
game-specific data in the JSONB column without schema changes per game.

---

## 11. Ranking and Rating Model

### Principles

1. **Ratings are per-game.** A player's Penalty444 rank points must not
   affect their Chess444 rating. Each game has an independent `player_stats`
   row scoped to `game_id`.

2. **Placement threshold is per-game.** The current
   `PLACEMENT_MATCHES_REQUIRED = 10` applies to Penalty444. Chess444 may
   justify a higher threshold (e.g. 15–20) given the higher variance in early
   game results. Each game's adapter config should specify its own threshold.

3. **Rating algorithm may differ per game.** Penalty444 uses a flat-delta
   system (`CASUAL_WIN_DELTA = +25`, `CASUAL_LOSS_DELTA = -20`). Chess444
   may be better served by Elo (K-factor based). The adapter interface should
   accept a `ratingConfig` that the progression system uses.

4. **Leaderboards are per-game.** The current `/leaderboard` page is already
   filtered to `game_id = "penalty444"`. Future leaderboard pages will be
   per-game by default. A cross-arena overall leaderboard is a future feature
   that requires an agreed-upon normalisation formula.

5. **No shared rank tier across games.** A "Gold" rank in Penalty444 and a
   "Gold" rank in Chess444 are different achievements with different rating
   thresholds. The tier ladder for each game should be defined in that game's
   adapter config.

6. **Tournament wins are game-scoped.** `player_stats.tournament_wins`
   already exists per `game_id`. This is correct.

---

## 12. Tournament Model

### Current state

The `tournaments` table has `game_id` (default `'penalty444'`). The bracket
engine, entry system, and match advancement are already multi-game-capable at
the schema level.

### Future requirements

1. **Each tournament references exactly one game_id.** Mixed-game tournaments
   are out of scope.

2. **Format depends on game type.** Single-elimination is appropriate for
   Penalty444, Chess444, and Draught444 (discrete winner per match).
   Crush444 may need a score-race or round-robin format (players compete
   for highest aggregate score). The tournament engine should support a
   `format` field that selects the bracket algorithm.

3. **Match rules are tournament-configurable.** A Penalty444 tournament may
   use 5 rounds per match (vs 3 for casual). A Chess444 tournament may use
   blitz time controls. The tournament record should store `match_config`
   (JSONB) passed to `adapter.createInitialState()`.

4. **Paid-entry tournaments remain disabled during beta** for all games. See
   `docs/wallet-architecture-guardrails.md`.

5. **Spectators for tournament finals** are a future feature, valuable for
   all turn-based games (Chess, Draughts) where live game observation is
   meaningful.

---

## 13. Anti-Cheat and Fairness

### Server authority (non-negotiable for all games)

- The server is the only entity that determines match outcomes.
- Clients submit actions; the server validates, applies, and broadcasts.
- No client-side result computation. No client-trusted scores.

### Game-specific anti-cheat requirements

| Game | Primary concern | Mitigation |
|---|---|---|
| Penalty444 | Client submitting an invalid lane | Server validates `isValidLane()`; rejects unknowns |
| Draught444 | Client submitting an illegal move | Server runs legal-move engine in adapter |
| Chess444 | Engine assistance (computer cheating) | Engine detection required before ranked launch |
| Crush444 | Score manipulation, move fabrication | Server-side move log replay to verify final score |
| Card444 | Opponent hand exposure, collusion | Server withholds hidden state; adapter enforces it |

### Action logs

A `game_action_logs` table (Section 10) should record every server-accepted
action for all games. For Crush444 and Card444 this is a hard requirement —
without a complete action log, post-hoc score verification is impossible. For
Chess444 it enables position replay and engine-detection analysis.

### Deterministic seeds (Crush444, Card444)

Both games require a shared random seed issued by the server at match start.
The seed must:
- Be generated server-side (never client-proposed).
- Be the same for both players in the same match.
- Be stored in the match record for post-game audit.
- Use a cryptographically adequate RNG (not `Math.random()`).

### Reconnect and resume

The existing disconnect-grace architecture (`room/readiness.ts`,
`disconnectGrace.ts`) must be extended to handle turn-based game state.
On reconnect:
- Server sends the current game state via `adapter.getPlayerState()`.
- The reconnecting client resumes from the server-authoritative state.
- Client-side optimistic state must be discarded on reconnect.

### Resign and timeout

Every game must support a resign path (player voluntarily concedes) and a
timeout path (turn timer expired). Both produce a valid `MatchResult` via
the adapter and go through the same result/settlement pipeline as a natural
game end.

---

## 14. UI / UX Guardrails

### Current state (already correct)

The home page game selector (`ARENA_GAMES` array in `apps/web/src/app/page.tsx`)
lists Chess444, Draught444, and Crush444 as `comingSoon: true`. The `GameCard`
component:
- Shows a "Coming Soon" badge instead of "Free Play".
- Shows a "Coming Soon" label instead of a "Play →" button.
- Wraps the card in `<div aria-disabled>` instead of `<Link>`.
- Does not navigate anywhere on click.

No fake player counts, fake active rooms, fake live tournaments, or fake
launch dates are displayed for any upcoming game.

### Rules for adding future game cards

| Allowed | Not allowed |
|---|---|
| "Chess444 — Coming Soon" card (`comingSoon: true`) | Clickable "Play" button for a non-live game |
| Disabled card with "Coming Soon" badge | Fake active player count ("47 online") |
| Static icon and genre label | Fake live match list for a future game |
| Link to a future roadmap page (no gameplay) | Fake tournament with a prize pool |
| "Draught444 — Coming Soon" | Launch date promise ("Coming March 2026") |

### When a game transitions from `coming_soon` to `beta`

The game registry entry changes `status` from `"coming_soon"` to `"beta"`.
The `GameCard` status badge updates. A real `/games/[slug]` page must exist
and be accessible before the status changes — do not gate on the badge alone.

### What must be true before changing a game's status to `"live"`

1. The game's realtime adapter is complete and deployed.
2. The game has gone through an internal beta phase.
3. Ranking / progression is configured and tested.
4. Tournament support is tested if the game will offer tournaments.
5. The game page (`/games/[slug]`) renders a real lobby, not a placeholder.
6. Beta policy rules are preserved (Free Play until wallet is approved).

---

## 15. Rollout Phases

### Phase A — Architecture document (current)

- This document written.
- `MOCK_GAMES` renamed to `ARENA_GAMES` in `apps/web/src/app/page.tsx`
  (internal clarity fix — no user-visible change).
- No second game implemented.
- Future games remain `comingSoon: true` in the game selector.

### Phase B — Game registry design

- Agree on `GameRegistryEntry` shape (Section 4).
- Implement as a server-side config module (Option B from Section 4).
- The `ARENA_GAMES` array in the home page reads from the registry rather
  than a hardcoded constant.
- No new game is live or playable.

### Phase C — Coming Soon game selector UI

- A `/games` index page lists all registered games with status badges.
- Coming Soon games are displayed, non-interactive.
- No fake data. No fake queues. No fake player counts.
- Penalty444 routes unchanged.

### Phase D — Isolated local prototype for Draught444

- A development-only branch. Not merged to master.
- Draught444 adapter implemented and unit-tested in isolation.
- No integration with the production realtime server.
- No public route.

### Phase E — Realtime adapter proof of concept (dev only)

- `game_type` routing introduced to the realtime server (Option A, Section 8).
- Draught444 adapter wired to the server behind a feature flag.
- Penalty444 continues to use its existing (non-adapter) code path — no
  migration yet.
- Integration tested in a development environment only.

### Phase F — Internal beta for Draught444

- Draught444 deployed to staging.
- Invite-only access for internal testers.
- Per-game `player_stats` row confirmed isolated from Penalty444.
- Tournament support for Draught444 tested.
- Penalty444 smoke tests must pass.

### Phase G — Public Free Play beta for Draught444

- Draught444 status changed to `"beta"` in the game registry.
- `/games/draughts444` route live.
- Free Play only — no stakes, no paid tournaments.
- Ranking active with placement period.

### Phase H — Tournaments and ranked integration per game

- Per-game tournament pages.
- Cross-game profile page showing stats for each game.
- Second game (Chess444 or Crush444) begins Phase D.

---

## 16. Recommended Second Game

**Recommendation: Draught444 (Checkers) before Chess444.**

| Criterion | Draught444 | Chess444 |
|---|---|---|
| Legal-move complexity | Moderate — forced capture, multi-jump, kinging | Very high — castling, en passant, promotion, repetition, 50-move |
| Anti-cheat requirement | Low — no strong checkers engines in common use | Hard gate — engine detection required before ranked |
| Time-to-prototype | Shorter | Longer |
| Cultural familiarity in target market | High (board games widely played) | High |
| Match duration | 5–20 min | 5–60 min depending on time control |
| Adapter risk | Lower | Higher |

Crush444 requires a different adapter shape (timer-based, simultaneous
action, score-race) and strong anti-cheat. It should follow the board games
once the adapter framework is proven.

Card444 has the most complex hidden-information and fairness requirements and
should be last.

**Suggested order:** Draught444 → Chess444 → Crush444 → Card444.

---

## 17. Acceptance Criteria Before Implementing a Second Game

A second game prototype may begin (Phase D) when ALL of the following are met:

- [ ] Penalty444 is fully stable in production (reconnect, forfeit, ranking, tournaments)
- [ ] Game registry shape agreed and documented (Section 4)
- [ ] Game adapter interface agreed and documented (Section 5)
- [ ] Server-side game-type routing plan agreed (Section 8)
- [ ] Per-game ranking plan agreed (Section 11) — ratings isolated, no cross-contamination
- [ ] Per-game tournament plan agreed (Section 12)
- [ ] Penalty444 smoke tests exist and pass on the prototype branch
- [ ] Beta policy preserved: second game is Free Play only at launch
- [ ] No fake player counts, fake rooms, or fake tournaments for the new game added to production UI before Phase G

---

## 18. Open Questions

1. **Exact second game choice** — Is Draught444 confirmed as the second
   prototype, or is there a preference for Chess444 or Crush444 first?

2. **Draughts rules variant** — Standard English draughts (8×8, men must
   jump if possible)? International draughts (10×10)? African variant? The
   variant must be fixed before the adapter is built.

3. **Chess legal-move library** — Should the Chess444 adapter use an existing
   open-source library (e.g. `chess.js`, `stockfish.js` for validation only)?
   Or a custom implementation? The library must run server-side only.

4. **Shared `match_results` vs per-game result tables** — Should the existing
   `match_results` table gain a `game_state jsonb` column for game-specific
   data, or should each game have its own result table? (Recommendation in
   Section 10: shared table + JSONB column.)

5. **Per-game `player_stats` row vs separate tables** — The current schema
   uses one `player_stats` table with `game_id`. Is this sufficient for all
   planned games, or does Chess require additional columns (e.g. Elo K-factor
   history)?

6. **Spectator support timeline** — When does live spectation need to be
   ready? Chess and Draughts are natural spectator games. Should the adapter
   interface include a `getSpectatorState()` method?

7. **Chat scope** — Is match chat room-level (current) or game-lobby-level?
   For turn-based games a "during match" chat is more natural than for
   Penalty444 where matches are very short.

8. **Future wallet and multi-game economy** — When the wallet is approved
   (see `docs/wallet-architecture-guardrails.md`), should each game have
   separate stake pools and entry fee schedules, or a unified economy? Are
   cross-game balance and leaderboard rewards in scope?

9. **Mobile clients** — Unity (Penalty444) handles mobile for the 3D
   renderer. For Chess444 and Draught444, is a native app required or will
   the responsive web client suffice for launch?
