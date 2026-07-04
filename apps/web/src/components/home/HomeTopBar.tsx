import Link from "next/link";
import FreePlayPill from "./FreePlayPill";
import NotificationBell from "../live/NotificationBell";

/**
 * HomeTopBar — mobile top bar for the Home redesign (locked Figma frames:
 * Home Mobile 390/360 V1).
 *
 * Mobile-only (`md:hidden`): on Home mobile the global Navbar header is
 * hidden (Navbar hides itself on `/` below `md`) and this bar takes over —
 * premium text-based 444 ARENA wordmark, the ⚡ FREE PLAY pill, and the
 * existing NotificationBell (reused as-is, not rewritten).
 *
 * Presentation-only; token-based (arena-*), no raw hex for brand color.
 * Desktop (md+) keeps the global Navbar unchanged.
 */
export default function HomeTopBar() {
  return (
    <header className="mx-auto mb-4 flex max-w-6xl items-center justify-between gap-3 md:hidden">
      <Link
        href="/"
        className="flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        aria-label="444 ARENA home"
      >
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-arena-primary to-arena-primary-deep text-[11px] font-black text-white shadow-[0_0_16px_rgba(59,158,255,0.35)]"
          aria-hidden
        >
          444
        </span>
        <span className="text-sm font-black tracking-[0.08em] text-white">
          444 ARENA
        </span>
      </Link>

      <div className="flex items-center gap-2">
        <FreePlayPill />
        <NotificationBell />
      </div>
    </header>
  );
}
