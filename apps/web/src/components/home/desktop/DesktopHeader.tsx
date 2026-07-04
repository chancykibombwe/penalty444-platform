import Link from "next/link";
import FreePlayPill from "../FreePlayPill";
import NotificationBell from "../../live/NotificationBell";

/**
 * DesktopHeader — contextual Home page header band for the Home Desktop V1
 * layout.
 *
 * Additive page chrome that sits at the top of the desktop Home grid: brand
 * wordmark, ⚡ FREE PLAY pill, and the reused NotificationBell. It does NOT
 * replace the global Navbar (which remains the app's primary desktop nav /
 * auth surface) — routing and auth behavior are untouched.
 *
 * Presentation-only; token-based (arena-*).
 */
export default function DesktopHeader() {
  return (
    <header className="flex items-center justify-between gap-4 rounded-2xl border border-arena-border bg-arena-surface/80 px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <Link
        href="/"
        className="flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-arena-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
        aria-label="444 ARENA home"
      >
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-arena-primary to-arena-primary-deep text-xs font-black text-white shadow-[0_0_16px_rgba(59,158,255,0.35)]"
          aria-hidden
        >
          444
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-base font-black tracking-[0.08em] text-white">
            444 ARENA
          </span>
          <span className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-arena-muted">
            Free Play Beta
          </span>
        </span>
      </Link>

      <div className="flex items-center gap-3">
        <FreePlayPill />
        <NotificationBell />
      </div>
    </header>
  );
}
