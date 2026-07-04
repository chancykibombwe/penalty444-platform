import GameCard, { type GameCardData } from "./GameCard";

/**
 * GamesGrid — responsive grid wrapper for GameCard tiles.
 *
 * Used for the "Coming Soon" row in the Home Featured Games section
 * (locked mobile direction: Chess444 / Draught444 / Crush444 / Card444).
 * 2 columns on mobile (even 2x2 for 4 cards, no orphaned half-row),
 * 4 columns from `sm:` up.
 *
 * Presentation/layout only — the coming-soon safety rules (no fake links,
 * no silent "/" navigation) live in GameCard itself; this wrapper never
 * overrides them.
 */
export default function GamesGrid({ games }: { games: GameCardData[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
      {games.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </div>
  );
}
