"use client";

/**
 * Recent form widget — last N match outcomes as colored pills.
 *
 * Display-only. Reads from a `recentForm` array (most recent first). Empty
 * state renders "Play a match to start your form" so the section never
 * feels broken.
 */
type Outcome = "W" | "L" | "D";

type Props = {
  form?: ReadonlyArray<Outcome> | null;
  max?: number;
  className?: string;
};

const COLOR: Record<Outcome, string> = {
  W: "border-emerald-400/55 bg-emerald-500/15 text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,0.18)]",
  L: "border-rose-400/55 bg-rose-500/15 text-rose-100 shadow-[0_0_18px_rgba(244,63,94,0.18)]",
  D: "border-yellow-400/55 bg-yellow-500/15 text-yellow-100 shadow-[0_0_16px_rgba(250,204,21,0.18)]",
};

export default function RecentForm({ form, max = 5, className }: Props) {
  const hasForm = Array.isArray(form) && form.length > 0;
  const items: Outcome[] = hasForm ? (form as Outcome[]).slice(0, max) : [];

  return (
    <section
      className={`rounded-2xl border border-zinc-800/80 bg-black/45 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.35)] sm:p-6 ${className ?? ""}`}
      aria-label="Recent form"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
            Recent Form
          </p>
          <h2 className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
            {hasForm ? "Last " + items.length + " matches" : "No matches yet"}
          </h2>
        </div>
        {hasForm ? (
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
            Most recent left
          </p>
        ) : null}
      </div>

      {hasForm ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {items.map((o, i) => (
            <span
              key={i}
              className={`flex h-9 w-9 items-center justify-center rounded-xl border text-sm font-black ${COLOR[o]}`}
              aria-label={
                o === "W" ? "Win" : o === "L" ? "Loss" : "Draw"
              }
            >
              {o}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-zinc-400">
          Play a match to start building your form.
        </p>
      )}
    </section>
  );
}
