import Link from "next/link";
import type { ReactNode } from "react";
import HomeCardSurface from "../HomeCardSurface";
import HomeSectionTitle from "../HomeSectionTitle";

/**
 * DesktopPanel — titled card surface for the Home Desktop V1 layout.
 *
 * Presentation-only wrapper built on the PR #168 primitives (HomeCardSurface +
 * HomeSectionTitle) so every desktop panel (Recent Matches, Leaderboard, right
 * rail cards, beta/free-play panel) reads consistently with arena-* tokens.
 *
 * Desktop-only surfaces mount this inside a `hidden lg:*` container — this
 * component itself has no breakpoint opinion so it can be reused/tested freely.
 */
export default function DesktopPanel({
  title,
  action,
  children,
  className,
  bodyClassName,
  raised = false,
}: {
  /** Uppercase section label (locked copy). */
  title: string;
  /** Optional trailing action link (e.g. "VIEW LOBBY →"). */
  action?: { href: string; label: string };
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  raised?: boolean;
}) {
  return (
    <HomeCardSurface raised={raised} className={`p-3.5 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <HomeSectionTitle>{title}</HomeSectionTitle>
        {action ? (
          <Link
            href={action.href}
            className="shrink-0 text-[10px] font-black uppercase tracking-[0.16em] text-arena-primary transition-colors hover:text-[#9AD2FF] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-arena-primary/60"
          >
            {action.label}
          </Link>
        ) : null}
      </div>
      <div className={`mt-3 ${bodyClassName ?? ""}`}>{children}</div>
    </HomeCardSurface>
  );
}
