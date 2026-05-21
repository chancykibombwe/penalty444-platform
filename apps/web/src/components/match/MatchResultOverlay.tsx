"use client";

import {
  resultEmoji,
  resultLabel,
  type ShotResult,
} from "./matchPresentation";

/**
 * Full-screen dramatic burst when a result is revealed.
 *
 * Display-only. Parent owns the timing — it should pass `visible=true` on
 * reveal and `false` after `RESULT_OVERLAY_VISIBLE_MS` (default ~700ms).
 *
 * The burst is pointer-events-none so the actual result card and lane
 * buttons underneath stay interactive (e.g. next round picks).
 */
export default function MatchResultOverlay({
  visible,
  result,
}: {
  visible: boolean;
  result: ShotResult | null;
}) {
  if (!visible || !result) return null;

  const isGoal = result === "GOAL";
  const isSave = result === "SAVE";

  const burstClass = isGoal
    ? "from-emerald-400/35 via-emerald-500/15 to-transparent text-emerald-50"
    : isSave
      ? "from-sky-400/35 via-sky-500/15 to-transparent text-sky-50"
      : "from-yellow-300/25 via-yellow-500/10 to-transparent text-yellow-50";

  const ringClass = isGoal
    ? "ring-2 ring-emerald-300/60 shadow-[0_0_80px_rgba(52,211,153,0.45)]"
    : isSave
      ? "ring-2 ring-sky-300/55 shadow-[0_0_72px_rgba(56,189,248,0.4)]"
      : "ring-2 ring-yellow-300/50 shadow-[0_0_64px_rgba(250,204,21,0.35)]";

  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
      aria-hidden
    >
      <div
        className={`p444-result-burst flex items-center justify-center rounded-full bg-gradient-to-br ${burstClass}`}
        style={{
          width: "min(80vw, 32rem)",
          height: "min(80vw, 32rem)",
        }}
      >
        <div
          className={`flex flex-col items-center gap-2 rounded-full bg-black/55 px-12 py-12 backdrop-blur-sm ${ringClass}`}
        >
          <span aria-hidden className="text-6xl sm:text-7xl md:text-8xl">
            {resultEmoji(result)}
          </span>
          <span className="text-3xl font-black uppercase tracking-[0.16em] sm:text-4xl md:text-5xl">
            {resultLabel(result)}
          </span>
        </div>
      </div>
    </div>
  );
}
