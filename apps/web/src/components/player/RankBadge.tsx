"use client";

import { getRankTier, type RankTier } from "../../lib/player/ranks";
import { getPlacementStatus } from "../../lib/player/progression";

/**
 * Compact, reusable rank tier badge.
 *
 * Accepts either a numeric rating (preferred) or an already-resolved tier.
 * When matchesPlayed is provided and below the unranked threshold the badge
 * will render as "Unranked" automatically — never hand-roll Unranked logic
 * in callers.
 *
 * Variants:
 *   - "chip"  : tiny pill, suitable for leaderboard rows / inline labels
 *   - "tile"  : medium card, suitable for stat strips / profile mini cards
 *   - "hero"  : large badge, used at the top of the account identity hub
 */
type Variant = "chip" | "tile" | "hero";

type Props = {
  rating?: number | null;
  matchesPlayed?: number | null;
  tier?: RankTier;
  variant?: Variant;
  /** Show the numeric rating alongside the tier label (defaults to false). */
  showRating?: boolean;
  className?: string;
};

export default function RankBadge({
  rating = null,
  matchesPlayed = null,
  tier,
  variant = "chip",
  showRating = false,
  className,
}: Props) {
  const placement = getPlacementStatus(matchesPlayed);
  // When matchesPlayed is explicitly provided and the player is in
  // placement, the placement badge wins regardless of the rating.
  const inPlacement =
    matchesPlayed !== null && matchesPlayed !== undefined && placement.inPlacement;

  const resolved = tier ?? getRankTier(rating, matchesPlayed);
  const isUnranked = resolved.id === "unranked";

  if (inPlacement) {
    return (
      <PlacementBadge
        variant={variant}
        played={placement.played}
        required={placement.required}
        className={className}
      />
    );
  }

  const baseClass = `inline-flex items-center gap-1.5 font-black uppercase tracking-[0.18em] border ${resolved.borderClass} ${resolved.bgClass} ${resolved.textClass}`;

  if (variant === "chip") {
    return (
      <span
        className={`${baseClass} rounded-full px-2.5 py-0.5 text-[10px] ${resolved.glowClass} ${className ?? ""}`}
        aria-label={`Rank tier: ${resolved.label}`}
      >
        <span aria-hidden>{resolved.icon}</span>
        <span>{resolved.label}</span>
        {showRating && !isUnranked && rating !== null ? (
          <span className="ml-1 text-[10px] font-bold text-white/70">
            {Math.round(rating)}
          </span>
        ) : null}
      </span>
    );
  }

  if (variant === "tile") {
    return (
      <div
        className={`flex items-center gap-3 rounded-2xl border px-3 py-2 ${resolved.borderClass} ${resolved.bgClass} ${resolved.glowClass} ${className ?? ""}`}
      >
        <span
          aria-hidden
          className={`flex h-9 w-9 items-center justify-center rounded-xl bg-black/40 text-xl ${resolved.textClass}`}
        >
          {resolved.icon}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
            Rank
          </span>
          <span className={`text-sm font-black ${resolved.textClass}`}>
            {resolved.label}
          </span>
          {showRating && !isUnranked && rating !== null ? (
            <span className="text-[10px] font-bold tabular-nums text-zinc-400">
              {Math.round(rating)} RP
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // hero
  return (
    <div
      className={`inline-flex items-center gap-4 rounded-3xl border-2 px-5 py-3.5 ${resolved.borderClass} ${resolved.bgClass} ${resolved.glowClass} ${className ?? ""}`}
    >
      <span
        aria-hidden
        className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-black/40 text-3xl ${resolved.textClass}`}
      >
        {resolved.icon}
      </span>
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">
          Current Tier
        </span>
        <span className={`text-2xl font-black ${resolved.gradientText}`}>
          {resolved.label}
        </span>
        {showRating && !isUnranked && rating !== null ? (
          <span className="text-xs font-bold tabular-nums text-zinc-300">
            {Math.round(rating)} rating
          </span>
        ) : isUnranked ? (
          <span className="text-xs font-semibold text-zinc-400">
            Play 10 matches to qualify
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PlacementBadge({
  variant,
  played,
  required,
  className,
}: {
  variant: Variant;
  played: number;
  required: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.round((played / required) * 100));
  const label = `Placement Matches ${played} / ${required}`;

  if (variant === "chip") {
    return (
      <span
        className={`inline-flex items-center gap-2 rounded-full border border-cyan-400/45 bg-cyan-950/40 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)] ${className ?? ""}`}
        aria-label={label}
      >
        <span aria-hidden>○</span>
        <span>{label}</span>
      </span>
    );
  }

  if (variant === "tile") {
    return (
      <div
        className={`flex items-center gap-3 rounded-2xl border border-cyan-400/45 bg-cyan-950/30 px-3 py-2 shadow-[0_0_22px_rgba(34,211,238,0.15)] ${className ?? ""}`}
      >
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-black/40 text-xl text-cyan-200"
        >
          ○
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
            Placement
          </span>
          <span className="text-sm font-black text-cyan-100">
            {played} / {required}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex flex-col gap-2 rounded-3xl border-2 border-cyan-400/55 bg-cyan-950/40 px-5 py-3.5 shadow-[0_0_28px_rgba(34,211,238,0.25)] ${className ?? ""}`}
    >
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black/40 text-3xl text-cyan-200"
        >
          ○
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">
            Placement Matches
          </span>
          <span className="text-2xl font-black text-cyan-100">
            {played} / {required}
          </span>
          <span className="text-xs font-semibold text-zinc-300">
            {required - played} more to qualify
          </span>
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/50">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-yellow-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
