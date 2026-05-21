/**
 * Phase 5 — Competitive Identity System: Rank tiers.
 *
 * This module is the single source of truth for the 444 ARENA tier ladder.
 * It is intentionally framework-agnostic: no React, no Supabase. UI surfaces
 * (account page, leaderboard, home strip, profile cards) all read from
 * `getRankTier(rating)` so visuals stay consistent across the platform.
 *
 * Tier ladder (rating thresholds):
 *   Bronze     0     baseline / new players
 *   Silver     500
 *   Gold       1000
 *   Platinum   1500
 *   Diamond    2000
 *   Elite      2500
 *   Champion   3000  top of ladder, gold prestige
 *
 * Players without a stats row (or with < UNRANKED_MATCHES_THRESHOLD matches)
 * are presented as "Unranked" — they should never appear with a fake rank.
 *
 * IMPORTANT: This module does not write to the DB. The legacy `player_stats.tier`
 * column may contain "Bronze" / "Silver" / "Gold" / "Diamond" / "Legend". We
 * keep `mapLegacyTierName` so old data still renders, but the rating-derived
 * tier always wins when a numeric rating is available.
 */

export type RankTierId =
  | "unranked"
  | "bronze"
  | "silver"
  | "gold"
  | "platinum"
  | "diamond"
  | "elite"
  | "champion";

export type RankTier = {
  id: RankTierId;
  label: string;
  shortLabel: string;
  /** Inclusive minimum rating to qualify. */
  minRating: number;
  /** Inclusive maximum rating (exclusive of next tier's minRating). */
  maxRating: number;
  /** Single emoji used as the tier icon. */
  icon: string;
  /** Tailwind text color for tier label. */
  textClass: string;
  /** Tailwind border color for the tier badge. */
  borderClass: string;
  /** Tailwind background tint for the tier badge. */
  bgClass: string;
  /** Tailwind glow / shadow class for premium emphasis (cards, podium). */
  glowClass: string;
  /** Tailwind text gradient (for the Champion-style headline treatment). */
  gradientText: string;
  /** Whether this tier should use the "prestige" gold/champion styling. */
  prestige: boolean;
};

/**
 * Matches required before a player escapes the Placement Matches label
 * and is presented with a competitive rank tier.
 *
 * Kept in sync with `PLACEMENT_MATCHES_REQUIRED` in `progression.ts` and
 * the realtime-server progression mirror.
 */
export const UNRANKED_MATCHES_THRESHOLD = 10;

const TIERS: RankTier[] = [
  {
    id: "unranked",
    label: "Unranked",
    shortLabel: "UR",
    minRating: -Infinity,
    maxRating: -1,
    icon: "○",
    textClass: "text-zinc-300",
    borderClass: "border-zinc-700",
    bgClass: "bg-zinc-900/80",
    glowClass: "shadow-[0_0_16px_rgba(82,82,91,0.25)]",
    gradientText: "text-zinc-200",
    prestige: false,
  },
  {
    id: "bronze",
    label: "Bronze",
    shortLabel: "Bz",
    minRating: 0,
    maxRating: 499,
    icon: "🥉",
    textClass: "text-amber-200",
    borderClass: "border-amber-700/60",
    bgClass: "bg-amber-950/45",
    glowClass: "shadow-[0_0_22px_rgba(180,83,9,0.25)]",
    gradientText:
      "bg-gradient-to-r from-amber-200 via-amber-300 to-orange-300 bg-clip-text text-transparent",
    prestige: false,
  },
  {
    id: "silver",
    label: "Silver",
    shortLabel: "Sv",
    minRating: 500,
    maxRating: 999,
    icon: "🥈",
    textClass: "text-slate-100",
    borderClass: "border-slate-400/50",
    bgClass: "bg-slate-900/55",
    glowClass: "shadow-[0_0_22px_rgba(148,163,184,0.22)]",
    gradientText:
      "bg-gradient-to-r from-slate-100 via-zinc-200 to-slate-300 bg-clip-text text-transparent",
    prestige: false,
  },
  {
    id: "gold",
    label: "Gold",
    shortLabel: "Gd",
    minRating: 1000,
    maxRating: 1499,
    icon: "🥇",
    textClass: "text-yellow-100",
    borderClass: "border-yellow-300/55",
    bgClass: "bg-yellow-950/45",
    glowClass: "shadow-[0_0_24px_rgba(234,179,8,0.28)]",
    gradientText:
      "bg-gradient-to-r from-yellow-200 via-amber-200 to-orange-200 bg-clip-text text-transparent",
    prestige: false,
  },
  {
    id: "platinum",
    label: "Platinum",
    shortLabel: "Pl",
    minRating: 1500,
    maxRating: 1999,
    icon: "❖",
    textClass: "text-teal-100",
    borderClass: "border-teal-300/55",
    bgClass: "bg-teal-950/45",
    glowClass: "shadow-[0_0_24px_rgba(45,212,191,0.28)]",
    gradientText:
      "bg-gradient-to-r from-teal-100 via-cyan-200 to-emerald-200 bg-clip-text text-transparent",
    prestige: false,
  },
  {
    id: "diamond",
    label: "Diamond",
    shortLabel: "Di",
    minRating: 2000,
    maxRating: 2499,
    icon: "💎",
    textClass: "text-cyan-100",
    borderClass: "border-cyan-300/65",
    bgClass: "bg-cyan-950/50",
    glowClass: "shadow-[0_0_26px_rgba(34,211,238,0.32)]",
    gradientText:
      "bg-gradient-to-r from-cyan-100 via-sky-200 to-indigo-200 bg-clip-text text-transparent",
    prestige: false,
  },
  {
    id: "elite",
    label: "Elite",
    shortLabel: "El",
    minRating: 2500,
    maxRating: 2999,
    icon: "⚔",
    textClass: "text-violet-100",
    borderClass: "border-violet-300/65",
    bgClass: "bg-violet-950/50",
    glowClass: "shadow-[0_0_28px_rgba(167,139,250,0.32)]",
    gradientText:
      "bg-gradient-to-r from-violet-100 via-fuchsia-200 to-purple-200 bg-clip-text text-transparent",
    prestige: false,
  },
  {
    id: "champion",
    label: "Champion",
    shortLabel: "Ch",
    minRating: 3000,
    maxRating: Infinity,
    icon: "👑",
    textClass: "text-yellow-100",
    borderClass: "border-yellow-300/75",
    bgClass: "bg-gradient-to-br from-yellow-900/55 via-amber-950/45 to-black",
    glowClass: "shadow-[0_0_32px_rgba(234,179,8,0.38)]",
    gradientText:
      "bg-gradient-to-r from-yellow-200 via-amber-300 to-orange-300 bg-clip-text text-transparent drop-shadow-[0_0_18px_rgba(234,179,8,0.45)]",
    prestige: true,
  },
];

export const RANK_TIERS: ReadonlyArray<RankTier> = TIERS;

/** Tier order used for ladder progression UI ("next tier" hint). */
export const RANKED_TIER_ORDER: ReadonlyArray<RankTierId> = [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "elite",
  "champion",
];

const TIER_BY_ID: Record<RankTierId, RankTier> = TIERS.reduce(
  (acc, tier) => {
    acc[tier.id] = tier;
    return acc;
  },
  {} as Record<RankTierId, RankTier>
);

export function getTierById(id: RankTierId): RankTier {
  return TIER_BY_ID[id] ?? TIER_BY_ID.unranked;
}

/**
 * Returns the tier for a rating. If `matchesPlayed` is supplied and below
 * `UNRANKED_MATCHES_THRESHOLD`, the player is considered Unranked regardless
 * of their numeric rating so we never present a "Bronze" tier on a brand-new
 * profile with 0 matches.
 */
export function getRankTier(
  rating: number | null | undefined,
  matchesPlayed: number | null | undefined = null
): RankTier {
  if (
    matchesPlayed !== null &&
    matchesPlayed !== undefined &&
    matchesPlayed < UNRANKED_MATCHES_THRESHOLD
  ) {
    return TIER_BY_ID.unranked;
  }
  if (rating === null || rating === undefined || !Number.isFinite(rating)) {
    return TIER_BY_ID.unranked;
  }

  for (let i = RANKED_TIER_ORDER.length - 1; i >= 0; i -= 1) {
    const tier = TIER_BY_ID[RANKED_TIER_ORDER[i]!]!;
    if (rating >= tier.minRating) return tier;
  }
  return TIER_BY_ID.bronze;
}

/**
 * Map a legacy `player_stats.tier` string ("Bronze" | "Silver" | "Gold" |
 * "Diamond" | "Legend" | "Unranked") to a new tier id. Used when we have a
 * tier string but no usable numeric rating.
 */
export function mapLegacyTierName(tierName?: string | null): RankTierId {
  if (!tierName) return "unranked";
  const lower = tierName.toLowerCase().trim();
  if (lower === "legend" || lower === "champion") return "champion";
  if (lower === "elite") return "elite";
  if (lower === "diamond") return "diamond";
  if (lower === "platinum" || lower === "platinium") return "platinum";
  if (lower === "gold") return "gold";
  if (lower === "silver") return "silver";
  if (lower === "bronze") return "bronze";
  return "unranked";
}

/**
 * Convenience: resolve a tier from whatever data is available. Prefers the
 * numeric rating, falls back to the legacy tier name, falls back to Unranked.
 */
export function resolvePlayerTier(input: {
  rating?: number | null;
  matchesPlayed?: number | null;
  legacyTierName?: string | null;
}): RankTier {
  const { rating, matchesPlayed = null, legacyTierName } = input;

  if (
    matchesPlayed !== null &&
    matchesPlayed !== undefined &&
    matchesPlayed < UNRANKED_MATCHES_THRESHOLD
  ) {
    return TIER_BY_ID.unranked;
  }

  if (rating !== null && rating !== undefined && Number.isFinite(rating)) {
    return getRankTier(rating, matchesPlayed);
  }

  if (legacyTierName) {
    return TIER_BY_ID[mapLegacyTierName(legacyTierName)];
  }

  return TIER_BY_ID.unranked;
}

/**
 * Returns progress toward the next tier as a value in [0, 1]. Returns 1 for
 * the top tier (Champion) since there is no further ladder. Returns 0 for
 * Unranked players (they need matches, not rating).
 */
export function getRankProgressTowardNext(
  rating: number | null | undefined,
  matchesPlayed: number | null | undefined = null
): { progress: number; pointsToNext: number; nextTier: RankTier | null } {
  const tier = getRankTier(rating, matchesPlayed);
  if (tier.id === "unranked") {
    return { progress: 0, pointsToNext: 0, nextTier: TIER_BY_ID.bronze };
  }
  if (tier.id === "champion") {
    return { progress: 1, pointsToNext: 0, nextTier: null };
  }
  const r = rating ?? 0;
  const currentIdx = RANKED_TIER_ORDER.indexOf(tier.id);
  const nextId = RANKED_TIER_ORDER[currentIdx + 1];
  if (!nextId) {
    return { progress: 1, pointsToNext: 0, nextTier: null };
  }
  const nextTier = TIER_BY_ID[nextId]!;
  const span = nextTier.minRating - tier.minRating;
  const within = Math.max(0, Math.min(span, r - tier.minRating));
  const progress = span > 0 ? within / span : 1;
  const pointsToNext = Math.max(0, nextTier.minRating - r);
  return { progress, pointsToNext, nextTier };
}
