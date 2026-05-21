"use client";

/**
 * Display-only tournament trophies preview.
 *
 * Phase 5 doesn't ship a trophy backend yet. If `count` is 0 we render the
 * platform-friendly empty state ("No trophies yet"). Once a real list of
 * trophies is available, this component can swap to rendering the array.
 */
type Trophy = {
  id: string;
  label: string;
  tier: "gold" | "silver" | "bronze";
  /** ISO date string of when the trophy was earned. */
  earnedAt?: string;
};

type Props = {
  count: number;
  /** Optional rich list (rendered when present, otherwise a count summary). */
  trophies?: ReadonlyArray<Trophy>;
};

export default function TrophiesPreview({ count, trophies }: Props) {
  const hasAny = count > 0;

  return (
    <section
      className="rounded-2xl border border-zinc-800/80 bg-black/45 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:p-6"
      aria-label="Tournament trophies"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            Trophies
          </p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
            {hasAny ? `${count} tournament ${count === 1 ? "win" : "wins"}` : "No trophies yet"}
          </h2>
        </div>
        {hasAny ? (
          <span className="text-[11px] font-bold uppercase tracking-wider text-yellow-300/85">
            Champion run
          </span>
        ) : null}
      </div>

      {hasAny ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3">
          {trophies && trophies.length > 0
            ? trophies.slice(0, 6).map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 rounded-2xl border border-yellow-300/45 bg-yellow-950/25 px-3 py-3 shadow-[0_0_22px_rgba(234,179,8,0.18)]"
                >
                  <span aria-hidden className="text-2xl">
                    🏆
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-yellow-100">
                      {t.label}
                    </p>
                    {t.earnedAt ? (
                      <p className="truncate text-[10px] font-semibold text-yellow-200/70">
                        {new Date(t.earnedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))
            : Array.from({ length: Math.min(count, 6) }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-2xl border border-yellow-300/45 bg-yellow-950/25 px-3 py-3 shadow-[0_0_22px_rgba(234,179,8,0.18)]"
                >
                  <span aria-hidden className="text-2xl">
                    🏆
                  </span>
                  <p className="text-sm font-black text-yellow-100">
                    Tournament Champion
                  </p>
                </div>
              ))}
        </div>
      ) : (
        <p className="mt-2 max-w-md text-sm text-zinc-400">
          Win a bracketed tournament to start your trophy case.
        </p>
      )}
    </section>
  );
}
