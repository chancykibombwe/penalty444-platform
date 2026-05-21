"use client";

import {
  derivePresence,
  PRESENCE_LABEL,
  PRESENCE_TONE,
  type PresenceInput,
  type PresenceState,
} from "../../lib/social/presence";

/**
 * Compact "presence" status chip.
 *
 * Display-only — derives from existing data (matches played, last match
 * date, live tournament participation). Never claims real-time "online".
 *
 * Accepts either a pre-computed `state` or a raw `PresenceInput` for
 * convenience at call sites.
 */
type Props =
  | { state: PresenceState; size?: Size; className?: string }
  | (PresenceInput & { state?: never; size?: Size; className?: string });

type Size = "sm" | "md";

type Tone = "cyan" | "amber" | "emerald" | "violet" | "neutral";

const TONE_CHIP: Record<Tone, string> = {
  cyan: "border-cyan-400/45 bg-cyan-500/12 text-cyan-100",
  amber: "border-amber-400/45 bg-amber-500/12 text-amber-100",
  emerald: "border-emerald-400/45 bg-emerald-500/12 text-emerald-100",
  violet: "border-violet-400/45 bg-violet-500/12 text-violet-100",
  neutral: "border-zinc-700 bg-zinc-900/70 text-zinc-200",
};

const TONE_DOT: Record<Tone, string> = {
  cyan: "bg-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.85)]",
  amber: "bg-amber-300 shadow-[0_0_8px_rgba(250,204,21,0.75)]",
  emerald: "bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.75)]",
  violet: "bg-violet-300 shadow-[0_0_8px_rgba(192,132,252,0.75)]",
  neutral: "bg-zinc-400",
};

const SIZE_CHIP: Record<Size, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-[11px]",
};

export default function PresenceBadge(props: Props) {
  const size: Size = props.size ?? "sm";
  const className = props.className ?? "";

  const state: PresenceState =
    props.state ??
    derivePresence({
      matchesPlayed: props.matchesPlayed,
      lastMatchAt: props.lastMatchAt,
      isInLiveMatch: props.isInLiveMatch,
      isInTournament: props.isInTournament,
    });

  const tone = PRESENCE_TONE[state];
  const label = PRESENCE_LABEL[state];
  const pulse = tone === "cyan" || tone === "amber";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-black uppercase tracking-[0.22em] ${TONE_CHIP[tone]} ${SIZE_CHIP[size]} ${className}`}
      aria-label={`Status: ${label}`}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${TONE_DOT[tone]} ${pulse ? "animate-pulse" : ""}`}
      />
      <span>{label}</span>
    </span>
  );
}
