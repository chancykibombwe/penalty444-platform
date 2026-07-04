import type { ReactNode } from "react";
import HomeTopBar from "./HomeTopBar";
import BottomMobileNav from "./BottomMobileNav";

/**
 * HomeMobileShell — structural shell for the Home redesign (locked Figma
 * frames: Home Mobile 390/360 V1).
 *
 * Scaffold only: renders the mobile top bar above the page content and the
 * mobile bottom nav below it. Both are `md:hidden`, so desktop renders the
 * children exactly as before (global Navbar unchanged on md+).
 *
 * The page container rhythm (16px side padding via the layout's `p-4`,
 * `max-w-6xl`, `space-y-6 sm:space-y-8`) is owned by the existing Home
 * container passed as children — this shell adds no wrapper of its own, so
 * current spacing is preserved byte-for-byte.
 *
 * Section slots for the redesign (Hero / Quick Actions / Games / Stats) are
 * marked inside the Home page with `data-home-slot` attributes; later Home
 * PRs replace the content inside those slots.
 */
export default function HomeMobileShell({ children }: { children: ReactNode }) {
  return (
    <>
      <HomeTopBar />
      {children}
      <BottomMobileNav />
    </>
  );
}
