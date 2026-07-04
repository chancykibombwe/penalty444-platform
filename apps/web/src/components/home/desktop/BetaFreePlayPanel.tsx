import Link from "next/link";
import HomeCardSurface from "../HomeCardSurface";

/**
 * BetaFreePlayPanel — left-column beta / free-play panel for the Home Desktop
 * V1 layout.
 *
 * Three locked blocks: BETA SEASON, FREE PLAY MODE, GIVE FEEDBACK. Static,
 * presentation-only, beta-safe copy (no money/prizes/rewards, no wallet
 * activation). GIVE FEEDBACK links to the existing /support report page — it
 * does NOT touch the locked Account/Match-End feedback surfaces.
 */
export default function BetaFreePlayPanel() {
  return (
    <HomeCardSurface className="overflow-hidden p-0">
      {/* BETA SEASON */}
      <div className="border-b border-arena-border px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-arena-green shadow-[0_0_8px_rgba(34,197,94,0.8)]"
            aria-hidden
          />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-arena-green">
            BETA SEASON
          </p>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">
          444 ARENA is in free-play beta. Compete, climb the ranks, and help us
          test — all skill, no stakes.
        </p>
      </div>

      {/* FREE PLAY MODE */}
      <div className="border-b border-arena-border px-3.5 py-3">
        <div className="flex items-center gap-1.5">
          <span aria-hidden className="text-[11px]">
            ⚡
          </span>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-arena-primary">
            FREE PLAY MODE
          </p>
        </div>
        <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">
          Every match is free. No deposits, no withdrawals, no cash prizes.
          Wallet is coming soon.
        </p>
      </div>

      {/* GIVE FEEDBACK */}
      <div className="px-3.5 py-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
          GIVE FEEDBACK
        </p>
        <p className="mt-1.5 text-[12px] leading-snug text-zinc-400">
          Hit a bug or have an idea? Tell us — it shapes the launch.
        </p>
        <Link
          href="/support#report"
          className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-arena-border bg-black/30 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-zinc-200 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
        >
          Report / Suggest <span aria-hidden>→</span>
        </Link>
      </div>
    </HomeCardSurface>
  );
}
