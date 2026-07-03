import type { ReactNode } from "react";

/**
 * HomeCardSurface — standard dark card surface for the Home redesign.
 *
 * Foundation primitive (Home UI Design System — see
 * docs/home-ui-implementation-brief.md). Wraps children in the brand dark
 * surface + subtle border using arena-* tokens (no raw hex), so every Home
 * card reads consistently. Presentation-only; not yet wired into a layout —
 * later Home PRs consume it. `raised` uses the alt (slightly lighter) surface.
 */
export default function HomeCardSurface({
  children,
  className,
  raised = false,
}: {
  children: ReactNode;
  className?: string;
  /** Use the raised (alt) surface for elevated cards. */
  raised?: boolean;
}) {
  const surface = raised ? "bg-arena-surface-alt" : "bg-arena-surface";
  return (
    <div
      className={`rounded-2xl border border-arena-border ${surface} shadow-[0_8px_32px_rgba(0,0,0,0.4)] ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
