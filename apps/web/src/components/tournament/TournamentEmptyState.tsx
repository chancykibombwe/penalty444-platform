"use client";

import type { ReactNode } from "react";

type Tone = "live" | "upcoming" | "mine" | "completed" | "neutral";

type TournamentEmptyStateProps = {
  /** Visual tone — chooses border / glow / icon color. */
  tone?: Tone;
  /** Eyebrow text (uppercase pill). */
  eyebrow?: string;
  /** Headline (one short sentence). */
  headline: string;
  /** Optional supporting line — keep short. */
  subtext?: string;
  /** Optional CTA shown as a button-like link. Caller supplies the link. */
  cta?: ReactNode;
};

const TONE_STYLE: Record<Tone, { border: string; glow: string; icon: string }> = {
  live: {
    border: "border-cyan-500/30",
    glow: "from-cyan-950/15 via-zinc-950 to-black",
    icon: "📡",
  },
  upcoming: {
    border: "border-amber-500/30",
    glow: "from-amber-950/15 via-zinc-950 to-black",
    icon: "⏳",
  },
  mine: {
    border: "border-violet-500/30",
    glow: "from-violet-950/15 via-zinc-950 to-black",
    icon: "🎯",
  },
  completed: {
    border: "border-yellow-300/25",
    glow: "from-yellow-950/15 via-zinc-950 to-black",
    icon: "🏆",
  },
  neutral: {
    border: "border-zinc-800",
    glow: "from-zinc-950 via-zinc-950 to-black",
    icon: "✨",
  },
};

/**
 * Platform-friendly empty state. Never reads "No data" / "Empty" — always
 * implies the arena is alive and the next event is just around the corner.
 */
export default function TournamentEmptyState({
  tone = "neutral",
  eyebrow,
  headline,
  subtext,
  cta,
}: TournamentEmptyStateProps) {
  const t = TONE_STYLE[tone];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br px-4 py-7 text-center sm:px-6 sm:py-9 ${t.border} ${t.glow}`}
      aria-live="polite"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-16 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full opacity-25 blur-3xl"
        style={{
          background:
            tone === "live"
              ? "radial-gradient(circle, rgba(34,211,238,0.5), transparent 70%)"
              : tone === "upcoming"
                ? "radial-gradient(circle, rgba(251,191,36,0.45), transparent 70%)"
                : tone === "mine"
                  ? "radial-gradient(circle, rgba(167,139,250,0.4), transparent 70%)"
                  : tone === "completed"
                    ? "radial-gradient(circle, rgba(234,179,8,0.4), transparent 70%)"
                    : "radial-gradient(circle, rgba(244,244,245,0.18), transparent 70%)",
        }}
      />

      <div className="relative">
        <span
          className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-2xl"
          aria-hidden
        >
          {t.icon}
        </span>
        {eyebrow ? (
          <p className="mt-3 text-[10px] font-black uppercase tracking-[0.28em] text-zinc-500">
            {eyebrow}
          </p>
        ) : null}
        <h3 className="mt-2 text-base font-black tracking-tight text-white sm:text-lg">
          {headline}
        </h3>
        {subtext ? (
          <p className="mt-1.5 text-xs text-zinc-400 sm:text-sm">{subtext}</p>
        ) : null}
        {cta ? <div className="mt-4">{cta}</div> : null}
      </div>
    </div>
  );
}
