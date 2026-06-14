"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type QuickActionCardProps = {
  title: string;
  subtitle: string;
  href: string;
  cta: string;
  /** Inline icon node (emoji or SVG). Kept simple — no extra deps. */
  icon: ReactNode;
  /** Color flavor for the card glow + CTA. */
  tone?: "cyan" | "amber" | "purple";
};

const TONE_CLASSES: Record<NonNullable<QuickActionCardProps["tone"]>, {
  border: string;
  glow: string;
  iconRing: string;
  ctaBg: string;
  ctaText: string;
}> = {
  cyan: {
    border: "border-[#3B9EFF]/45",
    glow: "shadow-[0_0_28px_rgba(59,158,255,0.18)] hover:shadow-[0_0_38px_rgba(59,158,255,0.32)]",
    iconRing: "border-[#3B9EFF]/55 bg-[#3B9EFF]/15 text-[#9AD2FF]",
    ctaBg: "bg-gradient-to-r from-[#3B9EFF] to-[#1E6FE0]",
    ctaText: "text-white",
  },
  purple: {
    border: "border-[#8B5CF6]/45",
    glow: "shadow-[0_0_28px_rgba(139,92,246,0.18)] hover:shadow-[0_0_38px_rgba(139,92,246,0.32)]",
    iconRing: "border-[#8B5CF6]/55 bg-[#8B5CF6]/15 text-[#C4B5FD]",
    ctaBg: "bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9]",
    ctaText: "text-white",
  },
  amber: {
    border: "border-amber-400/45",
    glow: "shadow-[0_0_28px_rgba(251,191,36,0.16)] hover:shadow-[0_0_38px_rgba(251,191,36,0.28)]",
    iconRing: "border-amber-400/55 bg-amber-500/15 text-amber-100",
    ctaBg: "bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400",
    ctaText: "text-zinc-950",
  },
};

export default function QuickActionCard({
  title,
  subtitle,
  href,
  cta,
  icon,
  tone = "cyan",
}: QuickActionCardProps) {
  const t = TONE_CLASSES[tone];

  return (
    <Link
      href={href}
      className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br from-zinc-950 via-zinc-950/70 to-black p-2 transition-transform hover:scale-[1.015] sm:p-3.5 ${t.border} ${t.glow}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-12 -right-10 h-32 w-32 rounded-full opacity-30 blur-2xl transition-opacity group-hover:opacity-60"
        style={{
          background:
            tone === "cyan"
              ? "radial-gradient(circle, rgba(59,158,255,0.55), transparent 70%)"
              : tone === "purple"
                ? "radial-gradient(circle, rgba(139,92,246,0.5), transparent 70%)"
                : "radial-gradient(circle, rgba(251,191,36,0.5), transparent 70%)",
        }}
      />

      <div className="relative flex items-center gap-2">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border text-sm sm:h-9 sm:w-9 sm:rounded-2xl sm:text-lg ${t.iconRing}`}
          aria-hidden
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-black uppercase tracking-tight text-white sm:text-base">
            {title}
          </h3>
          <p className="truncate text-[11px] text-zinc-400 sm:text-sm">{subtitle}</p>
        </div>
      </div>

      <span
        className={`relative mt-1.5 inline-flex min-h-[34px] w-full items-center justify-center gap-2 rounded-xl px-3 py-1 text-xs font-black uppercase tracking-wide sm:mt-2 sm:min-h-[40px] sm:w-auto sm:px-4 sm:py-1.5 sm:text-sm ${t.ctaBg} ${t.ctaText}`}
      >
        {cta}
        <span aria-hidden>→</span>
      </span>
    </Link>
  );
}
