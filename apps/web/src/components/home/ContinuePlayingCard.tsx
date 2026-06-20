"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Tone = "match" | "tournament";

type ContinuePlayingCardProps = {
  tone: Tone;
  eyebrow: string;
  title: string;
  subtitle: string;
  href: string;
  cta: string;
  icon: ReactNode;
};

const TONE_CLASSES: Record<Tone, {
  border: string;
  gradient: string;
  glow: string;
  pill: string;
  cta: string;
}> = {
  match: {
    border: "border-emerald-400/55",
    gradient: "from-emerald-950/30 via-zinc-950 to-black",
    glow: "shadow-[0_0_28px_rgba(52,211,153,0.22)]",
    pill: "border-emerald-400/55 bg-emerald-500/15 text-emerald-100",
    cta: "from-emerald-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300",
  },
  tournament: {
    border: "border-cyan-400/55",
    gradient: "from-cyan-950/30 via-zinc-950 to-black",
    glow: "shadow-[0_0_32px_rgba(34,211,238,0.24)]",
    pill: "border-cyan-400/55 bg-cyan-500/15 text-cyan-100",
    cta: "from-cyan-400 to-amber-500 hover:from-cyan-300 hover:to-amber-400",
  },
};

export default function ContinuePlayingCard({
  tone,
  eyebrow,
  title,
  subtitle,
  href,
  cta,
  icon,
}: ContinuePlayingCardProps) {
  const t = TONE_CLASSES[tone];

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border-2 bg-gradient-to-br p-3.5 shadow-2xl sm:p-4 motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:scale-[1.02] motion-safe:active:scale-[0.98] ${t.border} ${t.gradient} ${t.glow}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full opacity-40 blur-3xl"
        style={{
          background:
            tone === "match"
              ? "radial-gradient(circle, rgba(52,211,153,0.6), transparent 70%)"
              : "radial-gradient(circle, rgba(34,211,238,0.6), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3 sm:items-center">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-lg ${t.pill}`}
            aria-hidden
          >
            {icon}
          </div>
          <div className="min-w-0">
            <span
              className={`home-live-pulse inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.22em] ${t.pill}`}
            >
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current opacity-90"
                aria-hidden
              />
              {eyebrow}
            </span>
            <h3 className="mt-1.5 break-words text-base font-black tracking-tight text-white sm:text-lg">
              {title}
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400 sm:text-sm">{subtitle}</p>
          </div>
        </div>

        <Link
          href={href}
          className={`inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r px-5 py-2.5 text-sm font-black tracking-wide text-zinc-950 shadow-lg transition-all duration-150 sm:w-auto ${t.cta}`}
        >
          {cta}
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}
