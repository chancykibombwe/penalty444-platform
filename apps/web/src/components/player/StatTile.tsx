"use client";

import type { ReactNode } from "react";

/**
 * Reusable stat tile for the competitive identity surfaces.
 *
 * Tones map to the platform palette:
 *   - cyan   : progression / activity
 *   - gold   : prestige / tournament accents
 *   - violet : elite tier touches
 *   - amber  : streaks / heat
 *   - rose   : losses / penalty states
 *   - neutral: default / no special context
 */
export type StatTileTone =
  | "cyan"
  | "gold"
  | "violet"
  | "amber"
  | "rose"
  | "neutral";

const TONE_CLASS: Record<
  StatTileTone,
  { border: string; bg: string; glow: string; valueText: string }
> = {
  cyan: {
    border: "border-cyan-400/35",
    bg: "bg-cyan-950/30",
    glow: "shadow-[0_0_22px_rgba(34,211,238,0.15)]",
    valueText: "text-cyan-100",
  },
  gold: {
    border: "border-yellow-300/45",
    bg: "bg-yellow-950/30",
    glow: "shadow-[0_0_22px_rgba(234,179,8,0.2)]",
    valueText: "text-yellow-100",
  },
  violet: {
    border: "border-violet-400/35",
    bg: "bg-violet-950/30",
    glow: "shadow-[0_0_22px_rgba(167,139,250,0.18)]",
    valueText: "text-violet-100",
  },
  amber: {
    border: "border-amber-400/35",
    bg: "bg-amber-950/30",
    glow: "shadow-[0_0_22px_rgba(251,191,36,0.16)]",
    valueText: "text-amber-100",
  },
  rose: {
    border: "border-rose-400/35",
    bg: "bg-rose-950/30",
    glow: "shadow-[0_0_22px_rgba(244,63,94,0.16)]",
    valueText: "text-rose-100",
  },
  neutral: {
    border: "border-zinc-800",
    bg: "bg-zinc-950/65",
    glow: "",
    valueText: "text-white",
  },
};

type Props = {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: StatTileTone;
  icon?: string;
  /** Optional secondary line (e.g. "Last 30 days"). */
  caption?: string;
  className?: string;
};

export default function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
  caption,
  className,
}: Props) {
  const t = TONE_CLASS[tone];
  return (
    <div
      className={`rounded-2xl border bg-zinc-950/65 px-3 py-3 ${t.border} ${t.bg} ${t.glow} ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
          {label}
        </p>
        {icon ? (
          <span aria-hidden className="text-base leading-none text-zinc-400">
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className={`mt-1 text-2xl font-black leading-none tabular-nums sm:text-3xl ${t.valueText}`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
          {hint}
        </p>
      ) : null}
      {caption ? (
        <p className="mt-0.5 text-[10px] font-semibold text-zinc-500">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
