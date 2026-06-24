import Link from "next/link";

export const metadata = {
  title: "News & Announcements — 444 Arena",
  description: "Latest updates, feature announcements, and beta news from 444 Arena.",
};

const ALL_NEWS = [
  {
    id: "beta-launch",
    tag: "Beta Update",
    tagColor: "rgba(99,140,255,0.90)",
    tagBg: "rgba(55,85,160,0.20)",
    tagBorder: "rgba(55,85,160,0.35)",
    title: "Free Play Beta is Live",
    body: "Penalty444 is available in free-play beta. Create a free account, enter the lobby, and compete on the leaderboard. No entry fees and no real money — skill only.",
    date: "Jun 2026",
    pinned: true,
  },
  {
    id: "tournaments-testing",
    tag: "Feature",
    tagColor: "rgba(99,140,255,0.90)",
    tagBg: "rgba(55,85,160,0.20)",
    tagBorder: "rgba(55,85,160,0.35)",
    title: "Tournament Testing Underway",
    body: "Free-entry single-elimination brackets are now available for testing. Hosts can create a tournament room and invite players. More tournament formats are planned.",
    date: "Jun 2026",
    pinned: false,
  },
  {
    id: "rank-by-filter",
    tag: "Feature",
    tagColor: "rgba(99,140,255,0.90)",
    tagBg: "rgba(55,85,160,0.20)",
    tagBorder: "rgba(55,85,160,0.35)",
    title: "Leaderboard Rank By Filter Added",
    body: "You can now sort the leaderboard by Rating or Win Rate. Players with fewer than 20 matches show as Provisional and are not assigned an official rank.",
    date: "Jun 2026",
    pinned: false,
  },
  {
    id: "help-center",
    tag: "Support",
    tagColor: "rgba(148,163,255,0.90)",
    tagBg: "rgba(55,85,160,0.15)",
    tagBorder: "rgba(55,85,160,0.28)",
    title: "Help Center Now Available",
    body: "A Help Center is now live at /support. Find answers to common questions, learn about the fair play rules, and report issues directly from the site.",
    date: "Jun 2026",
    pinned: false,
  },
  {
    id: "wallet-future",
    tag: "Coming Soon",
    tagColor: "rgba(251,191,36,0.85)",
    tagBg: "rgba(255,200,50,0.08)",
    tagBorder: "rgba(255,200,50,0.22)",
    title: "Wallet & Prize Pools — Future Feature",
    body: "Wallet, deposit, withdrawal, and cash prize features are planned for a future release after the beta. They are not available now and no real-money play is active.",
    date: "Upcoming",
    pinned: false,
  },
  {
    id: "more-games",
    tag: "Coming Soon",
    tagColor: "rgba(251,191,36,0.85)",
    tagBg: "rgba(255,200,50,0.08)",
    tagBorder: "rgba(255,200,50,0.22)",
    title: "More Games Planned for 444 Arena",
    body: "Chess444, Draught444, and Crush444 are in development. The full 444 Arena multi-game platform is a future release — only Penalty444 is live in beta.",
    date: "Upcoming",
    pinned: false,
  },
] as const;

export default function NewsPage() {
  const pinned = ALL_NEWS.filter((n) => n.pinned);
  const rest = ALL_NEWS.filter((n) => !n.pinned);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-8">
      {/* Header */}
      <div
        className="rounded-2xl px-5 py-5"
        style={{
          background: "rgba(10,14,26,0.95)",
          border: "1px solid rgba(55,85,160,0.35)",
        }}
      >
        <p className="text-[9px] font-black uppercase tracking-[0.28em] text-zinc-500">
          444 Arena
        </p>
        <h1 className="mt-1 text-xl font-black text-white">News &amp; Announcements</h1>
        <p className="mt-1 text-[12px] leading-snug text-zinc-400">
          Latest updates, feature releases, and platform notices for the 444 Arena beta.
        </p>
        <div className="mt-3">
          <Link
            href="/"
            className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-zinc-400"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}
          >
            ← Back to Home
          </Link>
        </div>
      </div>

      {/* Pinned */}
      {pinned.map((item) => (
        <article
          key={item.id}
          className="rounded-2xl px-4 py-4"
          style={{
            background: "rgba(10,14,26,0.95)",
            border: "1px solid rgba(55,85,160,0.45)",
            boxShadow: "0 0 20px rgba(55,85,160,0.10)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]"
              style={{
                background: item.tagBg,
                border: `1px solid ${item.tagBorder}`,
                color: item.tagColor,
              }}
            >
              {item.tag}
            </span>
            <span className="text-[9px] text-zinc-600">{item.date}</span>
          </div>
          <h2 className="mt-2 text-[14px] font-black leading-snug text-white">
            {item.title}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{item.body}</p>
        </article>
      ))}

      {/* All other news */}
      <section aria-label="All announcements">
        <p className="mb-3 text-[9px] font-black uppercase tracking-[0.24em] text-zinc-500 sm:text-[10px]">
          All Updates
        </p>
        <div className="space-y-2">
          {rest.map((item) => (
            <article
              key={item.id}
              className="rounded-xl px-4 py-3"
              style={{
                background: "rgba(10,14,26,0.90)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.18em]"
                  style={{
                    background: item.tagBg,
                    border: `1px solid ${item.tagBorder}`,
                    color: item.tagColor,
                  }}
                >
                  {item.tag}
                </span>
                <span className="text-[9px] text-zinc-600">{item.date}</span>
              </div>
              <h2 className="mt-1.5 text-[12px] font-black leading-snug text-white">
                {item.title}
              </h2>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="rounded-2xl border border-[#1B2433] bg-[#0D1420]/60 px-4 py-3 text-center text-[11px] text-zinc-500">
        444 Arena · News & Announcements · Free play beta — no real-money features
      </footer>
    </div>
  );
}
