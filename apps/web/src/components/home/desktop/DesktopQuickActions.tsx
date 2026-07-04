import QuickActionCard from "../QuickActionCard";

/**
 * DesktopQuickActions — the desktop Home quick-action row.
 *
 * Locked desktop set (brief §3): QUICK MATCH / CREATE ROOM / JOIN ROOM /
 * PRACTICE. The first three route to existing lobby flows (no new routes).
 * PRACTICE has no real destination in the app yet, so — per the brief — it is
 * shown as a disabled "Coming Soon" tile rather than a faked/broken link.
 *
 * Reuses the shared QuickActionCard (PR #170) for the real actions, with
 * `wrapSubtitle` so subtitles wrap cleanly instead of truncating on desktop.
 * Free Play only; no stakes / rewards wording.
 */
export default function DesktopQuickActions() {
  return (
    <section
      className="grid grid-cols-2 items-stretch gap-3 xl:grid-cols-4"
      aria-label="Quick actions"
    >
      <QuickActionCard
        title="QUICK MATCH"
        subtitle="Jump into a live 1v1 battle."
        cta="PLAY FREE"
        href="/lobby"
        tone="cyan"
        icon="⚡"
        wrapSubtitle
      />
      <QuickActionCard
        title="CREATE ROOM"
        subtitle="Invite a friend and settle it."
        cta="CREATE"
        href="/lobby"
        tone="purple"
        icon="🔒"
        wrapSubtitle
      />
      <QuickActionCard
        title="JOIN ROOM"
        subtitle="Enter a room code from a friend."
        cta="JOIN"
        href="/lobby"
        tone="cyan"
        icon="🎟"
        wrapSubtitle
      />

      {/* PRACTICE — no real destination yet, shown as a disabled Coming Soon
          tile. Not a link (no faked route). */}
      <div
        aria-disabled="true"
        className="group relative overflow-hidden rounded-2xl border border-arena-border bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black p-2 opacity-90 sm:p-3.5"
      >
        <div className="relative flex items-center gap-2">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-arena-border bg-black/40 text-sm text-arena-muted sm:h-9 sm:w-9 sm:rounded-2xl sm:text-lg"
            aria-hidden
          >
            🎯
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-black uppercase tracking-tight text-white sm:text-base">
              PRACTICE
            </h3>
            <p className="text-[11px] text-zinc-400 line-clamp-2 sm:text-sm">
              Solo drills to sharpen up.
            </p>
          </div>
        </div>
        <span className="relative mt-1.5 inline-flex min-h-[34px] w-full items-center justify-center gap-2 rounded-xl border border-arena-border bg-black/40 px-3 py-1 text-xs font-black uppercase tracking-wide text-arena-muted sm:mt-2 sm:min-h-[40px] sm:px-4 sm:py-1.5 sm:text-sm">
          Coming Soon
        </span>
      </div>
    </section>
  );
}
