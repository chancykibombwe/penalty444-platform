"use client";

import {
  getRankProgressTowardNext,
} from "../../lib/player/ranks";
import { getPlacementStatus } from "../../lib/player/progression";
import {
  formatStreakLabel,
  formatWinRate,
  getCompetitiveTier,
  isPlayerRanked,
  type CompetitiveStats,
} from "../../lib/player/stats";
import RankBadge from "./RankBadge";
import StatTile from "./StatTile";

/**
 * Premium competitive identity card. Drop-in for the account hub, profile
 * pages, or any future "player identity" surface (spectator lobby, etc).
 *
 * Data is read defensively — all fields are optional. When the player has
 * fewer than the qualifying number of matches, the card renders placement
 * state instead of fabricating tier data.
 */
type Props = {
  username?: string | null;
  /** Email or sub-line text shown beneath the username (optional). */
  subline?: string | null;
  stats?: CompetitiveStats | null;
  /** Optional rank index ("#12 global"). Hidden when null. */
  globalRank?: number | null;
  className?: string;
};

function getInitials(name?: string | null): string {
  if (!name) return "?";
  const initials = name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return initials || "?";
}

export default function CompetitiveProfileCard({
  username,
  subline,
  stats,
  globalRank = null,
  className,
}: Props) {
  const ranked = isPlayerRanked(stats);
  const placement = getPlacementStatus(stats?.matches ?? 0);
  const tier = getCompetitiveTier(stats);
  const rating = stats?.rating ?? null;
  const wins = stats?.wins ?? 0;
  const losses = stats?.losses ?? 0;
  const draws = stats?.draws ?? 0;
  const matches = stats?.matches ?? 0;
  const tournamentWins = stats?.tournamentWins ?? 0;
  const streak = stats?.streak ?? 0;
  const winRate = formatWinRate(wins, matches);

  const next = getRankProgressTowardNext(rating, matches);

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border-2 p-4 shadow-2xl sm:p-5 ${tier.borderClass} ${tier.bgClass} ${tier.glowClass} ${className ?? ""}`}
      aria-label="Competitive profile"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            "radial-gradient(80% 60% at 20% 0%, rgba(255,255,255,0.04) 0%, transparent 60%), radial-gradient(70% 60% at 100% 100%, rgba(0,0,0,0.45) 0%, transparent 60%)",
        }}
      />

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3 sm:items-center">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border-2 bg-black/55 text-2xl font-black text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_18px_45px_rgba(0,0,0,0.5)] sm:h-20 sm:w-20 sm:text-3xl ${tier.borderClass}`}
          >
            {getInitials(username)}
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">
              Competitive Identity
            </p>
            <h2
              className={`mt-1 break-words text-2xl font-black tracking-tight sm:text-3xl ${tier.gradientText}`}
            >
              {username || "Player"}
            </h2>
            {subline ? (
              <p className="mt-1 truncate text-xs text-zinc-500 sm:text-sm">
                {subline}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RankBadge
                tier={ranked ? tier : undefined}
                rating={rating}
                matchesPlayed={stats?.matches ?? 0}
                showRating={ranked}
                variant="chip"
              />
              {globalRank !== null && ranked ? (
                <span className="rounded-full border border-zinc-700 bg-black/45 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] text-zinc-200">
                  #{globalRank} global
                </span>
              ) : null}
              {placement.inPlacement ? (
                <span className="rounded-full border border-cyan-500/45 bg-cyan-950/35 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-200">
                  {placement.remaining} more to qualify
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {placement.inPlacement ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black tabular-nums text-cyan-100 drop-shadow-[0_0_18px_rgba(34,211,238,0.35)]">
                  {placement.played}
                </span>
                <span className="text-xl font-black text-zinc-500">
                  / {placement.required}
                </span>
              </div>
              <div className="w-56 text-right">
                <div className="h-1.5 overflow-hidden rounded-full bg-black/55">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-yellow-300"
                    style={{
                      width: `${Math.round(
                        (placement.played / placement.required) * 100
                      )}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200">
                  Placement Matches
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span
                  className={`text-4xl font-black tabular-nums ${tier.gradientText}`}
                >
                  {rating !== null ? Math.round(rating) : "—"}
                </span>
                <span className="text-xs font-black uppercase tracking-[0.3em] text-zinc-400">
                  Rating
                </span>
              </div>
              {next.nextTier ? (
                <div className="w-56 text-right">
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/55">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-yellow-300"
                      style={{ width: `${Math.round(next.progress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
                    {next.pointsToNext} to {next.nextTier.label}
                  </p>
                </div>
              ) : tier.id === "champion" ? (
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-yellow-300">
                  Top of the ladder
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        <StatTile
          label="Matches"
          value={matches.toLocaleString()}
          tone="neutral"
        />
        <StatTile label="Wins" value={wins.toLocaleString()} tone="cyan" />
        <StatTile label="Losses" value={losses.toLocaleString()} tone="rose" />
        <StatTile label="Draws" value={draws.toLocaleString()} tone="neutral" />
        <StatTile
          label="Win Rate"
          value={ranked ? `${winRate}%` : "—"}
          hint={ranked ? undefined : "After placements"}
          tone="violet"
        />
        <StatTile
          label="Streak"
          value={formatStreakLabel(streak)}
          hint={
            streak > 0
              ? "On fire"
              : streak < 0
                ? "Bounce back"
                : "Stay sharp"
          }
          tone="amber"
        />
      </div>

      <div className="relative mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatTile
          label="Tournament Wins"
          value={tournamentWins.toLocaleString()}
          tone="gold"
          icon="🏆"
        />
        <StatTile
          label="Goals For"
          value={(stats?.goalsFor ?? 0).toLocaleString()}
          tone="cyan"
        />
        <StatTile
          label="Goals Against"
          value={(stats?.goalsAgainst ?? 0).toLocaleString()}
          tone="rose"
        />
        <StatTile
          label="Tier"
          value={placement.inPlacement ? "Placement" : tier.label}
          tone={
            placement.inPlacement
              ? "cyan"
              : tier.id === "champion"
                ? "gold"
                : "neutral"
          }
          icon={placement.inPlacement ? "○" : tier.icon}
        />
      </div>
    </section>
  );
}
