import FreePlayPill from "../FreePlayPill";

/**
 * DesktopHeader — contextual Home page header band for the Home Desktop V1
 * layout.
 *
 * Sits at the top of the desktop Home grid, directly below the global Navbar.
 * To avoid duplicating the Navbar's brand lockup + notification bell (which
 * created a crowded, top-heavy stack), this is a LIGHT contextual welcome
 * strip: a small brand/beta eyebrow, a page title, and the ⚡ FREE PLAY pill
 * (which the global Navbar does not show). The global Navbar remains the
 * primary desktop nav / auth / notifications surface — routing, auth, and
 * notification behavior are untouched here.
 *
 * Presentation-only; token-based (arena-*).
 */
export default function DesktopHeader() {
  return (
    <header className="flex items-center justify-between gap-4 rounded-2xl border border-arena-border bg-arena-surface/50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-arena-muted">
          444 Arena · Free Play Beta
        </p>
        <p className="mt-0.5 truncate text-lg font-black tracking-tight text-white">
          Welcome to the arena
        </p>
      </div>

      <FreePlayPill />
    </header>
  );
}
