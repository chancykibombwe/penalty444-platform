"use client";

import {
  getAllAchievementProgress,
} from "../../lib/player/achievements";
import type { CompetitiveStats } from "../../lib/player/stats";

/**
 * Display-only achievement grid. Reads progress from `CompetitiveStats`
 * via `getAllAchievementProgress`, which is honest about what can be
 * derived from current data ("Perfect Round" stays locked because we
 * don't track per-shot outcomes yet).
 *
 * Empty / no-data state: render the locked tiles with hints so the page
 * never feels empty, but never auto-unlock anything.
 */
type Props = {
  stats?: CompetitiveStats | null;
  /** Max tiles to render. Defaults to all in the catalog. */
  limit?: number;
  /** Render header. Defaults to true. */
  showHeader?: boolean;
  /** Optional href for a "See all" button. */
  seeAllHref?: string;
  className?: string;
};

export default function AchievementGrid({
  stats,
  limit,
  showHeader = true,
  seeAllHref,
  className,
}: Props) {
  const all = getAllAchievementProgress(stats);
  const items = typeof limit === "number" ? all.slice(0, limit) : all;
  const unlockedCount = all.filter((a) => a.unlocked).length;

  return (
    <section
      className={`rounded-2xl border border-zinc-800/80 bg-black/45 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:p-6 ${className ?? ""}`}
      aria-label="Achievements"
    >
      {showHeader ? (
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
              Achievements
            </p>
            <h2 className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
              {unlockedCount > 0
                ? `${unlockedCount} / ${all.length} unlocked`
                : "Start competing to unlock"}
            </h2>
          </div>
          {seeAllHref ? (
            <a
              href={seeAllHref}
              className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
            >
              See all →
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {items.map((item) => {
          const pct =
            item.goal && item.goal > 0
              ? Math.min(100, Math.round((item.current / item.goal) * 100))
              : item.unlocked
                ? 100
                : 0;

          return (
            <div
              key={item.id}
              className={`flex flex-col gap-2 rounded-2xl border p-3 transition ${
                item.unlocked
                  ? "border-yellow-300/50 bg-yellow-950/20 shadow-[0_0_22px_rgba(234,179,8,0.2)]"
                  : "border-zinc-800 bg-zinc-950/60"
              }`}
              aria-label={`${item.label} — ${item.unlocked ? "unlocked" : "locked"}`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`flex h-9 w-9 items-center justify-center rounded-xl text-xl ${
                    item.unlocked
                      ? "bg-yellow-900/40 ring-1 ring-yellow-300/40"
                      : "bg-black/45 ring-1 ring-zinc-700/60 opacity-60"
                  }`}
                >
                  {item.icon}
                </span>
                <div className="min-w-0">
                  <p
                    className={`truncate text-sm font-black ${
                      item.unlocked ? item.unlockedColor : "text-zinc-300"
                    }`}
                  >
                    {item.label}
                  </p>
                  <p className="truncate text-[10px] font-semibold text-zinc-500">
                    {item.unlocked
                      ? "Unlocked"
                      : item.goal === null
                        ? "Coming soon"
                        : `${item.current} / ${item.goal}`}
                  </p>
                </div>
              </div>
              {item.goal && !item.unlocked ? (
                <div className="h-1 overflow-hidden rounded-full bg-black/55">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-yellow-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
              <p className="text-[10px] leading-snug text-zinc-400">
                {item.unlocked ? item.description : item.lockedHint}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
