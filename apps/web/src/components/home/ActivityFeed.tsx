"use client";

export type ActivityFeedTone = "live" | "win" | "info" | "champion";

export type ActivityFeedEvent = {
  id: string;
  /** Short headline like "Chancy defeated Mike". */
  message: string;
  /** Short context line e.g. "Friday Night Cup · Semifinals". */
  context?: string;
  /** Visual tone. */
  tone: ActivityFeedTone;
  /** Relative time string ready to render ("2m ago"). */
  relativeTime: string;
};

type Props = {
  events?: ActivityFeedEvent[];
  /** Optional anchor for "See more". */
  seeMoreHref?: string;
};

const MOCK_EVENTS: ActivityFeedEvent[] = [
  {
    id: "1",
    message: "Semifinal match is now LIVE",
    context: "Friday Night Cup · Match 7",
    tone: "live",
    relativeTime: "Just now",
  },
  {
    id: "2",
    message: "GoalKing won Friday Night Cup",
    context: "Tournament complete",
    tone: "champion",
    relativeTime: "3m ago",
  },
  {
    id: "3",
    message: "Chancy defeated Mike",
    context: "Quarterfinal · Penalty444",
    tone: "win",
    relativeTime: "5m ago",
  },
  {
    id: "4",
    message: "New tournament: Arena Cup opens registration",
    context: "8 spots open",
    tone: "info",
    relativeTime: "12m ago",
  },
  {
    id: "5",
    message: "Mike advances automatically",
    context: "Free pass to next round",
    tone: "info",
    relativeTime: "18m ago",
  },
];

const TONE_BORDER: Record<ActivityFeedTone, string> = {
  live: "border-cyan-400/45 bg-cyan-500/8",
  win: "border-emerald-400/40 bg-emerald-500/8",
  info: "border-zinc-700 bg-zinc-900/60",
  champion: "border-yellow-300/55 bg-yellow-500/8",
};

const TONE_DOT: Record<ActivityFeedTone, string> = {
  live: "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]",
  win: "bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
  info: "bg-zinc-400",
  champion: "bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.8)]",
};

const TONE_PILL: Record<ActivityFeedTone, string> = {
  live: "Live",
  win: "Win",
  info: "Info",
  champion: "Champion",
};

export default function ActivityFeed({
  events = MOCK_EVENTS,
  seeMoreHref,
}: Props) {
  const items = events.length > 0 ? events : MOCK_EVENTS;

  return (
    <section
      className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-950/65 to-black p-4 shadow-xl sm:p-5"
      aria-label="Recent activity feed"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/45 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
            <span
              className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
              aria-hidden
            />
            Live Activity
          </span>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Updating
          </p>
        </div>
        {seeMoreHref ? (
          <a
            href={seeMoreHref}
            className="text-[11px] font-bold uppercase tracking-wider text-cyan-300/85 hover:text-cyan-200"
          >
            See more →
          </a>
        ) : null}
      </div>

      <ul className="mt-4 grid gap-2">
        {items.map((event, index) => (
          <li
            key={event.id}
            className={`home-feed-item flex items-start gap-3 rounded-2xl border px-3 py-3 ${TONE_BORDER[event.tone]}`}
            style={{ animationDelay: `${Math.min(index * 50, 250)}ms` }}
          >
            <span
              className={`mt-1.5 inline-block h-2 w-2 shrink-0 animate-pulse rounded-full ${TONE_DOT[event.tone]}`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-white sm:text-base">
                {event.message}
              </p>
              {event.context ? (
                <p className="mt-0.5 text-[11px] text-zinc-400">
                  {event.context}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${TONE_BORDER[event.tone]}`}
              >
                {TONE_PILL[event.tone]}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                {event.relativeTime}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
