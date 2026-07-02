import Link from "next/link";

/**
 * LiveStripEmpty — shared branded empty state for Home live/activity strips.
 *
 * Presentation-only. Used in the empty (not loading, not populated) branch of
 * the Home live/social strips so a sparse beta reads as *intentional* — a dark
 * arena panel with a soft "warming up" status pill — rather than looking broken
 * or fake. No data, no fetching, no new behavior; honest copy only (no fake
 * players/matches, no money/prize wording).
 */
export default function LiveStripEmpty({
  message,
  pill = "Beta warming up",
  ctaHref,
  ctaLabel,
}: {
  /** Concise, honest empty-state copy (each strip passes its own). */
  message: string;
  /** Small status pill; defaults to a neutral "warming up" state. */
  pill?: string;
  /** Optional safe CTA (e.g. "/lobby") — only where starting play is the action. */
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <div
      className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-arena-border bg-gradient-to-br from-arena-surface/70 to-black/40 px-4 py-6 text-center shadow-[inset_0_0_28px_rgba(59,158,255,0.05)]"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-arena-primary/40 bg-arena-primary/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-[0.2em] text-arena-primary">
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-arena-primary shadow-[0_0_8px_rgba(59,158,255,0.8)]"
          aria-hidden
        />
        {pill}
      </span>
      <p className="text-sm font-semibold text-zinc-400">{message}</p>
      {ctaHref && ctaLabel ? (
        <Link
          href={ctaHref}
          className="text-[11px] font-bold uppercase tracking-wider text-arena-primary transition-colors hover:text-[#9AD2FF] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-arena-primary/60"
        >
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
