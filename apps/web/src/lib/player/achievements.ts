/**
 * Phase 5 — Achievement foundation.
 *
 * DISPLAY-ONLY. There is no backend unlock state. Every achievement is
 * derived from a `CompetitiveStats` object at render time. When a future
 * persistent achievement service ships, it can return the same `Achievement`
 * + `AchievementProgress` shape and the UI won't need to change.
 *
 * Rules:
 *   - Achievements that cannot be derived from existing data (e.g.
 *     "Perfect Round", "Clutch Save") are always shown as locked with a
 *     hint, never auto-unlocked from mock data.
 *   - Achievements that CAN be derived (first win, 5-win streak, tournament
 *     winner) read directly from CompetitiveStats and reflect current truth.
 */

import type { CompetitiveStats } from "./stats";

export type AchievementId =
  | "first-win"
  | "five-win-streak"
  | "ten-wins"
  | "tournament-winner"
  | "perfect-round"
  | "clutch-save"
  | "rising-star"
  | "century"
  | "champion-tier";

export type Achievement = {
  id: AchievementId;
  label: string;
  description: string;
  icon: string;
  /** Tailwind text color for the unlocked state. */
  unlockedColor: string;
  /** Hint shown while locked (no fake data — explains what to do). */
  lockedHint: string;
};

export type AchievementProgress = Achievement & {
  unlocked: boolean;
  /** Current value toward the goal (e.g. 3 wins out of 10). */
  current: number;
  /** Goal value, or `null` when the achievement is binary / not derivable. */
  goal: number | null;
};

export const ACHIEVEMENTS: ReadonlyArray<Achievement> = [
  {
    id: "first-win",
    label: "First Win",
    description: "Win your first arena match.",
    icon: "⚽",
    unlockedColor: "text-emerald-200",
    lockedHint: "Win a match to unlock.",
  },
  {
    id: "five-win-streak",
    label: "5 Win Streak",
    description: "Win 5 matches in a row.",
    icon: "🔥",
    unlockedColor: "text-orange-200",
    lockedHint: "Stack 5 wins back-to-back.",
  },
  {
    id: "ten-wins",
    label: "Veteran",
    description: "Reach 10 career wins.",
    icon: "🎖",
    unlockedColor: "text-cyan-200",
    lockedHint: "Climb to 10 career wins.",
  },
  {
    id: "tournament-winner",
    label: "Tournament Winner",
    description: "Win a bracketed tournament.",
    icon: "🏆",
    unlockedColor: "text-yellow-200",
    lockedHint: "Win a full tournament bracket.",
  },
  {
    id: "perfect-round",
    label: "Perfect Round",
    description: "Win a match without conceding a goal.",
    icon: "🛡",
    unlockedColor: "text-sky-200",
    lockedHint: "Coming soon — needs per-match stat tracking.",
  },
  {
    id: "clutch-save",
    label: "Clutch Save",
    description: "Save a final-shot penalty under pressure.",
    icon: "🧤",
    unlockedColor: "text-violet-200",
    lockedHint: "Coming soon — needs per-shot tracking.",
  },
  {
    id: "rising-star",
    label: "Rising Star",
    description: "Climb out of Bronze.",
    icon: "✨",
    unlockedColor: "text-amber-200",
    lockedHint: "Reach Silver rating (500+).",
  },
  {
    id: "century",
    label: "Century",
    description: "Play 100 matches in the arena.",
    icon: "💯",
    unlockedColor: "text-fuchsia-200",
    lockedHint: "Play 100 ranked matches.",
  },
  {
    id: "champion-tier",
    label: "Champion",
    description: "Reach the Champion rank tier.",
    icon: "👑",
    unlockedColor: "text-yellow-200",
    lockedHint: "Reach 3000+ rating.",
  },
];

/**
 * Compute display progress for a single achievement from current stats. The
 * function intentionally returns conservative defaults — when the data
 * required to evaluate the achievement is missing, it stays locked instead
 * of guessing.
 */
export function getAchievementProgress(
  achievement: Achievement,
  stats: CompetitiveStats | null | undefined
): AchievementProgress {
  const wins = stats?.wins ?? 0;
  const matches = stats?.matches ?? 0;
  const streak = stats?.streak ?? 0;
  const tournamentWins = stats?.tournamentWins ?? 0;
  const rating = stats?.rating ?? null;

  switch (achievement.id) {
    case "first-win":
      return {
        ...achievement,
        unlocked: wins >= 1,
        current: Math.min(wins, 1),
        goal: 1,
      };
    case "five-win-streak":
      return {
        ...achievement,
        unlocked: streak >= 5,
        current: Math.max(0, Math.min(streak, 5)),
        goal: 5,
      };
    case "ten-wins":
      return {
        ...achievement,
        unlocked: wins >= 10,
        current: Math.min(wins, 10),
        goal: 10,
      };
    case "tournament-winner":
      return {
        ...achievement,
        unlocked: tournamentWins >= 1,
        current: Math.min(tournamentWins, 1),
        goal: 1,
      };
    case "rising-star":
      return {
        ...achievement,
        unlocked: rating !== null && rating >= 500,
        current: rating !== null ? Math.min(rating, 500) : 0,
        goal: 500,
      };
    case "century":
      return {
        ...achievement,
        unlocked: matches >= 100,
        current: Math.min(matches, 100),
        goal: 100,
      };
    case "champion-tier":
      return {
        ...achievement,
        unlocked: rating !== null && rating >= 3000,
        current: rating !== null ? Math.min(rating, 3000) : 0,
        goal: 3000,
      };
    case "perfect-round":
    case "clutch-save":
    default:
      // Not derivable from current data — always locked, no fake progress.
      return {
        ...achievement,
        unlocked: false,
        current: 0,
        goal: null,
      };
  }
}

/**
 * Map over the full catalog and return progress entries. Sorted: unlocked
 * first (most recent feeling), then by progress descending so the closest
 * achievements surface near the top.
 */
export function getAllAchievementProgress(
  stats: CompetitiveStats | null | undefined
): AchievementProgress[] {
  return ACHIEVEMENTS.map((a) => getAchievementProgress(a, stats)).sort(
    (a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      const aPct = a.goal ? a.current / a.goal : 0;
      const bPct = b.goal ? b.current / b.goal : 0;
      return bPct - aPct;
    }
  );
}

/** Quick count helper for summary tiles. */
export function countUnlockedAchievements(
  stats: CompetitiveStats | null | undefined
): { unlocked: number; total: number } {
  const all = getAllAchievementProgress(stats);
  return {
    unlocked: all.filter((a) => a.unlocked).length,
    total: all.length,
  };
}
