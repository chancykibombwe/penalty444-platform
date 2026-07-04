import GameCard, { type GameCardData } from "../GameCard";
import HomeSectionTitle from "../HomeSectionTitle";

/**
 * DesktopFeaturedGames — horizontal "FEATURED GAMES" row for the Home Desktop
 * V1 layout.
 *
 * Reuses the shared GameCard (PR #170): Penalty444 is the live/featured game
 * (routes to /lobby); the rest are coming-soon tiles. GameCard owns the
 * coming-soon safety rules (never a link, no faked "/" route) — this row never
 * overrides them.
 *
 * Presentation/layout only.
 */

const FEATURED_GAMES: GameCardData[] = [
  {
    id: "penalty444",
    title: "Penalty444",
    subtitle: "Football · 1v1",
    status: "live",
    featured: true,
    href: "/lobby",
    icon: "⚽",
  },
  {
    id: "chess444",
    title: "Chess444",
    subtitle: "Strategy · Classic",
    status: "coming-soon",
    href: "",
    icon: "♟",
    comingSoon: true,
  },
  {
    id: "draught444",
    title: "Draught444",
    subtitle: "Strategy · Board",
    status: "coming-soon",
    href: "",
    icon: "🪙",
    comingSoon: true,
  },
  {
    id: "crush444",
    title: "Crush444",
    subtitle: "Puzzle · Arcade",
    status: "coming-soon",
    href: "",
    icon: "💥",
    comingSoon: true,
  },
  {
    id: "card444",
    title: "Card444",
    subtitle: "Cards · Strategy",
    status: "coming-soon",
    href: "",
    icon: "🃏",
    comingSoon: true,
  },
];

export default function DesktopFeaturedGames() {
  return (
    <section aria-label="Featured games">
      <div className="mb-3 flex items-center justify-between gap-2">
        <HomeSectionTitle>FEATURED GAMES</HomeSectionTitle>
        <span className="rounded-full border border-arena-border bg-black/40 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-arena-muted">
          Penalty444 live · more soon
        </span>
      </div>

      {/* Horizontal featured-games rail. The native scrollbar is hidden
          (.no-scrollbar) so the row reads as intentional; snap keeps cards
          aligned. A right-edge fade signals "more to scroll" and softens the
          card cut-off. `overflow-x-auto` is scoped to this rail — it never
          creates horizontal PAGE overflow (the container is min-w-0). */}
      <div className="relative">
        <div className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-1 pr-10">
          {FEATURED_GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
          {/* Trailing spacer so the last card can snap fully clear of the fade. */}
          <div aria-hidden className="w-1 shrink-0" />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-12 rounded-r-2xl bg-gradient-to-l from-arena-bg via-arena-bg/70 to-transparent"
        />
      </div>
    </section>
  );
}
