"use client";

import { resolvePlayerTier } from "../../lib/player/ranks";
import { getPlacementStatus } from "../../lib/player/progression";
import {
  formatStreakLabel,
  formatWinRate,
  isPlayerRanked,
  type CompetitiveStats,
} from "../../lib/player/stats";
import RankBadge from "../player/RankBadge";
import StatTile from "../player/StatTile";

/**
 * Home dashboard stats strip.
 *
 * Phase 5 update: now consumes the shared CompetitiveStats shape and uses
 * the canonical rank tier system. Falls back to platform-friendly Unranked
 * copy when the player hasn't played enough matches — never fabricates a
 * rank.
 *
 * Back-compat: callers that previously passed `{ wins, winRatePct, streak,
 * rankLabel }` continue to work via the optional `legacyStats` prop.
 */
type LegacyStats = {
  wins: number;
  winRatePct: number;
  streak: number;
  rankLabel: string;
};

type Props = {
  username?: string | null;
  stats?: CompetitiveStats | null;
  /** Deprecated: kept for back-compat with earlier home page wiring. */
  legacyStats?: LegacyStats;
};

export default function PlayerStatsStrip({
  username = null,
  stats,
  legacyStats,
}: Props) {
  const effectiveStats: CompetitiveStats = stats ?? {
    wins: legacyStats?.wins ?? 0,
    matches:
      legacyStats && legacyStats.winRatePct > 0 && legacyStats.wins > 0
        ? Math.round((legacyStats.wins / legacyStats.winRatePct) * 100)
        : 0,
    streak: legacyStats?.streak ?? 0,
    rating: null,
    legacyTierName: legacyStats?.rankLabel,
  };

  const ranked = isPlayerRanked(effectiveStats);
  const placement = getPlacementStatus(effectiveStats.matches ?? 0);
  const tier = resolvePlayerTier({
    rating: effectiveStats.rating ?? null,
    matchesPlayed: effectiveStats.matches ?? null,
    legacyTierName: effectiveStats.legacyTierName ?? null,
  });

  const wins = effectiveStats.wins ?? 0;
  const matches = effectiveStats.matches ?? 0;
  const winRate = formatWinRate(wins, matches);
  const streak = effectiveStats.streak ?? 0;
  const tournamentWins = effectiveStats.tournamentWins ?? 0;

  return (
    <section
      className="rounded-3xl border border-[#1B2433] bg-gradient-to-br from-[#0A0E14] via-[#0A0E14] to-black p-3 shadow-xl sm:p-3.5"
      aria-label="Your statistics"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
            Your Performance
          </p>
          <h2 className="mt-1 text-lg font-black tracking-tight text-white sm:text-xl">
            {username ? `Welcome back, ${username}` : "Welcome to the arena"}
          </h2>
        </div>
        <RankBadge
          tier={ranked ? tier : undefined}
          rating={effectiveStats.rating ?? null}
          matchesPlayed={effectiveStats.matches ?? 0}
          showRating={ranked}
          variant="chip"
        />
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5 sm:gap-3">
        <StatTile
          compact
          label="Rank"
          value={placement.inPlacement ? "Placement" : tier.label}
          hint={
            placement.inPlacement
              ? `${placement.played} / ${placement.required}`
              : "Climbing"
          }
          tone={
            placement.inPlacement
              ? "cyan"
              : tier.id === "champion"
                ? "gold"
                : "cyan"
          }
          icon={placement.inPlacement ? "○" : tier.icon}
        />
        <StatTile
          compact
          label="Win Rate"
          value={ranked ? `${winRate}%` : "—"}
          hint={ranked ? "Last season" : "After placements"}
          tone="violet"
        />
        <StatTile
          compact
          label="Streak"
          value={formatStreakLabel(streak)}
          hint={
            streak > 0 ? "On fire" : streak < 0 ? "Bounce back" : "Stay sharp"
          }
          tone="amber"
        />
        <StatTile
          compact
          label="Trophies"
          value={tournamentWins.toLocaleString()}
          hint={tournamentWins > 0 ? "Tournament wins" : "Start competing"}
          tone="gold"
          icon="🏆"
        />
      </div>
    </section>
  );
}
