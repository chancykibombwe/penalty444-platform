import type { ReactNode } from "react";

/**
 * HomeSectionTitle — reusable section header for the Home redesign.
 *
 * Foundation primitive (Home UI Design System — see
 * docs/home-ui-implementation-brief.md). Mirrors the section-label style
 * established in PR #165: a neon cyan/blue accent tick (arena-primary token)
 * + uppercase label. Presentation-only, token-based (no raw hex for brand
 * color). Not yet wired into a layout — later Home PRs consume it so section
 * headers stay consistent across the redesign.
 */
export default function HomeSectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.28em] text-zinc-400 sm:text-[10px] sm:tracking-[0.32em] ${className ?? ""}`}
    >
      <span
        aria-hidden
        className="inline-block h-3 w-[3px] shrink-0 rounded-full bg-gradient-to-b from-arena-primary to-arena-primary-deep shadow-[0_0_8px_rgba(59,158,255,0.6)]"
      />
      {children}
    </p>
  );
}
