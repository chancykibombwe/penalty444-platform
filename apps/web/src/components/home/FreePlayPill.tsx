/**
 * FreePlayPill — small "⚡ FREE PLAY" status pill for the Home redesign.
 *
 * Foundation primitive (Home UI Design System — see
 * docs/home-ui-implementation-brief.md). Presentation-only, token-based
 * (arena-primary), no raw hex. Not yet wired into a layout — HomeTopBar
 * (a later Home PR) will consume it. Free Play only; no money/reward wording.
 */
export default function FreePlayPill({ className }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-arena-primary/40 bg-arena-primary/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] text-arena-primary ${className ?? ""}`}
    >
      <span aria-hidden>⚡</span>
      FREE PLAY
    </span>
  );
}
