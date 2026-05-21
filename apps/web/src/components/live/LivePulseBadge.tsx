"use client";

/**
 * Reusable "live state" pill with a subtle animated dot.
 *
 * Use everywhere the platform needs to communicate that something is
 * happening RIGHT NOW (live matches, live tournaments, online players,
 * notifications open). Stays static when `pulsing` is false so it can
 * also stand in as a non-distracting status chip.
 *
 * Tones map to the platform's live colour grammar:
 *  - cyan       = generic "live"
 *  - emerald    = wins / positive
 *  - amber/gold = champion / promotions
 *  - rose       = elimination / loss
 *  - neutral    = idle status
 */
export type LivePulseTone =
  | "cyan"
  | "emerald"
  | "amber"
  | "rose"
  | "neutral";

type Size = "sm" | "md";

type Props = {
  label: string;
  tone?: LivePulseTone;
  size?: Size;
  /** Pulse the inner dot. Defaults to true. */
  pulsing?: boolean;
  /** Optional numeric badge displayed after the label (e.g. count). */
  count?: number;
  className?: string;
};

const TONE_CHIP: Record<LivePulseTone, string> = {
  cyan: "border-cyan-400/45 bg-cyan-500/10 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)]",
  emerald:
    "border-emerald-400/45 bg-emerald-500/10 text-emerald-100 shadow-[0_0_18px_rgba(52,211,153,0.18)]",
  amber:
    "border-yellow-300/55 bg-yellow-500/10 text-yellow-100 shadow-[0_0_18px_rgba(250,204,21,0.22)]",
  rose: "border-rose-400/45 bg-rose-500/10 text-rose-100 shadow-[0_0_18px_rgba(244,114,182,0.18)]",
  neutral: "border-zinc-700 bg-zinc-900/60 text-zinc-200",
};

const TONE_DOT: Record<LivePulseTone, string> = {
  cyan: "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.85)]",
  emerald: "bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.8)]",
  amber: "bg-yellow-300 shadow-[0_0_10px_rgba(250,204,21,0.85)]",
  rose: "bg-rose-300 shadow-[0_0_8px_rgba(244,114,182,0.8)]",
  neutral: "bg-zinc-400",
};

const SIZE: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-[11px]",
};

export default function LivePulseBadge({
  label,
  tone = "cyan",
  size = "sm",
  pulsing = true,
  count,
  className,
}: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-black uppercase tracking-[0.22em] ${TONE_CHIP[tone]} ${SIZE[size]} ${className ?? ""}`}
      aria-label={label}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} ${pulsing ? "animate-pulse" : ""}`}
      />
      <span>{label}</span>
      {typeof count === "number" ? (
        <span className="ml-1 rounded-md bg-black/30 px-1.5 py-0.5 text-[9px] font-black tabular-nums text-white/90">
          {count.toLocaleString()}
        </span>
      ) : null}
    </span>
  );
}
