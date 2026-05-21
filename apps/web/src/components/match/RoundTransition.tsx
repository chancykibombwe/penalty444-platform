"use client";

import type { PresentationAccent } from "./matchPresentation";

/**
 * Brief cinematic overlay shown when the round advances.
 *
 * Display-only. Parent mounts with `visible=true`, picks a `kind`, and is
 * responsible for unmounting after `ROUND_TRANSITION_VISIBLE_MS`.
 *
 * Kinds:
 *   - ROUND_1     → "Round 1" (subtle cyan/gold tint)
 *   - ROUND_X     → "Round N" (subtle)
 *   - FINAL_SHOT  → "Final Shot" (warm red glow)
 *   - SUDDEN_DEATH→ "SUDDEN DEATH" (gold, high-pressure)
 */
export type RoundTransitionKind =
  | "ROUND_1"
  | "ROUND_X"
  | "FINAL_SHOT"
  | "SUDDEN_DEATH";

export default function RoundTransition({
  visible,
  kind,
  label,
  sublabel,
  accent = "cyan",
}: {
  visible: boolean;
  kind: RoundTransitionKind;
  label: string;
  sublabel?: string;
  accent?: PresentationAccent;
}) {
  if (!visible) return null;

  const isSuddenDeath = kind === "SUDDEN_DEATH";
  const isFinalShot = kind === "FINAL_SHOT";

  const cardClass = isSuddenDeath
    ? "border-amber-300/70 bg-gradient-to-b from-amber-900/45 via-zinc-950/85 to-black shadow-[0_0_48px_rgba(234,179,8,0.4)]"
    : isFinalShot
      ? "border-red-400/65 bg-gradient-to-b from-red-950/55 via-zinc-950/85 to-black shadow-[0_0_42px_rgba(239,68,68,0.32)]"
      : accent === "gold" || accent === "gold-final"
        ? "border-amber-400/55 bg-gradient-to-b from-amber-950/40 via-zinc-950/80 to-black shadow-[0_0_38px_rgba(251,191,36,0.22)]"
        : "border-cyan-400/55 bg-gradient-to-b from-sky-950/40 via-zinc-950/80 to-black shadow-[0_0_38px_rgba(56,189,248,0.22)]";

  const labelClass = isSuddenDeath
    ? "text-amber-100 drop-shadow-[0_0_24px_rgba(251,191,36,0.55)]"
    : isFinalShot
      ? "text-red-100 drop-shadow-[0_0_22px_rgba(248,113,113,0.5)]"
      : accent === "gold" || accent === "gold-final"
        ? "text-amber-100"
        : "text-white";

  const eyebrowClass = isSuddenDeath
    ? "text-amber-300"
    : isFinalShot
      ? "text-red-300"
      : accent === "gold" || accent === "gold-final"
        ? "text-amber-300"
        : "text-cyan-300";

  const eyebrow = isSuddenDeath
    ? "Tie-breaker"
    : isFinalShot
      ? "Decisive round"
      : "Next round";

  return (
    <div
      className="pointer-events-none fixed inset-0 z-40 flex items-start justify-center px-4 pt-24 sm:pt-28"
      aria-live="polite"
      aria-label={label}
    >
      <div
        className={`p444-round-transition w-full max-w-md overflow-hidden rounded-3xl border-2 px-6 py-5 text-center backdrop-blur-sm ${cardClass}`}
      >
        <p
          className={`text-[10px] font-black uppercase tracking-[0.34em] ${eyebrowClass}`}
        >
          {eyebrow}
        </p>
        <p
          className={`mt-1 text-3xl font-black uppercase tracking-tight sm:text-4xl ${labelClass}`}
        >
          {label}
        </p>
        {sublabel ? (
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.22em] text-zinc-300/85 sm:text-sm">
            {sublabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
